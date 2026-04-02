# PMEOW V2 设计文档 — 面向高校实验室的 GPU 集群调度系统

> PALM Management Engine for Orchestrated Workloads

日期：2026-04-01

## 1. 背景与目标

PMEOW V1 是一个多服务器硬件监控平台，通过 SSH 远程采集 CPU/内存/磁盘/网络/GPU 指标，提供 Web/Electron 双模式部署。

V2 的目标是从"纯监控"升级为"监控 + 任务调度 + 安全审计"一体化平台，解决高校实验室以下痛点：

- **算力协调低效**：GPU 被占用后只能手动查询抢资源
- **缺乏状态通知**：长时间任务无自动完成/异常通知
- **安全审计不足**：无法区分合法训练与挖矿木马

不在 V2 范围内：Conda 环境管理（交由 Docker/Conda 自行解决）。

## 2. 关键决策

| 决策项 | 结论 | 理由 |
|--------|------|------|
| 架构路线 | 路线 C：Full Agent + 服务端协议重构 | 项目未上线，趁代码量小做彻底架构清理 |
| Agent 与 SSH 关系 | 双模式共存，渐进迁移 | 部署了 Agent 的节点走 Agent 通道，未部署的继续 SSH |
| 调度粒度 | 单机队列 | Agent 本地管理任务队列，GPU 空闲时自动执行 |
| 调度主体 | Agent 自主调度 | 服务端负责展示/通知/有限干预，不是调度瓶颈 |
| IM 通知 | 复用现有 Hook HTTP 机制 | Hook 的 http_request action 已能调用 Webhook，零开发成本 |
| 安全审计 | 渐进式：V2 先展示，V3 加分析引擎 | 利用现有采集数据 + UI 增强 |
| Agent 技术栈 | Python | 计算节点都有 Python，贴合 ML 场景 |
| Electron | 废弃 | 高校场景以 Web 为主 |

## 3. 整体架构

系统分为三层：

**PMEOW Server（Web 端）**

- Scheduler（统一调度）通过 NodeDataSource 抽象层获取数据
- REST API + Socket.IO 暴露给 Web UI
- Web UI（React）管理员界面

**NodeDataSource 抽象层**（路线 C 核心重构点）

- SSHDataSource：兼容旧模式，SSH 远程采集
- AgentDataSource：新模式，接收 Agent 的 WebSocket 推送

**计算节点**

- 无 Agent 的旧服务器：服务端通过 SSH 主动拉取（和 V1 一样）
- 有 Agent 的节点：Python Agent 本地采集 + 任务队列 + WebSocket 上报

数据流方向：

- 旧服务器 ← SSH ← Server
- 计算节点 (Agent) → WebSocket → Server
- Server → Socket.IO → Web UI（浏览器）

## 4. Monorepo 结构变化

### 保留（重构）

- `packages/core/`：核心数据模型 + NodeDataSource 抽象 + DB + 告警 + Hook
- `packages/ui/`：React UI，移除 Electron 相关逻辑
- `packages/web/`：Express + Socket.IO 服务端

### 删除

- `packages/electron/`：废弃

### 新增

- `agent/`：Python Agent（独立项目，不在 pnpm workspace 中）

Agent 目录结构：

- `agent/pyproject.toml`：项目配置，依赖：websocket-client, psutil
- `agent/pmeow/__init__.py`
- `agent/pmeow/__main__.py`：CLI 入口（argparse）
- `agent/pmeow/daemon/`：守护进程主循环模块
- `agent/pmeow/collector/`：指标采集模块（nvidia-smi, /proc/\*, psutil）
- `agent/pmeow/queue/`：任务队列 + 调度逻辑模块
- `agent/pmeow/executor/`：子进程管理模块
- `agent/pmeow/transport/`：WebSocket 客户端 + 自动重连模块
- `agent/pmeow/config.py`：配置（服务端地址, 采集间隔等）
- `agent/tests/`

## 5. NodeDataSource 抽象与 Scheduler 重构

### NodeDataSource 接口

所有节点数据通过统一接口获取：

- `type`：'ssh' | 'agent'
- `serverId`：节点 ID
- `connect()`：建立连接
- `disconnect()`：断开连接
- `isConnected()`：连接状态
- `collectMetrics()`：获取指标快照
- `getConnectionStatus()`：连接状态详情
- `getTaskQueue()`：获取任务队列（仅 Agent）
- `submitTask(task)`：提交任务（仅 Agent）
- `cancelTask(taskId)`：取消任务（仅 Agent）

### SSHDataSource 实现

- connect()：建立 SSH 连接（复用现有 SSHManager）
- collectMetrics()：通过 SSH 远程执行采集命令（复用现有 collectors）
- 不支持任务相关方法

### AgentDataSource 实现

- connect()：被动持有 Agent 的 WebSocket 连接引用（Agent 主动连接）
- collectMetrics()：返回最近一次 Agent 推送的指标快照（不主动拉取）
- 支持任务相关方法，通过 WebSocket 向 Agent 发送指令

### Scheduler 重构

对 SSH 节点：保持不变，定时主动采集。

对 Agent 节点：
- 不在定时循环中主动采集
- Agent 推送 metrics 时，AgentDataSource 触发事件
- Scheduler 监听事件，执行后续流程（存储 → 告警 → Hook → 广播 UI）

统一事件输出：无论数据来自 SSH 还是 Agent，下游（存储、告警、Hook、Socket.IO 广播）看到的都是同一个 MetricsSnapshot。

### ServerConfig 模型变化

新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| sourceType | 'ssh' \| 'agent' | 数据来源模式，默认 'ssh' |
| agentId | string \| null | Agent 注册后自动绑定 |

Agent 通过 hostname 匹配到服务器后，sourceType 自动切换为 'agent'，绑定 agentId。管理员可手动回退到 SSH 模式。

## 6. Python Agent 设计

### Agent 两个角色

**守护进程（daemon）**

- 常驻运行在计算节点
- 定时采集本机指标（GPU/CPU/内存等），通过 WebSocket 推送服务端
- 监控 GPU 资源状态，满足条件时自动从队列取任务执行
- 接收服务端干预指令（取消/暂停/调整优先级）

**CLI 工具**

- 提交任务：`pmeow --pvram=10g --gpu=2 python main.py`
- 查看状态：`pmeow status`
- 取消任务：`pmeow cancel <task-id>`
- 查看日志：`pmeow logs <task-id>`
- CLI 通过 Unix socket 与本地 daemon 通信

### 任务模型

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 任务唯一标识 |
| command | 字符串列表 | 如 ['python', 'main.py'] |
| cwd | 字符串 | 任务工作目录 |
| user | 字符串 | 提交者系统用户名 |
| require_vram_mb | 整数 | **每张卡**需要的显存 (MB) |
| require_gpu_count | 整数 | 需要的 GPU 数量，默认 1 |
| gpu_ids | 整数列表或空 | 指定 GPU 编号，空则自动分配 |
| priority | 整数 | 优先级，越小越高，默认 10 |
| status | 枚举 | queued / running / completed / failed / cancelled |
| created_at | 时间戳 | 提交时间 |
| started_at | 时间戳或空 | 开始执行时间 |
| finished_at | 时间戳或空 | 结束时间 |
| exit_code | 整数或空 | 进程退出码 |
| pid | 整数或空 | 运行中的进程 PID |

注：真实所需显存 = require_vram_mb × require_gpu_count

### 调度逻辑

提交任务时，Agent 立即触发一次 GPU 采集（不等下一个周期），然后结合历史数据和当前状态进行调度判断。

每次调度判断流程：

1. **采集当前 GPU 状态**：各卡总显存、各卡上每个进程的实际显存占用
2. **计算每张卡的可用显存**：
   - 已运行的 PMEOW 任务：使用其声明的 require_vram_mb（非实际值，因为任务可能还在初始化）
   - 非 PMEOW 进程的实际显存占用 × (1 + 冗余系数)，冗余系数可配置，默认 0.1（即预留 10% 余量）
   - 可用 = 总显存 - PMEOW 任务声明总和 - 非 PMEOW 进程实际占用（含冗余）
3. **结合历史数据**：提交时的即时采集 + 此前连续 2 分钟的历史采样数据，要求该时段内所有采样点均满足资源条件（非平均值），确认资源是持续可用而非瞬时波动
4. **按优先级遍历队列**：找出满足资源需求的任务
5. **分配 GPU**：选择可用显存最充裕的卡，设置 CUDA_VISIBLE_DEVICES
6. **启动任务**：spawn 子进程，标记 status=running，通知服务端
7. **任务退出时**：根据 exit_code 标记 completed/failed，通知服务端，立即重新检查队列

防竞态：任务启动后到下次 GPU 采集前，维护"预留显存"字段，避免同一轮连续分配超出实际可用资源。

### Agent ↔ Server 通信协议

Agent 作为 WebSocket 客户端连接服务端。

Agent 发往 Server 的事件：

| 事件名 | 数据 | 触发时机 |
|--------|------|---------|
| agent:register | agentId, hostname, version | 首次连接/重连 |
| agent:metrics | serverId, 指标快照 | 每个采集周期 |
| agent:taskUpdate | serverId, 任务信息 | 任务状态变更时 |
| agent:heartbeat | agentId, 时间戳 | 定时心跳 |

Server 发往 Agent 的指令：

| 事件名 | 数据 | 作用 |
|--------|------|------|
| server:cancelTask | taskId | 管理员取消任务 |
| server:pauseQueue | — | 暂停该节点的调度 |
| server:resumeQueue | — | 恢复调度 |
| server:setPriority | taskId, priority | 调整优先级 |

注册与匹配流程：Agent 首次连接发送 register 事件，服务端通过 hostname 匹配已配置的服务器记录（精确匹配 servers 表的 host 字段）。如果有多个服务器使用相同 hostname，需管理员在 Web UI 中手动绑定 agentId。匹配成功后自动从 SSH 切换到 Agent 模式。

## 7. GPU 使用归属追踪

### 进程归类

每次采集指标时，GPU 上的每个进程归为三类：

| 身份 | 识别方式 | 说明 |
|------|---------|------|
| PMEOW 任务 | Agent 知道自己启动的进程 PID | 关联具体 TaskInfo |
| 已知用户进程 | 通过 PID 查 /proc/{pid}/status 获取 UID → 用户名 | 非 PMEOW 但可归属到人 |
| 未知进程 | 无法识别归属 | 可疑/系统进程 |

### GpuProcessInfo 数据结构

| 字段 | 类型 | 说明 |
|------|------|------|
| pid | 整数 | 进程 PID |
| usedMemoryMB | 整数 | 实际占用 GPU 显存 |
| gpuIndex | 整数 | 所在 GPU 编号 |
| user | 字符串 | 所属系统用户名 |
| command | 字符串 | 进程命令行 |
| taskId | 字符串或空 | 如果是 PMEOW 任务，关联任务 ID |

### GpuAllocationSummary 数据结构

随 MetricsSnapshot 一起推送，实时计算。

**perGpu（每张卡）：**

| 字段 | 说明 |
|------|------|
| gpuIndex | GPU 编号 |
| totalMemoryMB | 总显存 |
| freeMemoryMB | 空闲显存 |
| taskAllocated | PMEOW 任务列表：taskId, declaredVramMB, actualVramMB |
| userProcesses | 用户进程列表：user, pid, command, actualVramMB |
| unknownProcesses | 未知进程列表：pid, command, actualVramMB |

**byUser（按用户汇总）：**

| 字段 | 说明 |
|------|------|
| user | 用户名 |
| totalActualVramMB | 该用户所有进程的实际 GPU 显存总和 |
| taskCount | 该用户的 PMEOW 任务数 |
| processCount | 该用户的非任务 GPU 进程数 |

### 持久化

GpuAllocationSummary 作为 MetricsSnapshot 的一部分存入 metrics 表。

另新增 `gpu_usage_stats` 表，用于高效查询按用户/按时间段的 GPU 使用统计：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| server_id | TEXT | 节点 ID |
| user | TEXT | 用户名 |
| gpu_index | INTEGER | GPU 编号 |
| vram_used_mb | INTEGER | 该采样点的显存占用 |
| is_task | BOOLEAN | 是否为 PMEOW 任务 |
| task_id | TEXT 或空 | 关联的任务 ID |
| timestamp | INTEGER | 采集时间戳 |

索引：(server_id, timestamp) / (user, timestamp) / (task_id)

写入时机：每次采集到 GPU per-process 数据时写入。

清理：与 metrics 一样，按 historyRetentionDays 定期清理。

### 相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/servers/:id/gpu-allocation | 某节点当前 GPU 分配详情 |
| GET | /api/gpu-overview | 全局 GPU 使用概览（所有节点汇总，按用户） |
| GET | /api/gpu-usage/by-user?hours=168&user=xxx | 某用户指定时间段的 GPU 使用时间线 |
| GET | /api/gpu-usage/summary?hours=168 | 全部用户的 GPU 使用汇总 |

## 8. 安全审计模块（V2 展示层）

### 进程审计视图

现有 ProcessTable 增强：

- 新增 GPU 显存占用列（来自 per-process nvidia-smi 数据）
- "可疑进程"红色高亮，规则：
  - 进程名匹配已知挖矿关键词列表（xmrig, ethminer, nbminer 等，可配置）
  - GPU 高占用但非已知用户提交的 PMEOW 任务
  - GPU 利用率 >90% 持续超过 N 小时，且无 PMEOW 任务在运行
- "标记为安全"按钮供管理员确认

### 告警规则扩展

| 规则 | 条件 | 说明 |
|------|------|------|
| 可疑进程告警 | 检测到匹配挖矿关键词的进程 | 立即告警 |
| 无主 GPU 占用 | GPU 被非 PMEOW 任务进程占用超过阈值时间 | 提醒管理员排查 |

### 审计日志

新增 `security_events` 表：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增 |
| server_id | TEXT | 节点 ID |
| event_type | TEXT | suspicious_process / unowned_gpu / marked_safe |
| details | TEXT (JSON) | 进程信息、匹配原因等 |
| resolved | BOOLEAN | 是否已处理 |
| resolved_by | TEXT 或空 | 处理人 |
| created_at | INTEGER | 事件时间 |
| resolved_at | INTEGER 或空 | 处理时间 |

### V3 预留

在 core 层预留 SecurityAnalyzer 接口，V2 默认实现为关键词匹配 + 阈值规则。V3 可插入行为分析引擎。

## 9. UI 变更

### 废弃 Electron

- 删除 `packages/electron/` 目录
- 删除 `packages/ui/src/transport/ipc-adapter.ts`
- TransportProvider 直接使用 WebSocket adapter
- 清理 useStore 中 Electron 相关逻辑
- 删除 package.json 中 Electron 相关脚本和依赖

### 新增页面

**TaskQueue 页面**（`pages/TaskQueue.tsx`）

- 按节点分组展示任务队列：排队中 / 运行中 / 最近完成
- 任务卡片：命令、提交者、所需 VRAM、GPU、状态、等待时间
- 每个运行中任务显示：声明 VRAM vs 实际 VRAM，远超声明则标黄
- 操作按钮：取消、调整优先级、查看日志
- 仅 Agent 节点显示任务内容

**Security 页面**（`pages/Security.tsx`）

- 可疑进程列表，红色高亮，显示匹配原因
- "标记安全"操作按钮
- 审计日志历史
- 按节点、时间范围筛选

### 组件增强

**ServerCard**

- 新增数据源标识角标（"SSH" 或 "Agent"）
- Agent 节点显示任务摘要：排队 N / 运行中 N
- 有可疑进程时显示警告图标

**ServerDetail**

- 新增 "Tasks" tab（仅 Agent 节点显示）
- GPU 区域增强：每张卡展示为资源条
  - 蓝色段：PMEOW 任务占用（标注任务名/用户）
  - 绿色段：用户进程占用（标注用户名）
  - 红色段：未知进程占用
  - 灰色段：空闲
  - 点击可展开查看具体进程列表
- 进程表增加 GPU 显存列，可疑进程高亮

**Overview**

- 新增"GPU 使用分布"卡片：按用户汇总全集群 GPU 占用

### 导航更新

原有：Overview / Servers / Hooks / Alerts / Settings

新增：Tasks / Security

### Settings 页面变更

- 移除 Electron 专有设置
- 新增安全审计配置：挖矿关键词列表（可编辑）、"无主 GPU 占用"告警阈值（分钟）
- 新增 Agent 配置展示/说明区域（引导部署 Agent）

## 10. 新增 REST API 汇总

### 任务管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/servers/:id/tasks | 获取某节点的任务队列 |
| POST | /api/servers/:id/tasks/:taskId/cancel | 管理员取消任务 |
| POST | /api/servers/:id/tasks/:taskId/priority | 管理员调整优先级 |
| POST | /api/servers/:id/queue/pause | 暂停节点调度 |
| POST | /api/servers/:id/queue/resume | 恢复节点调度 |

### GPU 使用

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/servers/:id/gpu-allocation | 某节点当前 GPU 分配详情 |
| GET | /api/gpu-overview | 全局 GPU 使用概览 |
| GET | /api/gpu-usage/by-user | 按用户查 GPU 使用时间线 |
| GET | /api/gpu-usage/summary | 全部用户 GPU 使用汇总 |

### 安全审计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/security/events | 安全事件列表 |
| POST | /api/security/events/:id/resolve | 标记事件为已处理 |
| GET | /api/settings/security | 安全配置（关键词列表、阈值） |
| PUT | /api/settings/security | 更新安全配置 |

### 新增 Socket.IO 事件

| 事件 | 方向 | 说明 |
|------|------|------|
| taskUpdate | Server → Web UI | 任务状态变更通知 |
| taskQueueSync | Server → Web UI | 某节点完整队列同步 |
| securityEvent | Server → Web UI | 新安全事件通知 |

## 11. 数据库变更汇总

### 修改表

**servers 表**：新增 source_type (TEXT, 默认 'ssh') 和 agent_id (TEXT, 可空) 字段。

**metrics 表**：MetricsSnapshot JSON 中新增 gpuAllocation 字段（GpuAllocationSummary），无表结构变化。

### 新增表

- `gpu_usage_stats`：GPU 使用统计（见第 7 节）
- `security_events`：安全事件日志（见第 8 节）

## 12. 部署变化

### 服务端

与 V1 相同：Docker 或直接运行。端口 17200。

新增：服务端需额外处理 Agent 的 WebSocket 连接（复用 Socket.IO 服务，新增 /agent 命名空间）。

### 计算端

新增 Python Agent 部署：

- 要求：Python 3.10+，pip install pmeow-agent
- 配置：服务端地址（PMEOW_SERVER_URL 环境变量或配置文件）
- 启动守护进程：`pmeow-agent daemon --server=ws://server:17200`
- 使用 systemd 或 supervisor 保持常驻
- CLI 工具：安装后直接可用（`pmeow --pvram=10g python main.py`）

### 客户端（IM 通知）

无需开发。在 Hook 系统中配置 http_request action，指向 NcatBot / 飞书 Webhook 即可。文档提供配置示例。
