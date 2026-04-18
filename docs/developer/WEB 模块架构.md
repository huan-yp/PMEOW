# WEB 设计说明

## WEB 架构

- `packages/web/`
	- WEB 模块的接入编排层。
	- 负责 HTTP / WebSocket 暴露、认证、Agent 接入、UI 广播、路由装配和静态资源托管。
- `packages/core/`
	- WEB 模块的领域内核。
	- 负责协议类型、SQLite 持久化、快照归档、任务状态维护、告警判定、安全分析、人员绑定与任务控制。
	- 当前 WEB 模块应理解为 `packages/web + packages/core` 这套完整后端，而不是只指 `packages/web`。
- `src/server.ts`
	- 生产入口。
	- 负责创建运行时、启动 HTTP 服务、处理 `SIGINT` / `SIGTERM` 优雅退出。
- `src/server-dev.ts`
	- 开发入口。
	- 在启动前打开 Agent 汇报调试日志开关，然后复用 `src/server.ts`。
- `src/app.ts`
	- WEB 模块总入口。
	- 负责初始化 Express、HTTP Server、Socket.IO、认证中间件、Agent namespace、UI 广播器和离线检测定时器。
	- 同时负责挂载全部 REST 路由和静态 UI 资源。
- `src/auth.ts`
	- 负责登录、JWT 签发、HTTP 鉴权和 UI WebSocket 鉴权。
	- 当前采用单密码初始化和单角色 `admin` 模式。
- `src/agent-namespace.ts`
	- 负责 `/agent` 命名空间。
	- 处理 Agent 注册、会话绑定、汇报接收、协议解析、断开清理，以及节点在线状态广播。
- `src/ui-broadcast.ts`
	- 负责把后端状态变化统一推送给 UI。
	- 当前广播事件包括 `metricsUpdate`、`taskEvent`、`alertStateChange`、`securityEvent`、`serverStatus`、`serversChanged`。
- `src/agent-report-debug-log.ts`
	- 负责开发调试辅助。
	- 在开启环境变量后按固定采样间隔把 Agent 原始汇报追加到 ndjson 日志，便于排查协议和上报问题。
- `src/routes/`
	- 承载 REST API 路由层。
	- `server-routes.ts`：节点 CRUD、节点在线状态查询。
	- `metrics-routes.ts`：最新快照和历史快照查询。
	- `task-routes.ts`：任务列表、任务详情、取消、优先级调整。
	- `person-routes.ts`：人员、绑定关系、候选账号、时间线、任务视图、向导建档。
	- `alert-routes.ts`：告警查询、单条和批量压制/解除压制。
	- `security-routes.ts`：安全事件查询、标记安全、取消处置。
	- `settings-routes.ts`：系统设置读取和更新。
- `scripts/copy-ui-dist.mjs`
	- 负责构建阶段把 `packages/ui/dist` 复制到 `packages/web/dist/public`。
	- 让 WEB 模块在同一进程里同时提供 API、WebSocket 和前端静态资源。
- `core/src/db/`
	- 承载持久化访问层。
	- `database.ts` 负责 SQLite 初始化、schema 建立、数据库自检和异常库迁移。
	- `servers.ts`、`snapshots.ts`、`tasks.ts`、`alerts.ts`、`security-events.ts`、`persons.ts`、`person-bindings.ts`、`settings.ts` 负责各领域表的读写。
- `core/src/ingest/`
	- 承载 Agent 汇报落库与事件化主链路。
	- `pipeline.ts` 负责 latest cache、任务 diff、告警检查、安全检查和快照写入总编排。
	- `snapshot-scheduler.ts` 负责 recent / archive 两层窗口写入节流。
- `core/src/task/`
	- 承载任务领域服务。
	- `engine.ts` 负责从一份 `UnifiedReport` 中收敛任务状态、执行落库并生成 `TaskEvent[]`。
	- `differ.ts` 负责把前后两份任务 active 视图差异转成 `submitted` / `started` / `ended`。
	- `service.ts` 负责任务查询、任务控制命令封装，以及把取消/调优请求通过在线 session 回发给 Agent。
- `core/src/alert/`
	- 承载告警领域逻辑。
	- `engine.ts` — `AlertEngine` 统一入口，提供 `processReport` / `sweepOffline` 两个方法。
	- `state-store.ts` — `AlertStateStore` 进程内存状态表，各检测器共享。
	- `detectors.ts` — 阈值检测（CPU / 内存 / 磁盘 / GPU 温度）、空闲显存检测、离线检测。
- `core/src/security/`
	- 承载安全事件分析逻辑。
	- `analyzer.ts` 负责从汇报中抽取安全 finding，`pipeline.ts` 负责按指纹去重并写入事件表。
- `core/src/person/`
	- 承载人员领域逻辑。
	- 负责向导建档、账号绑定冲突处理、人员时间线聚合、人员任务聚合。
- `core/src/node/`
	- 承载在线 Agent 会话抽象。
	- `registry.ts` 负责 session 与 lastReportAt 管理，`session.ts` 负责把 Socket 包装成可发命令的会话对象。
- `core/src/agent/`
	- 承载 Agent 协议定义。
	- 负责注册/汇报事件名、服务端命令名、payload 校验和 `UnifiedReport` 规范化。

## WEB 数据/控制流

### 服务启动控制流

```text
执行 `src/server.ts` / `src/server-dev.ts`
→ `createWebRuntime` 初始化数据库连接和领域内核运行时
→ 创建 Express / HTTP Server / Socket.IO
→ 构造 `AgentSessionRegistry`
→ 构造 `IngestPipeline`
→ 挂载 `/api/login` 与鉴权中间件
→ 注册全部 REST 路由
→ 注册 `/agent` 命名空间和 UI 根命名空间
→ 解析并挂载 UI 静态资源目录
→ 启动 HTTP 监听
→ 每 10 秒执行一次离线检测
```

### 后端分层控制流

```text
Agent / UI / 管理操作从 `packages/web` 进入
→ `packages/web` 负责协议接入、鉴权、路由和广播
→ 具体领域行为下沉到 `packages/core`
→ `packages/core/db` 做持久化
→ `packages/core/ingest` 做汇报编排和历史窗口维护
→ `packages/core/task` / `alert` / `security` / `person` 做领域规则计算
→ 再由 `packages/web` 把结果暴露为 REST 响应或 WebSocket 事件
```

### Agent 接入与上报控制流

```text
Agent 连接 `/agent`
→ 发送 `agent:register`
→ `src/agent-namespace.ts` 校验注册 payload
→ 根据 `agentId` 查找或创建 server
→ 创建 `AgentSession` 并写入 `AgentSessionRegistry`
→ 向 UI 广播 `serverStatus=online` 和 `serversChanged`
→ Agent 持续发送 `agent:report`
→ 协议层把 wire payload 解析为 `UnifiedReport`
→ `IngestPipeline.processReport` 接管
→ 更新 latest report 缓存
→ 调用 `TaskEngine` 收敛任务状态并生成任务事件
→ 检查阈值告警和空闲显存告警
→ 检查安全事件
→ 按窗口策略写 recent / archive 快照
→ 通过 `ui-broadcast.ts` 把最新变化推送给 UI
→ Agent 断开时移除 session 并广播 `serverStatus=offline`
```

### UI 查询与订阅控制流

```text
UI 先调用 `/api/login`
→ `src/auth.ts` 校验密码并返回 JWT
→ 后续 REST 请求走 `Authorization: Bearer <token>`
→ `/api/*` 路由读取数据库或运行时缓存后返回结果
→ UI 建立根命名空间 Socket.IO 连接并在握手里带 token
→ `socketAuthMiddleware` 校验成功后允许订阅实时事件
→ UI 接收 `metricsUpdate` / `taskEvent` / `alertStateChange` / `securityEvent` / `serverStatus`
→ 页面增量更新总览、节点详情、任务、告警和安全事件视图
```

### 任务控制流

```text
UI 调用任务查询接口
→ `task-routes.ts` 从任务表读取并做分页
→ 返回任务详情及调度历史等字段

UI 发起取消任务或调整优先级
→ `task-routes.ts` 调用领域内核中的任务服务
→ 通过 `AgentSessionRegistry` 找到目标 server 对应 session
→ 向 Agent 发送 `server:cancelTask` 或 `server:setPriority`
→ Agent 后续汇报新的任务队列状态
→ `IngestPipeline` 再把状态变更写回数据库并广播 `taskEvent`
```

### 告警与安全事件流

```text
新的 `UnifiedReport` 到达 `IngestPipeline`
→ pipeline 将 report 交给 `AlertEngine.processReport(serverId, report, settings)`
→ AlertEngine 内部：
  → 阈值检测器 `detectThresholds` 生成异常列表
  → 空闲显存检测器 `detectGpuIdle` 查询/更新 `AlertStateStore`，生成异常列表
  → 合并所有异常 `AlertAnomaly[]`
  → 调用 `reconcileAlerts` 闭环状态机
→ 返回 `{ allChanges, broadcastable }`
→ pipeline 仅推送 `broadcastable`（新 ACTIVE / RESOLVED↔ACTIVE）

同一份汇报继续进入安全分析
→ 生成安全 finding
→ 仅当没有同指纹未解决事件时创建新的安全事件
→ 写入数据库并推送 `securityEvent`

WEB 运行时每 10 秒调用 `AlertEngine.sweepOffline(registry, settings)`
→ 离线检测器根据 `lastReportAt` 生成 offline 异常
→ 复用同一套闭环状态机
→ 仅推送 `broadcastable` 变化

进程重启时状态表为空，首次工况汇报后自动基于初始状态表计算
```

### 快照与历史数据流

```text
Agent 汇报进入 `IngestPipeline`
→ latestReports 内存缓存始终保存每台机器最新一份报告
→ `SnapshotScheduler` 判断是否到达 recent 窗口写入时机
→ 满足时写入 recent 快照并清理超出保留数的短期快照
→ 同时按 archive 周期写入长期快照
→ UI 查询 `/metrics/latest` 读取内存态最新值
→ UI 查询 `/metrics/:serverId/history` 读取 SQLite 中的历史窗口
```

## 任务情况数据流追溯

### 任务状态摄入与 diff 主链路

主入口：`packages/web/src/agent-namespace.ts` 中 `socket.on(AGENT_EVENT.report)`，随后进入 `packages/core/src/ingest/pipeline.ts` 的 `IngestPipeline.processReport`

```text
Agent 发来一份 `UnifiedReport`
→ `parseUnifiedReport` 把 wire payload 规范化为统一结构
→ `IngestPipeline.processReport` 取出上一份 `prevReport`
→ 调用 `packages/core/src/task/engine.ts` 的 `TaskEngine.processReport`
→ 由 TaskEngine 提取上一轮和本轮 active tasks
→ 读取 `report.taskQueue.recentlyEnded` 作为显式结束集合
→ 调用 `packages/core/src/task/differ.ts` 的 `diffTasks`
→ 把前后两份任务视图转成 `submitted` / `started` / `ended`
→ 进入逐条落库与事件生成阶段
```

### 任务 diff 规则主链路

主入口：`packages/core/src/task/differ.ts` 的 `diffTasks`

```text
当前任务不在上一轮 active 集合里
→ 生成 `submitted`
→ 如果当前状态已经是 `running`，再补一个 `started`

上一轮是 `queued`，这一轮变成 `running`
→ 生成 `started`

Agent 显式放进 `recentlyEnded`
→ 直接生成 `ended`

上一轮存在，但这一轮既不在 active 也不在 `recentlyEnded`
→ 合成一个 `status=abnormal`、`endReason=disappeared` 的结束事件
→ 生成 `ended`
```

### 任务状态处理与落库主链路

主入口：`packages/core/src/task/engine.ts` 的 `TaskEngine.processReport`

```text
TaskEngine 遍历每一条 task diff
→ 如果事件是 `ended`
→ 调用 `packages/core/src/db/tasks.ts` 的 `endTask`
→ 写入 `status` / `finished_at` / `exit_code` / `end_reason`

→ 如果事件不是 `ended`
→ 调用 `packages/core/src/db/tasks.ts` 的 `upsertTask`
→ 写入或更新 active task 的状态、PID、assignedGpus、priority、scheduleHistory 等字段

→ 无论哪种事件
→ 统一回调 `onTaskEvent`
→ 由 `packages/web/src/app.ts` 中 `createWebRuntime` 注册的回调继续向外广播
→ `packages/web/src/ui-broadcast.ts` 发出 `taskEvent`
→ UI 增量刷新任务视图
```

### 任务查询与回放主链路

主入口：`packages/web/src/routes/task-routes.ts`

```text
UI 调用 `GET /api/tasks`
→ `task-routes.ts` 解析 `serverId` / `status` / `user` / `page` / `limit`
→ 调用 `packages/core/src/task/service.ts` 的 `listTasks` 和 `countTasks`
→ 从 SQLite 读取任务记录并分页返回
→ 路由层把 `gpuIds` / `assignedGpus` / `scheduleHistory` 从 JSON 字符串解包成 API 对象

UI 调用 `GET /api/tasks/:taskId`
→ `task-routes.ts` 调用 `getTask`
→ 返回单个任务的完整状态
```

### 任务控制回发 Agent 主链路

主入口：`packages/web/src/routes/task-routes.ts` 的取消和优先级接口

```text
UI 调用 `POST /api/servers/:serverId/tasks/:taskId/cancel`
→ `task-routes.ts` 调用 `packages/core/src/task/service.ts` 的 `cancelTask`
→ 通过 `AgentSessionRegistry.getSessionByServerId` 找到在线 session
→ 发出 `server:cancelTask`

UI 调用 `POST /api/servers/:serverId/tasks/:taskId/priority`
→ `task-routes.ts` 调用 `setPriority`
→ 通过在线 session 发出 `server:setPriority`

→ Agent 执行后并不会直接改库
→ 而是在后续新的 `UnifiedReport` 中体现任务状态变化
→ 系统再次走前面的任务 diff 和落库主链路闭环完成状态收敛
```

## 测量指标数据流追溯

### 指标摄入与最新态更新主链路

主入口：`packages/web/src/agent-namespace.ts` 中 `socket.on(AGENT_EVENT.report)`，随后进入 `packages/core/src/ingest/pipeline.ts` 的 `IngestPipeline.processReport`

```text
Agent 发来 `UnifiedReport`
→ `parseUnifiedReport` 完成字段规范化
→ `IngestPipeline.processReport` 读取当前 server 的上一份 report
→ 先把当前 report 放入 `latestReports` 内存缓存
→ 立即触发 `onMetricsUpdate`
→ `packages/web/src/app.ts` 注册的回调转发到 `ui-broadcast.metricsUpdate`
→ UI 先拿到一份最新实时指标，不需要等待快照落库
```

### 指标 recent 窗口写入主链路

主入口：`packages/core/src/ingest/pipeline.ts` 中 recent 分支

```text
`processReport` 读取 `getSettings()`
→ 使用 `snapshotRecentIntervalSeconds` 判断是否到达短期窗口写入时机
→ 默认间隔来自 `DEFAULT_SETTINGS`，当前是 60 秒
→ `SnapshotScheduler.shouldWriteRecent(serverId, now, interval)` 返回 true
→ 调用 `packages/core/src/db/snapshots.ts` 的 `saveSnapshot(serverId, report, 'recent', report.seq)`
→ 把 CPU / 内存 / 磁盘 / 网络 / 进程 / 本地用户写入 `snapshots`
→ 把每张 GPU 的温度、利用率、显存、任务分配、用户进程写入 `gpu_snapshots`
→ 调用 `deleteOldRecentSnapshots(serverId, keepCount)` 清理窗口外旧数据
→ 默认 `snapshotRecentKeepCount` 是 120
→ `SnapshotScheduler.markRecentWritten` 记录本次写入时间
```

### 指标 archive 归档主链路

主入口：`packages/core/src/ingest/pipeline.ts` 中 archive 分支

```text
同一份 `processReport` 继续检查 archive 窗口
→ 使用 `snapshotArchiveIntervalSeconds` 判断是否到达归档时机
→ 默认归档间隔来自 `DEFAULT_SETTINGS`，当前是 1800 秒
→ `SnapshotScheduler.shouldWriteArchive(serverId, now, interval)` 返回 true
→ 调用 `saveSnapshot(serverId, report, 'archive', report.seq)`
→ 以 archive tier 写入长期历史快照
→ `SnapshotScheduler.markArchiveWritten` 记录本次归档时间
```

### 指标历史查询主链路

主入口：`packages/web/src/routes/metrics-routes.ts`

```text
UI 调用 `GET /api/metrics/latest`
→ `metrics-routes.ts` 调用 `pipeline.getLatestReports()`
→ 直接返回内存中的最新 report 视图

UI 调用 `GET /api/metrics/:serverId/history?from=&to=&tier=`
→ `metrics-routes.ts` 调用 `packages/core/src/db/snapshots.ts` 的 `getSnapshotHistory`
→ 从 `snapshots` 按时间区间读取基础快照行
→ 再按 `snapshot_id` 回查 `gpu_snapshots`
→ `mapSnapshotRow` 把数据库行重新组装成 `SnapshotWithGpus`
→ 返回给 UI 做历史曲线、快照回放和 GPU 详情展示
```

### 指标衍生链路主入口

主入口：`packages/core/src/ingest/pipeline.ts` 的 `processReport`

```text
同一份资源指标进入 `processReport`
→ 一路进入 `TaskEngine.processReport`，影响任务状态表和 `taskEvent`
→ 一路进入 `AlertEngine.processReport` 与 `reconcileAlerts`，产出 `alertStateChange`
→ 一路进入 `processSecurityCheck`，产出安全事件

这些都是基于同一份测量指标派生出来的副产物流
→ 但 latest cache、recent 窗口、archive 归档仍然是指标主存储链路
```

## WEB 当前边界

- WEB 模块当前应被视为完整后端，由 `packages/web` 接入编排层和 `packages/core` 领域内核层共同组成。
- 其中 `packages/web` 偏向协议接入与对外暴露，`packages/core` 偏向数据模型、存储、规则和聚合；两层边界目前总体清晰。
- Agent 和 UI 共用同一个服务进程，但走两套不同的 Socket.IO 接入面：Agent 使用 `/agent`，UI 使用根命名空间并要求 JWT。
- 前端静态资源由 WEB 服务直接托管，构建产物复制到 `packages/web/dist/public` 后和 API 一起发布。
- SQLite 默认跟随当前进程工作目录落到 `data/monitor.db`；按当前仓库的启动方式，开发态通常落在仓库根目录的 `data/` 下。
- 当前权限模型还很轻，只支持单密码初始化和固定 `admin` 角色，没有细粒度 RBAC。
- 节点在线状态在实时广播里可携带版本信息，但 REST `statuses` 接口当前返回的 `version` 仍为空字符串，这一层还没有完全统一。
- `task-routes.ts` 中的 `/gpu-overview` 目前仍是占位实现，说明任务视角的 GPU 聚合接口还没有真正下沉完成。
- 当前后端的调度决策仍主要在 Agent 侧完成，WEB 模块更多负责接收统一结果、维护历史与事件、提供查询和管理入口，而不是反向主导调度。
