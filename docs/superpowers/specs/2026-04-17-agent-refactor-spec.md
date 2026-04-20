# Agent 重构设计规格

> 日期: 2026-04-17
> 范围: agent/ 目录下的 Python 守护进程

## 1. 概述

将 Agent 从 SQLite 持久化的有状态守护进程重构为**纯内存状态**的轻量级守护进程。核心变更：

- **去除 SQLite**：所有状态维护在内存中，重启即重置。
- **统一报告**：资源快照 + 活跃任务状态快照合并为一个 1s 周期的统一报告推送。
- **收缩对外任务模型**：协议层只暴露 `queued | running` 两个活跃态；`ended` 仅存在于 Web 持久化归档中。
- **保留内部预留态**：`reserved` 仅作为 Agent 内部实现细节，不出现在协议层。
- **放弃 Agent 事件系统**：Agent 不维护事件队列，只报告当前任务状态；Web 端根据状态变化派发事件。
- **进程过滤**：过滤低资源占用的后台进程（CPU < 2% 且无 GPU 占用）。
- **保留 Socket.IO 传输层**，重新设计消息协议。

## 2. 架构

```
┌─────────────────────────────────────────────────┐
│                  DaemonService                  │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Collector  │→│ Scheduler │→│   Reporter   │  │
│  │ (1s tick)  │  │(dual-ledger)│ (Socket.IO)  │  │
│  └───────────┘  └──────────┘  └──────────────┘  │
│        ↕              ↕              ↕           │
│  ┌─────────────────────────────────────────────┐ │
│  │           In-Memory State Store             │ │
│  │ • ResourceWindow  (GPU history 120s)        │ │
│  │ • TaskQueue       (queued + reserved +      │ │
│  │                   running)                  │ │
│  │ • ScheduleHistory (per task, last 5)        │ │
│  └─────────────────────────────────────────────┘ │
│        ↕                                         │
│  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ SocketServer │  │   RuntimeMonitor (1s)    │  │
│  │ (CLI IPC)    │  │   process tree tracking  │  │
│  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 组件职责

| 组件 | 职责 |
|------|------|
| **DaemonService** | 1s 主循环 tick：采集 → 调度 → 执行 → 汇报 |
| **Collector** | 采集系统资源快照（GPU, CPU, 内存, 磁盘, 网络, 进程, 网络可达性, 本地用户）|
| **Scheduler** | 双账本 GPU 准入调度，维护调度评估历史 |
| **Reporter** | 组装统一报告，通过 Socket.IO 推送完整资源和任务状态快照 |
| **In-Memory State Store** | 纯内存状态容器，无持久化 |
| **SocketServer** | 本地 Unix socket IPC，供 CLI 提交任务、查询队列、foreground 交互 |
| **RuntimeMonitor** | 1s 线程扫描活跃任务进程树，检测 orphan / 异常退出 |
| **TaskRunner** | 管理子进程的启动和收割（background 模式） |

### 去除的组件

| 组件 | 原因 |
|------|------|
| **store/database.py** (SQLite) | 改为纯内存，重启即重置 |
| **store/tasks.py** | 合并到内存 TaskQueue |
| **store/task_runtime.py** | 合并到内存 TaskQueue |
| **store/runtime.py** | 合并到内存 State Store |
| **collector/docker.py** | 不再需要 Docker 采集 |

## 3. 任务状态模型

### 对外任务模型

协议层和统一报告中，只暴露两种活跃态：

| 类别 | 状态 | 说明 |
|------|------|------|
| 活跃 | `queued` | 任务已入队，尚未真正开始运行 |
| 活跃 | `running` | 任务已经实际运行并占用资源 |
| 归档 | `ended` | 仅存在于 Web 持久化归档中，Agent 不直接上报 |

- Agent 每轮只汇报当前仍然活跃的任务，即 `queued` 和 `running`。
- Web 通过“上一轮存在、本轮消失”的 diff 将任务归档为 `ended`。
- `ended` 不区分完成、取消、异常三种子类；本轮设计统一按“已结束”处理。

### Agent 内部实现态

`reserved` 保留为 Agent 内部实现细节，用于表达“资源已预留，但尚未拿到 PID”。该状态：

- 不出现在 Socket.IO 协议中。
- 不出现在 `UnifiedReport` 中。
- 不作为 Web 侧任务状态的一部分。

### 内部状态定义

```
queued ──────→ reserved ──────→ running ──────→ 移出活跃队列
    │               │                │
    │               │                ├── 用户取消
    │               │                ├── 正常退出
    │               │                └── 异常退出
    │               │
    │               ├── attach 超时
    │               └── 用户取消
    │
    └── 用户取消
```

Agent 内部仅维护三个运行期状态：

| 类别 | 状态 | 占用资源 |
|------|------|---------|
| 排队中 | `queued` | 否 |
| 预留中 | `reserved` | 是（GPU 已预留，但尚未拿到 PID） |
| 运行中 | `running` | 是（GPU 已预留，且已拿到 PID） |

### 不变量

- **reserved/running 必须占用资源**：这两个状态的任务必须有 GPU 预留记录。
- **running 必须有 PID**：只有拿到 PID 后才能进入 running。
- **reserved 不能有稳定 PID**：reserved 仅表示资源已预留、等待启动确认。
- **queued 不占用资源**：排队中的任务不持有任何资源。
- **running + 资源已释放 = 结束**：如果 running 状态的任务的进程消失（pid 不存在），RuntimeMonitor 将其移出活跃队列；Web 在 diff 时将其归档为 `ended`。

### 执行模式

#### background（后台模式）

```
queued → [scheduler 判定通过] → 内部进入 reserved → 启动子进程 → running → [进程退出] → 移出活跃队列
```

- 调度通过后，Agent 先为任务分配 GPU 并进入 `reserved`。
- TaskRunner 成功启动子进程并拿到 PID 后，任务才进入 `running`。
- 协议层不暴露 `reserved`；Web 只会先看到 `queued`，后看到 `running`。
- TaskRunner 每个 tick poll 子进程状态，检测退出。

#### foreground（前台模式）

```
queued → [scheduler 判定通过] → 内部进入 reserved → [CLI 回报 PID] → running → [CLI 回报完成] → 移出活跃队列
```

- 调度成功后 GPU 资源立即预留，状态变为 `reserved`。
- Agent 通过 socket 通知等待中的 CLI 客户端已分配的 GPU 列表。
- CLI 客户端在用户终端启动进程，通过 socket 回报 PID；拿到 PID 后任务进入 `running`。
- 如果超时（默认 30s）未收到 PID 回报，RuntimeMonitor 将其从活跃队列中移除。
- CLI 客户端进程结束后回报 exit_code，Agent 将任务从活跃队列中移除。

## 4. 调度器

### 双账本逻辑（保持现有设计）

每张 GPU 卡维护：

```
schedulable_mb    = total_vram × CAPACITY_FACTOR (0.98)
managed_reserved  = Σ declared_vram_mb (来自 reserved + running 任务的声明值)
unmanaged_peak    = peak(非PMEOW进程实际显存) × UNMANAGED_MULTIPLIER (1.05)
effective_free    = max(0, schedulable - managed_reserved - unmanaged_peak)
```

### 准入规则

**共享任务** (require_vram_mb > 0)：
- 目标 GPU 不能有独占任务
- 目标 GPU 的 effective_free ≥ require_vram_mb
- 优先选择 effective_free 最大的 GPU

**独占任务** (require_vram_mb == 0)：
- GPU 当前利用率 < 3%（compute + memory）
- GPU 在整个 120s 历史窗口内持续空闲
- 无 managed 任务占用

### 调度评估历史

每个 queued 状态的任务维护最近 5 次调度评估记录：

```python
@dataclass
class ScheduleEvaluation:
    timestamp: float          # 评估时间
    result: str               # "scheduled" | "blocked_by_priority" | "insufficient_gpu" | "sustained_window_not_met"
    gpu_snapshot: dict        # 各 GPU 的 effective_free 快照
    detail: str               # 人可读的原因描述
```

- `queued`、`reserved` 和 `running` 期间在内存中维护。
- 任务一旦结束，就从 Agent 活跃队列中移除；Web 通过快照 diff 负责归档。

### 调度评估记录

- 调度器每个 1s tick 对每个 `queued` 任务做一次判定。
- 判定结果写入任务自己的 `schedule_history`，不再单独生成 Agent 侧事件流。
- Web 端如果需要“任务被调度器判定”的事件语义，应根据任务状态和 `schedule_history` 变化自行派发。

## 5. 资源采集

### 采集器清单

| 采集器 | 数据 | 变更 |
|-------|------|------|
| **GPU** | nvidia-smi: 使用率、温度、显存、per-process 显存 | **新增双账本信息**：managed_reserved, unmanaged_peak, effective_free |
| **CPU** | 使用率、核心数、频率 | 不变 |
| **Memory** | 总量、使用量、百分比 | 不变 |
| **Disk** | 挂载点、总量、使用量 | 不变 |
| **Network** | 接口速率 | 不变 |
| **Processes** | 进程列表 | **新增过滤**：过滤 CPU < 2% 且无 GPU 占用的进程 |
| **Internet** | TCP 可达性探测 | 不变 |
| **LocalUsers** | 本地登录用户 | 不变 |
| ~~**Docker**~~ | ~~容器列表~~ | **移除** |

### GPU 采集增强

上报给 Web 的每张 GPU 信息需要包含双账本预留情况：

```python
@dataclass
class GpuCardReport:
    index: int
    name: str
    temperature: int
    utilization_gpu: int         # compute 利用率 %
    utilization_memory: int      # 显存利用率 %
    memory_total_mb: int
    memory_used_mb: int          # 实际物理使用

    # 双账本信息
    managed_reserved_mb: int     # PMEOW 任务声明预留总量
    unmanaged_peak_mb: int       # 非 PMEOW 进程窗口峰值 × 1.05
    effective_free_mb: int       # 调度可用 = total×0.98 - managed - unmanaged

    # 归因信息
    task_allocations: list       # [{task_id, declared_vram_mb}]
    user_processes: list         # [{pid, user, vram_mb}]
    unknown_processes: list      # [{pid, vram_mb}]
```

### 进程过滤规则

硬编码过滤条件（应用于上报的进程列表）：

```python
def should_include_process(proc) -> bool:
    """过滤疑似后台进程"""
    if proc.gpu_memory_mb > 0:
        return True  # 有 GPU 占用的一定保留
    if proc.cpu_percent >= 2.0:
        return True  # CPU 占用 >= 2% 保留
    return False
```

### 资源历史窗口

- 仅用于调度决策（GPU 持续空闲判定）。
- 保持现有 5s 滑动窗口（`GpuHistoryTracker`）。
- 不上报给 Web。

## 6. Web 侧事件派发约定

### Agent 侧职责

- Agent **不维护任务事件系统**，不保存事件队列，也不做 ACK。
- Agent 只上报当前时刻的任务状态快照。
- 对外只暴露活跃任务：`queued` 和 `running`。
- `reserved` 仅是 Agent 内部实现态，不参与协议序列化。

### Web 侧职责

- Web 维护每台 Agent 最近一次任务状态快照。
- 每次收到新报告后，Web 对任务状态做 diff，并派发自己的事件流。
- Web 负责：
    - 派发业务事件给 WebSocket 前端 / App / QQ 等通知通道
    - 将从活跃快照中消失的任务归档到 SQL，状态记为 `ended`
    - 决定事件去重、重试和持久化策略

### Web 侧派发规则

| 状态变化 | Web 派发的语义事件 |
|---------|------------------|
| 新任务首次出现 | `task_submitted` |
| 同一任务从 `queued` 变为 `running`，或首次出现即为 `running` | `task_started` |
| 上一轮存在于活跃快照，这一轮消失 | `task_ended` |
| 优先级字段变化 | `task_priority_changed` |

## 7. 统一报告

### 报告结构

```python
@dataclass
class UnifiedReport:
    agent_id: str
    timestamp: float
    seq: int                          # 报告序号（单调递增）

    # 第一条线：资源快照
    resource_snapshot: ResourceSnapshot
    #   gpu_cards: list[GpuCardReport]  (含双账本信息)
    #   cpu: CpuSnapshot
    #   memory: MemorySnapshot
    #   disks: list[DiskSnapshot]
    #   network: NetworkSnapshot
    #   processes: list[ProcessInfo]   (已过滤)
    #   internet: InternetStatus
    #   local_users: list[str]

    # 第二条线：活跃任务状态快照
    task_queue: TaskQueueSnapshot
    #   queued: list[TaskInfo]          (含 schedule_history last 5)
    #   running: list[TaskInfo]         (含 GPU 分配信息，已拿到 PID)
```

### 推送频率

- **默认周期**：1s
- **服务端主动触发**：Web 发送 `server:requestCollection` → Agent 立即执行一次采集并推送（不等待下个 tick）
- **超时处理**：单次 tick 超过 1s 时，自然滑动延后，不强制对齐

### 传输协议

保留 Socket.IO 传输层，重新定义事件：

**Agent → Web（上行）：**

| Socket.IO 事件 | 载荷 | 说明 |
|---------------|------|------|
| `agent:register` | `{agent_id, hostname, version}` | 连接/重连时注册 |
| `agent:report` | `UnifiedReport` | 1s 周期统一报告 |

**Web → Agent（下行）：**

| Socket.IO 事件 | 载荷 | 说明 |
|---------------|------|------|
| `server:cancelTask` | `{task_id: str}` | 取消任务 |
| `server:setPriority` | `{task_id: str, priority: int}` | 调整优先级 |
| `server:requestCollection` | `{}` | 主动触发一次采集 |

**去除的事件：**
- `agent:metrics` → 合并到 `agent:report`
- `agent:taskChanged` → 不再需要（任务状态随报告推送）
- `agent:localUsers` → 合并到 `agent:report`
- `agent:heartbeat` → 1s 周期的 report 本身就是心跳
- `server:getTaskQueue` → 不再需要（任务队列随报告推送）
- `server:getTaskEvents` → 不再需要（事件由 Web 根据状态变化派发）
- `server:getTaskAuditDetail` → 不再需要（调度历史随报告推送）
- `server:pauseQueue` / `server:resumeQueue` → 移除

### 离线缓冲

Socket.IO 断连时：
- 统一报告不缓冲（资源快照时效性强，连上后自然发送最新的）
- 任务状态也不做额外缓冲；重连后由最新一次完整快照覆盖服务端缓存

## 8. 对外接口

### Web → Agent（通过 Socket.IO）

| 命令 | 参数 | 行为 |
|------|------|------|
| `server:cancelTask` | `{task_id}` | 取消指定任务。queued 直接取消；running 发 SIGTERM → 等待 → SIGKILL |
| `server:setPriority` | `{task_id, priority}` | 调整 queued 任务的优先级 |
| `server:requestCollection` | `{}` | 触发一次即时采集+报告 |

### CLI → Agent（通过本地 Unix socket）

保留现有 IPC 接口：

| 命令 | 说明 |
|------|------|
| `submit` | 提交任务（background 或 foreground） |
| `list` | 查询当前任务队列 |
| `cancel` | 取消任务 |
| `confirm_foreground_launch` | foreground: CLI 回报已启动的 PID |
| `finish_foreground_task` | foreground: CLI 回报任务完成 |
| `query_task_status` | foreground: CLI 轮询任务状态 |

## 9. 内存状态管理

### 任务队列

```python
class TaskQueue:
    queued: OrderedDict[str, TaskRecord]    # 按 (priority, created_at) 排序
    reserved: dict[str, TaskRecord]
    running: dict[str, TaskRecord]
```

- `queued` 维护排队任务，按优先级 ASC、创建时间 ASC 排序。
- `reserved` 维护已分配 GPU、但尚未拿到 PID 的任务。
- `running` 维护运行中任务。

### TaskRecord 数据结构

```python
@dataclass
class TaskRecord:
    id: str
    status: TaskStatus              # queued | reserved | running
    command: str
    cwd: str
    user: str
    launch_mode: TaskLaunchMode     # background | foreground

    # 资源需求
    require_vram_mb: int            # 0 = 独占
    require_gpu_count: int
    gpu_ids: list[int] | None       # 可选的 GPU 指定
    priority: int                   # 默认 10，数字越小优先级越高

    # 时间线
    created_at: float
    reserved_at: float | None
    started_at: float | None

    # 运行时
    pid: int | None
    pid_create_time: float | None
    assigned_gpus: list[int] | None   # 被分配的 GPU 索引列表
    declared_vram_per_gpu: int | None  # 每张 GPU 声明的 VRAM (MB)

    # 调度评估历史
    schedule_history: deque[ScheduleEvaluation]  # 最近 5 条

    # foreground 专用
    attach_deadline: float | None     # 超时时间点
    argv: list[str] | None
    env_overrides: dict | None
```

### 去除的字段

- `report_requested`（现有 TaskSpec）：不再需要。所有任务统一随报告推送，Web 端自行决定持久化策略。

### 资源窗口

```python
class GpuHistoryTracker:
    """保持现有设计：5s 滑动窗口，记录每张 GPU 的 allocation 历史"""
    window_seconds: int = 5
    # 用于调度器判定 GPU 是否持续空闲
```

## 10. 配置

保留环境变量配置方式，更新配置项：

| 环境变量 | 默认值 | 说明 |
|---------|-------|------|
| `PMEOW_SERVER_URL` | 无 | Web 服务器地址 |
| `PMEOW_AGENT_ID` | hostname | 节点标识 |
| `PMEOW_COLLECTION_INTERVAL` | `1` | 采集/报告周期（秒） |
| `PMEOW_HISTORY_WINDOW` | `5` | GPU 历史窗口（秒） |
| `PMEOW_VRAM_REDUNDANCY` | `0.1` | 未管理显存冗余系数 |
| `PMEOW_STATE_DIR` | `~/.pmeow/` | 本地状态目录（日志等） |
| `PMEOW_ATTACH_TIMEOUT` | `30` | foreground 等待 PID 超时（秒） |

**去除的配置项：**
- `PMEOW_HEARTBEAT_INTERVAL` → 不再需要独立心跳
- `PMEOW_MAX_PENDING_EVENTS` → 不再维护 Agent 事件队列
- `PMEOW_MAX_RECENT_TASKS` → Agent 不再保留终态任务窗口

## 11. 错误处理

| 场景 | 处理方式 |
|------|---------|
| **进程崩溃 (pid 消失)** | RuntimeMonitor 1s 扫描检测 → 任务从活跃队列移除，释放 GPU 预留；Web 在 diff 时归档为 `ended` |
| **foreground 超时无 PID** | `reserved` 状态且 attach_deadline 过期 → 任务从活跃队列移除 |
| **nvidia-smi 调用超时/失败** | 跳过本次 GPU 采集，使用上次快照，日志告警 |
| **Socket.IO 断连** | 不缓存历史报告，重连后直接推送最新完整快照 |
| **Agent 重启** | 内存清空，所有任务丢失，不做恢复；仍在运行的进程降级为普通本机进程，由资源采集按 unmanaged 负载观察 |
| **单次 tick 超过 1s** | 自然滑动延后，不强制对齐，记录日志 |

## 12. 测试策略

| 层级 | 范围 | 方式 |
|------|------|------|
| **单元测试** | 调度器双账本逻辑 | Mock 资源数据，验证调度决策和 reason_code |
| **单元测试** | 进程过滤规则 | 验证 CPU<2% 且无 GPU 的进程被过滤 |
| **单元测试** | 任务状态机 | 验证每种转换路径和不变量（reserved/running 必须有资源，running 必须有 PID） |
| **集成测试** | 完整 tick 周期 | Mock nvidia-smi/psutil，验证 UnifiedReport 结构完整性 |
| **集成测试** | foreground 超时 | 模拟 CLI 不回报 PID，验证超时处理 |
| **集成测试** | reserved → running | 验证 PID 回报后状态切换和时间线字段 |
| **集成测试** | 活跃任务消失 diff | 验证 Web 侧可据此归档 `ended` |
| **E2E 测试** | CLI → 调度 → 执行 → 完成 | 用 `sleep 1` 命令做端到端验证 |

## 13. 重构后文件树

```
agent/pmeow/
├── __init__.py
├── __main__.py                  # 入口，不变
├── models.py                    # [重写] 数据模型定义
├── config.py                    # [改] 更新配置项
├── cli_foreground.py             # [改] foreground CLI，适配无 launching 流程
├── cli_runtime.py               # 不变，守护进程管理 CLI
│
├── collector/                   # 资源采集层
│   ├── __init__.py
│   ├── cpu.py                   # 不变
│   ├── disk.py                  # 不变
│   ├── gpu.py                   # [改] 输出增加双账本字段
│   ├── gpu_attribution.py       # [改] 归因结果对齐新的 GpuCardReport 结构
│   ├── internet.py              # 不变
│   ├── local_users.py           # 不变
│   ├── memory.py                # 不变
│   ├── network.py               # 不变
│   ├── processes.py             # [改] 新增进程过滤（CPU<2% 且无 GPU 则排除）
│   ├── snapshot.py              # [重写] 组装 ResourceSnapshot，含双账本 GPU 信息
│   └── system.py                # 不变
│   # 删除: docker.py
│
├── state/                       # [新] 纯内存状态管理（替代 store/）
│   ├── __init__.py
│   └── task_queue.py            # TaskQueue: queued + reserved + running 内存容器
│   # 删除整个 store/ 目录（database.py, tasks.py, task_runtime.py, runtime.py）
│
├── queue/                       # 调度层
│   ├── __init__.py
│   ├── scheduler.py             # [改] 维护 per-task 调度评估历史(5)，并在 queued/reserved/running 间驱动状态流转
│   └── history.py               # 不变，GpuHistoryTracker 120s 窗口
│
├── executor/                    # 任务执行层
│   ├── __init__.py
│   ├── runner.py                # [改] 去掉 SQLite 依赖，状态写入内存 TaskQueue
│   ├── attached.py              # [改] 适配 reserved→running 流程，超时由 RuntimeMonitor 处理
│   └── logs.py                  # 不变
│
├── daemon/                      # 守护进程层
│   ├── __init__.py
│   ├── service.py               # [重写] 1s tick 主循环：采集→调度→执行→汇报
│   ├── runtime_monitor.py       # [改] 去掉 SQLite 依赖，扫描内存 TaskQueue 中的 running 任务
│   ├── socket_server.py         # [改] 去掉 SQLite 依赖，IPC 命令操作内存 TaskQueue
│   ├── supervisor.py            # 不变
│   └── systemd.py               # 不变
│
├── transport/                   # 通信层
│   ├── __init__.py
│   └── client.py                # [重写] 新协议：agent:register + agent:report；处理 cancelTask/setPriority/requestCollection
│
├── reporter.py                  # [新] 统一报告组装（替代 task_reporting.py）
│   # 删除: task_reporting.py
│
└── examples/                    # 不变
    ├── __init__.py
    └── pytorch_tasks.py
```

### 各模块简介

#### `models.py` — 数据模型

重写。定义重构后的所有数据结构：

- `TaskStatus`: Agent 内部三状态枚举（`queued | reserved | running`）
- `PublicTaskStatus`: 对外仅暴露 `queued | running`
- `ArchivedTaskStatus`: Web 归档态仅使用 `ended`
- `TaskLaunchMode`: `background | foreground`
- `TaskRecord`: Agent 内部任务记录（含 `reserved_at`、`schedule_history`、`assigned_gpus`、`attach_deadline`、`pid_create_time` 等）
- `ScheduleEvaluation`: 单次调度评估快照
- `GpuCardReport`: 含双账本信息的 GPU 卡上报结构
- `ResourceSnapshot`: 完整资源快照
- `UnifiedReport`: 统一报告顶层结构
- `TaskQueueSnapshot`: queued + running 的序列化视图

#### `state/task_queue.py` — 任务队列

新建。替代 `store/tasks.py` + `store/task_runtime.py`。纯内存容器：

- `queued`: 按 (priority, created_at) 排序的有序字典
- `reserved`: 已预留 GPU、等待拿到 PID 的任务字典
- `running`: 运行中任务字典
- 提供 `submit()`, `reserve()`, `start()`, `remove()`, `cancel()`, `set_priority()` 等状态转移方法
- 对外序列化时只导出 `queued` 和 `running` 两类活跃任务
- 所有任务生命周期语义都通过状态字段和时间线字段表达，不单独维护 Agent 事件

#### `collector/snapshot.py` — 资源快照组装

重写。将各采集器的原始数据组装为 `ResourceSnapshot`：

- GPU 数据融合双账本信息（从 Scheduler 获取 managed/unmanaged/effective_free）
- 进程列表应用过滤规则
- 其余采集器数据直接透传

#### `reporter.py` — 统一报告

新建。替代 `task_reporting.py`。

- 将 `ResourceSnapshot` + `TaskQueueSnapshot` 组装为 `UnifiedReport`
- 序列化为 camelCase JSON（与 Web 端对齐）
- 维护报告序号 `seq`（单调递增）

#### `transport/client.py` — Socket.IO 客户端

重写。新协议：

- 上行：`agent:register`（连接时）、`agent:report`（1s 周期）
- 下行处理：`server:cancelTask`、`server:setPriority`、`server:requestCollection`（触发即时采集）
- 去掉离线报告缓冲和独立 heartbeat

#### `daemon/service.py` — 主循环

重写。1s tick 同步循环：

1. 调用 Collector 采集资源快照
2. 更新 GpuHistoryTracker
3. 调用 Scheduler 评估所有 queued 任务
4. 调用 Runner/Attached 启动被调度的任务
5. 收割已退出的子进程
6. 组装 UnifiedReport 并通过 Transport 推送

tick 超过 1s 时自然滑动，不强制对齐。

#### 删除的文件

| 文件 | 原因 |
|------|------|
| `store/database.py` | 去除 SQLite 持久化 |
| `store/tasks.py` | 合并到 `state/task_queue.py` |
| `store/task_runtime.py` | 合并到 `TaskRecord` 数据结构 |
| `store/runtime.py` | 合并到内存状态容器 |
| `store/__init__.py` | 整个 `store/` 目录删除 |
| `collector/docker.py` | 移除 Docker 采集 |
| `task_reporting.py` | 替换为 `reporter.py` |

## 14. 与 Web 端的接口约定

### Web 端需要适配的变更

1. **监听 `agent:report` 替代多个独立事件**：不再有 `agent:metrics`、`agent:taskChanged`、`agent:localUsers`、`agent:heartbeat`。
2. **心跳检测**：以是否收到 `agent:report` 为准（>N 秒无报告视为离线）。
3. **任务持久化**：Web 端负责将从活跃快照中消失的任务归档到自己的 SQL 中，归档状态统一为 `ended`。
4. **去除 `server:getTaskQueue`、`server:getTaskEvents`、`server:getTaskAuditDetail`**：这些数据随报告推送，不再按需拉取。
5. **新增 `server:requestCollection`**：主动触发采集。
6. **GPU 展示**：前端需要区分展示实际使用、未管理冗余、已管理预留三部分。
7. **事件派发下沉到 Web**：Web 根据活跃任务快照的 diff 自行派发 `task_submitted`、`task_started`、`task_ended` 和 `task_priority_changed`。
