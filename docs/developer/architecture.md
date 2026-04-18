# 当前架构概览

这份文档描述的是当前已经落地的 PMEOW 运行模型，而不是理想化的未来目标。

## 运行层次

PMEOW 现在由四个主要部分组成：

1. `packages/ui`：React 前端，提供桌面管理员控制台，以及管理员和个人两类移动端视图。
2. `packages/web`：Express + Socket.IO Web 服务，承载认证、REST API、UI 实时事件和 Agent namespace。
3. `packages/core`：共享核心逻辑，负责数据模型、SQLite、数据源抽象、调度器、告警、钩子和安全处理。
4. `agent/`：独立 Python Agent，运行在计算节点本地，负责采集、任务队列、自主调度、执行器和 Socket.IO 通信。

## 仓库结构和职责划分

当前 Monorepo 的核心布局是：

```text
packages/
  core/   共享模型、SQLite、datasource、scheduler、alerts、security
  ui/     React UI（桌面控制台 + 移动端视图）
  web/    Express + Socket.IO 服务端
  web-cli/ Web 发行包入口
agent/    Python Agent，独立于 pnpm workspace
```

这个划分背后的约束很明确：

- `core` 是 TypeScript 侧的共享事实来源。
- `web` 负责把 `core` 暴露成 HTTP 与 Socket.IO 接口。
- `ui` 只消费 Web 暴露的状态和操作。
- `web-cli` 负责对外发布 `pmeow-web` 发行入口。
- `agent` 不进入 pnpm workspace，它有自己独立的 Python 依赖和测试体系。

## 用户界面与认证边界

当前 UI 不是单一平面，而是三种前端入口：

- 桌面管理员控制台：`/` 开头的桌面路由，使用管理员 JWT。
- 管理员移动端：`/m/admin`，本质上仍使用管理员登录态。
- 个人移动端：`/m/me`，使用独立的 Person Token，而不是管理员 JWT。

这意味着在架构上，PMEOW 当前至少存在三套会话边界：

- 管理员 HTTP + 桌面 Socket.IO 会话
- 个人移动端 Token 会话
- Agent live session 会话

## 两种节点数据源

服务端通过 `NodeDataSource` 抽象同时支持两类节点：

- `ssh`：服务端主动通过 SSH 采集指标。
- `agent`：计算节点主动把指标推送到服务端。

单个服务器记录同一时刻只应有一种活跃数据源。服务端不会并行把 SSH 和 Agent 结果混在一起。

### SSH 节点

- 由 `Scheduler` 的定时器主动轮询
- 通过 `SSHDataSource` 和 SSHManager 连接
- 采集结果直接进入统一的指标后处理链路 `metrics pipeline`

### Agent 节点

- Agent 连接 `/agent` namespace
- 服务端通过 hostname 解析绑定关系
- 如果是首次接入且 hostname 尚未匹配到已有记录，服务端会自动创建 `sourceType=agent` 的服务器记录；`name` 使用 hostname，`host` 使用当前 peer ip
- 指标不是被轮询，而是由 Agent 主动推送
- 指标进入 `AgentDataSource.pushMetrics()` 后触发统一处理

## 核心数据流

### 浏览器到服务端

- 浏览器先通过 `POST /api/login` 获取管理员 token
- 后续所有管理员 `/api/*` 请求都走 Bearer token
- UI Socket.IO namespace `/` 也使用同一个 token 做握手认证

### SSH 指标链路

1. `Scheduler.start()` 初始化所有 data source
2. 定时轮询所有 `ssh` 类型节点
3. `collectFromSource()` 获取 `MetricsSnapshot`
4. `handleMetrics()` 负责后续统一处理

### Agent 指标链路

1. Agent 连接 `/agent` namespace
2. 发送 `agent:register`
3. 服务端解析 hostname 并决定是否绑定到某个 `serverId`
4. Agent 后续按周期发送 `agent:report`
5. 统一报告里同时带上资源快照、任务队列快照和本地用户清单
6. Web 侧把报告规范化成已绑定的 `serverId` 后进入统一处理链路

### 人员与移动端链路

1. 管理员在桌面端创建人员档案、绑定关系和个人移动端令牌
2. 服务端根据人员绑定把任务、GPU 使用和统计结果归属到人
3. 个人移动端使用 `X-PMEOW-Person-Token` 访问 `/api/mobile/me/*`
4. 管理员移动端沿用管理员 JWT 访问 `/api/mobile/admin/*`

### 统一的后处理链路

无论数据来自 SSH 还是 Agent，进入 `handleMetrics()` 后都会按同一顺序继续处理：

1. 持久化 metrics 或 agent 扩展数据
2. 更新内存中的节点状态 `server status`
3. 广播 `metricsUpdate` 给 UI
4. 执行告警检查
5. 执行安全快照处理
6. 异步执行钩子规则

这个顺序很重要。调试时如果发现 UI 有数据但数据库没更新，或者 security event 缺失，应该优先沿着这条链路逐段确认。

要注意，当前本地用户清单已经并入统一报告，不再依赖独立的侧带上报事件。

## 状态与绑定语义

当前节点状态在 UI 上至少会表现为四种：

- `connected`
- `connecting`
- `error`
- `disconnected`

对 Agent 节点还要额外记住三条语义：

- hostname 绑定必须唯一且精确匹配 `servers.host`
- Agent 心跳会维持 live session 会话，超时后服务端会视为离线
- Python Agent 上报的 heartbeat 时间戳源于秒级时间，需要在 Web 侧先规范化成毫秒再比较超时

## Scheduler 的职责边界

当前 `Scheduler` 的职责是：

- 管理 data source 生命周期
- 轮询 SSH 节点
- 接收 Agent 指标事件
- 向 live Agent session 转发只读控制请求，例如任务事件拉取
- 统一触发持久化、告警、钩子和安全处理

它不负责：

- 为 Agent 节点生成任务
- 在服务端重新排队或抢占任务
- 维护任务日志正文

这条边界不能轻易打破。PMEOW 的任务调度主体仍然是节点本地的 Python Agent。

## 本地调度约束

当前调度是严格的节点本地调度，而不是服务端统一调度：

- 每个 Agent daemon 只根据自己的本地内存任务队列做排队和出队
- 准入判断依赖本机 GPU 当前样本和历史窗口，而不是服务端跨节点仲裁
- `priority` 和 `created_at` 仍然是本地排序基础；服务端只负责下发变更，不负责替 Agent 重新决定 admission

## Agent 本地队列与调度架构

当前 Python Agent 的本地事实来源不是 SQLite，而是一个随守护进程存活的内存状态层。核心状态分成三块：

- `TaskQueue`：维护任务生命周期和对外可见的活跃任务快照
- `GpuHistoryTracker`：维护 GPU 分配历史窗口，用于持续空闲判断
- `schedule_history`：挂在每个任务上，只保留最近 5 次调度评估

这三块状态都只服务于节点本地调度。Agent 重启后它们会被重建，不尝试做本地恢复。

### 任务队列生命周期

Agent 内部任务状态是三态模型：`queued -> reserved -> running`。

- `queued`：任务已提交，但还没有拿到 GPU 资源
- `reserved`：GPU 已经被分配，但还没有稳定 PID
- `running`：任务已经绑定 PID 并开始运行

`reserved` 是内部实现态，不会直接上报给 Web。对外序列化时，`reserved` 会按 `queued` 汇报，因此协议层只看到 `queued` 和 `running` 两种活跃态。

内部状态转移规则如下：

- 提交任务时进入 `queued`
- 调度成功后先进入 `reserved`
- `daemon_shell` 模式在子进程启动并拿到 PID 后进入 `running`
- `attached_python` 模式在 CLI 回报 PID 后进入 `running`
- 任务完成、被取消、attach 超时，或者运行中的 PID 消失后，任务都会从活跃队列移除

队列顺序由 `(priority, created_at)` 升序决定。也就是说，优先级数字越小越先评估；同优先级下更早提交的任务先评估。

### Runtime Monitor 的职责

本地终态收敛由独立线程 `RuntimeMonitorLoop` 完成，而不是依赖采集循环顺带处理。

- 对 `running` 任务，它检查 PID 是否仍然存在
- PID 存活校验会同时比对 `pid_create_time`，避免 PID 重用造成误判
- 对 `reserved` 的 `attached_python` 任务，它检查 `attach_deadline` 是否过期
- 检测到 PID 消失或 attach 超时后，任务会被从活跃队列中移除
- 单次 tick 异常只记录日志，不会停止后续轮询

### GPU 历史窗口

GPU 调度不是只看当前探针结果，而是同时依赖一个滑动历史窗口。

- `GpuHistoryTracker` 默认维护最近 120 秒的每轮 `PerGpuAllocationSummary`
- 每次 `collect_cycle()` 完成资源采集后，都会把当前 `per_gpu` 记录进窗口
- 窗口在写入和读取时都会自动剪枝，只保留仍在窗口内的样本

这个窗口主要用于回答两个问题：

- 最近一段时间里，非 PMEOW 进程在每张 GPU 上的峰值显存是多少
- 对于独占任务，目标 GPU 是否在整个窗口内持续空闲

### GPU 双账本与准入判断

当前调度器使用双账本模型，而不是直接拿探针看到的 `memory_used_mb` 作为可调度依据。

对每张 GPU，调度器会构建一个 `GpuLedger`，核心字段包括：

- `schedulable_mb = total_vram_mb * 0.98`
- `managed_reserved_mb`：所有 PMEOW 任务的声明显存之和，再加上本轮尚未真正启动但已经选中的 pending 预留
- `unmanaged_peak_mb`：历史窗口内非 PMEOW 进程峰值显存乘以 1.05
- `effective_free_mb = max(0, schedulable_mb - managed_reserved_mb - unmanaged_peak_mb)`

这里有两个关键约束：

- PMEOW 任务按声明值记账，也就是 `declared_vram_mb`，而不是按当前实际占用记账
- 非 PMEOW 进程按探针实际占用记账，但用窗口峰值和冗余系数放大，避免短时波动把 GPU 错判为空闲

### 任务类型与调度规则

调度器把任务分成两类：

- 共享任务：`require_vram_mb > 0`
- 独占任务：`require_vram_mb == 0`

共享任务的准入规则：

- 不能落到已经被独占任务占用的 GPU 上
- `effective_free_mb` 必须大于等于任务声明的单卡显存需求
- 如果候选 GPU 足够，优先选 `effective_free_mb` 最大的几张卡

独占任务的准入规则：

- 当前不能已经有独占 owner
- 当前不能已经有 PMEOW managed reservation
- 当前 GPU 使用率必须低于阈值
- 当前 GPU 显存使用率必须低于阈值
- 历史窗口内每个样本都必须满足“无 PMEOW 任务且非 PMEOW 显存占用低于阈值”

因此，独占任务的判断是“当前空闲 + 窗口内持续空闲”，而不是“这一秒看起来空闲”。

### GPU 归因与进程过滤

GPU 资源汇报同样不是裸探针结果，而是先做进程归因。

归因流程是：

- 先采集 GPU 进程列表，得到 `pid + gpu_index + used_memory_mb`
- 再从 `running` 和 `reserved` 任务建立 PID 到任务的映射
- 能映射到任务的 GPU 进程归到 `GpuTaskAllocation`
- 不能映射到任务，但能识别用户的进程归到 `GpuUserProcess`
- 剩余无法识别的进程归到 `GpuUnknownProcess`

这里的一个重要设计点是：GPU 卡上的 PMEOW 任务占用展示使用的是任务声明值，调度可用空间也是基于声明值；实际探针看到的显存仅作为展示和非 PMEOW 进程核算的输入。

进程列表上报还有额外过滤规则：

- GPU 显存占用大于 0 的进程一定保留
- CPU 占用大于等于 2% 的进程保留
- 其余低资源后台进程从汇报中滤掉

### 调度评估历史

每个任务都维护一个 `schedule_history` 双端队列，长度固定为 5。

每次采集周期里，只要任务仍在 `queued`，调度器都会给它写入一次评估记录。每条记录至少包含：

- `timestamp`：评估时间
- `result`：调度结果代码
- `gpu_snapshot`：本轮评估用到的 GPU 视图摘要
- `detail`：可读的诊断文本

当前对外暴露的结果代码是：

- `scheduled`
- `blocked_by_priority`
- `insufficient_gpu`
- `sustained_window_not_met`

这些记录的用途不是做事件流，而是回答“为什么这个任务现在没有被调度”。因此只保留最近 5 次，覆盖即可，不做持久化累积。

### 统一定时汇报

资源汇报和任务汇报不是两套独立循环，而是同一个 `collect_cycle()` 统一驱动。

每个周期的顺序是：

1. 采集当前资源快照，包括 GPU、CPU、内存、磁盘、网络、进程、本地用户和网络探测
2. 生成 GPU 归因结果和 `per_gpu` 分配摘要
3. 把当前 `per_gpu` 写入 GPU 历史窗口
4. 回收已经退出的 `daemon_shell` 任务
5. 对当前 `queued` 任务做一轮调度评估并记录 `schedule_history`
6. 对可运行任务做 `reserve`，并在需要时启动进程或等待 attached CLI 确认 PID
7. 把当前 `ResourceSnapshot` 和 `TaskQueueSnapshot` 组装成 `UnifiedReport`
8. 通过 transport 向 Web 推送统一报告

这意味着 Web 看到的硬件状态和任务状态来自同一个 tick，时间基准是一致的，不需要在服务端额外拼接两条独立采样线。

### 协议可见性

`UnifiedReport` 里只保留当前活跃事实：

- `resource_snapshot`：硬件和进程视图，其中 GPU 包含 managed reservation、unmanaged peak、effective free 以及归因明细
- `task_queue`：只包含 `queued` 和 `running` 任务

Agent 不直接上报“已结束任务”。任务一旦从活跃队列移除，就不再出现在后续报告里；Web 通过相邻快照 diff 把它归档为结束。

### 当前明确的边界

当前实现有几条重要边界，需要在设计上写清楚：

- 多进程任务的 GPU 归因目前只稳定覆盖根 PID，子进程树发现机制还没有实现
- GPU 历史窗口只服务于本地调度，不向 Web 单独上报原始窗口样本
- 调度是节点本地行为，服务端不做跨节点 admission 或抢占
- Agent 只维护当前活跃任务，不在本地保存完整 ended 历史
- 资源判断只做总量级别的显存预留，不做碎片感知调度

## Agent 与服务端的关系

Agent 负责本地事实，服务端负责集群视图和最小控制面。

### Agent 负责

- 本地资源采集
- GPU 归属识别
- 本地任务队列
- 资源满足时启动子进程
- 任务状态和心跳上报
- 本地用户清单采集，并随统一报告一起上报
- 在 `PMEOW_SERVER_URL` 为空时以 local-only 模式继续运行本地调度与 CLI

### 服务端负责

- 维护跨节点的任务镜像视图
- 展示 GPU overview、process audit 和人员归属结果
- 暴露取消、暂停、恢复和调整优先级的控制 API
- 按需通过 live session 拉取任务事件流 `task events`
- 记录安全事件和告警历史

## 持久化模型

服务端主存储是 SQLite。当前核心数据至少包括：

- 服务器和最新状态
- metrics 与 GPU usage 聚合数据
- 钩子规则和执行日志
- 设置与告警历史
- Agent 任务镜像
- 安全事件
- 人员档案与服务器用户名绑定
- 个人移动端访问相关记录

人员归属 `Person attribution` 是一个可选层。如果没有任何人员记录，原有监控、任务和安全逻辑仍然保持可用，只是不会补充人员归属字段。

Agent 节点也有自己的本地状态目录和日志目录，默认在 `~/.pmeow/`。当前目录下主要保存 socket、pid 文件和任务日志，而不是本地 SQLite 任务库。

## 几条必须记住的系统约束

1. 服务端是观察者和干预点，不是全局调度器。
2. Agent 任务日志在节点本地，服务端只保存任务镜像和状态更新。
3. hostname 绑定要求精确匹配；重复服务器记录会导致自动绑定冲突，而完全未匹配时服务端会自动创建新的 agent 服务器记录。
4. `MetricsSnapshot.gpuAllocation` 是 Agent 模式下的重要扩展，但不是所有节点都会有。
5. 用户态看到的任务列表是服务端镜像，和节点本地事实之间通过 task update 保持同步。
6. 个人移动端和管理员登录是两套不同认证体系，不应混为同一权限面。

## 文档与设计档案的关系

如果你需要理解“为什么是现在这个结构”，应再去看 `docs/superpowers/` 下的设计档案。那部分解释的是设计背景；本页解释的是当前真实实现。