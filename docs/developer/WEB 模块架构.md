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
	- `alert-routes.ts`：告警查询、单条和批量静默/取消静默。
	- `security-routes.ts`：安全事件查询、标记安全、取消处置。
	- `settings-routes.ts`：系统设置读取和更新。
- `scripts/copy-ui-dist.mjs`
	- 负责构建阶段把 `packages/ui/dist` 复制到 `packages/web/dist/public`。
	- 让 WEB 模块在同一进程里同时提供 API、WebSocket 和前端静态资源。
- `core/src/db/`
	- 承载持久化访问层。
	- `database.ts` 负责 SQLite 初始化、schema 建立、数据库自检和异常库迁移。
	- `servers.ts`、`snapshots.ts`、`tasks.ts`、`alerts.ts`、`security-events.ts`、`persons.ts`、`person-bindings.ts`、`settings.ts` 负责各领域表的读写。
	- 其中 `alerts.ts` 同时承载告警闭环状态机：按 `(serverId, alertType, fingerprint)` 对齐当前异常集合，维护 `ACTIVE / RESOLVED / SILENCED` 三态，以及 `alert_transitions` 状态变迁历史。
- `core/src/ingest/`
	- 承载 Agent 汇报落库与事件化主链路。
	- `pipeline.ts` 负责 latest cache、任务 diff、告警候选收集、告警状态闭环、安全检查和快照写入总编排。
	- `snapshot-scheduler.ts` 负责 recent / archive 两层窗口写入节流。
	- `task-differ.ts` 负责把前后两份任务队列差异转成 started / updated / ended 等事件。
- `core/src/task/`
	- 承载任务领域服务。
	- 负责任务查询、任务控制命令封装，以及把取消/调优请求通过在线 session 回发给 Agent。
- `core/src/alert/`
	- 承载告警领域逻辑。
	- `service.ts` 负责 CPU / 内存 / 磁盘 / GPU 温度阈值异常候选，以及离线异常候选生成。
	- `gpu-idle-tracker.ts` 负责空闲显存类异常候选生成。
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
→ diff 任务队列并持久化任务状态
→ 收集阈值类与空闲显存类异常候选
→ 与当前告警状态做 reconcile，生成 `ACTIVE / RESOLVED / SILENCED` 状态变迁
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
新的 `UnifiedReport` 到达
→ `service.ts` 生成 CPU / 内存 / 磁盘 / GPU 温度异常候选
→ `gpu-idle-tracker.ts` 生成空闲显存异常候选
→ `db/alerts.ts.reconcileAlerts` 以 `(serverId, alertType, fingerprint)` 为复合键，对比“当前候选集合”和“数据库中当前告警状态”
→ 对同一条告警记录执行状态闭环：新出现异常进入 `ACTIVE`，异常消失转 `RESOLVED`，人工静默转 `SILENCED`
→ 每次状态变化写入 `alert_transitions` 历史表
→ 通过 WebSocket 推送 `alertStateChange` 事件给 UI

同一份汇报继续进入安全分析
→ 生成安全 finding
→ 仅当没有同指纹未解决事件时创建新的安全事件
→ 写入数据库并推送 `securityEvent`

WEB 运行时每 10 秒执行一次离线检查
→ 根据 `lastReportAt` 生成 offline 异常候选
→ 同样通过 `reconcileAlerts` 进入统一告警闭环
→ 把离线产生的状态变化也作为 `alertStateChange` 推送 UI
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
