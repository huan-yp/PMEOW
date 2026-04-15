# 协议与 API 参考

这份文档聚焦当前仓库已经实现的对外接口，包括：

- Web 登录和 REST API
- 桌面端与移动端的认证边界
- UI Socket.IO 实时事件
- Agent namespace 事件和控制命令

## 认证模型

### 管理员 HTTP 登录

当前唯一公开管理员登录入口是：

```text
POST /api/login
```

行为如下：

- 如果数据库里还没有密码，这次登录会初始化密码并返回 token。
- 如果密码已存在，这次登录会校验密码并返回 token。

### 受保护的管理员 REST 路由

除了 `POST /api/login` 之外，管理员侧 `/api/*` 路由默认都会先经过 JWT 中间件。调用方需要带：

```text
Authorization: Bearer <token>
```

### 桌面端 UI Socket.IO

浏览器 namespace 是 `/`，握手时也要带 token。服务端会用和 REST 相同的 JWT 逻辑校验这个连接。

### Agent Socket.IO 连接

Agent namespace 是 `/agent`。当前实现没有使用 JWT，而是依赖：

- `agentId`
- `hostname`
- 服务端的 hostname 绑定逻辑
- 心跳维护的 live session 会话

这个模型适合受控内网，不应被当成公网零信任协议。

### 个人移动端 Token

个人移动端使用独立的 token 体系，不共用管理员 JWT。请求时带：

```text
X-PMEOW-Person-Token: pmt_<hex>
```

Token 由管理员通过 REST API 或桌面端人员详情页创建。服务端存储 SHA256 hash，明文仅在创建时返回一次。Token 支持轮换和吊销。

`/api/mobile/me/*` 这一组个人移动端路由在 Express 中挂载于管理员 JWT 中间件之前，因此不会触发管理员 JWT 校验。

## REST API 分组

### 公开路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/login` | 登录或首次初始化密码 |

### 服务器与基础监控

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/servers` | 列出服务器 |
| `GET` | `/api/servers/:id` | 获取单个服务器 |
| `POST` | `/api/servers` | 新建服务器 |
| `PUT` | `/api/servers/:id` | 更新服务器 |
| `DELETE` | `/api/servers/:id` | 删除服务器 |
| `POST` | `/api/servers/test` | 用未保存的表单数据测试 SSH 连接 |
| `POST` | `/api/servers/:id/test` | 对已保存服务器触发一次连接测试 |
| `GET` | `/api/metrics/latest` | 获取所有服务器的最新指标快照 `metrics` |
| `GET` | `/api/metrics/:serverId/history` | 获取单节点历史指标快照 `metrics` |
| `GET` | `/api/metrics/:serverId/history/bucketed` | 获取按时间桶聚合后的单节点历史指标 |
| `GET` | `/api/statuses` | 获取调度器维护的节点状态 `server status` |

### 钩子、设置、告警、密钥

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/hooks` | 列出钩子规则 |
| `POST` | `/api/hooks` | 新建钩子规则 |
| `PUT` | `/api/hooks/:id` | 更新钩子规则 |
| `DELETE` | `/api/hooks/:id` | 删除钩子规则 |
| `GET` | `/api/hooks/:id/logs` | 读取某条规则的执行日志 |
| `GET` | `/api/settings` | 获取设置，返回时会省略密码 hash |
| `PUT` | `/api/settings` | 保存设置并重启 scheduler |
| `GET` | `/api/alerts` | 读取告警历史 |
| `POST` | `/api/alerts/batch/suppress` | 批量抑制告警 |
| `POST` | `/api/alerts/batch/unsuppress` | 批量取消抑制 |
| `POST` | `/api/alerts/:id/suppress` | 抑制一条告警 |
| `POST` | `/api/alerts/:id/unsuppress` | 取消抑制一条告警 |
| `POST` | `/api/keys/upload` | 上传 SSH 私钥文件 |

### Agent 节点读写接口

这些路由面向“以某个服务器为中心”的任务读取和控制：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/servers/:id/tasks` | 读取该服务器的任务镜像列表 |
| `GET` | `/api/servers/:id/tasks/:taskId` | 读取单个任务镜像 |
| `GET` | `/api/servers/:id/tasks/:taskId/events` | 通过 live Agent session 拉取任务事件流 |
| `GET` | `/api/servers/:id/gpu-allocation` | 读取该服务器的最新 GPU allocation |
| `GET` | `/api/servers/:id/gpu-allocation/resolved` | 读取带人员归属解析的 GPU allocation |
| `POST` | `/api/servers/:id/tasks/:taskId/cancel` | 取消任务 |
| `POST` | `/api/servers/:id/queue/pause` | 暂停队列 |
| `POST` | `/api/servers/:id/queue/resume` | 恢复队列 |
| `POST` | `/api/servers/:id/tasks/:taskId/priority` | 调整任务优先级 |

这些控制接口以及任务事件拉取接口只有在目标服务器已绑定到 live Agent session 时才会成功，否则会返回 `409`。

### 运维视角接口

这些路由更偏向跨节点运维视图：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/task-queue` | 读取跨节点任务分组 |
| `GET` | `/api/gpu-overview` | 读取集群级 GPU 使用概览 |
| `GET` | `/api/gpu-usage/summary` | 按用户汇总 GPU 使用 |
| `GET` | `/api/gpu-usage/by-user` | 按用户读取时间线 |
| `GET` | `/api/gpu-usage/by-user/bucketed` | 按用户读取按桶聚合后的时间线 |
| `GET` | `/api/servers/:id/process-audit` | 读取单节点进程审计结果 |
| `GET` | `/api/security/events` | 读取安全事件 |
| `POST` | `/api/security/events/:id/mark-safe` | 标记事件为安全 |
| `POST` | `/api/security/events/:id/unresolve` | 重新打开一个已标记为安全的事件 |

### 人员相关接口

人员归属 `Person attribution` 是可选层。即使没有任何人员记录，这组 API 也会尽量返回空结果，而不会影响已有监控和任务链路。

#### 人员档案

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/persons` | 列出所有人员 |
| `GET` | `/api/persons/summary?hours=168` | 人员汇总（显存、任务数） |
| `POST` | `/api/persons` | 新建人员 |
| `GET` | `/api/persons/:id` | 读取单个人员 |
| `PUT` | `/api/persons/:id` | 更新人员 |

#### 绑定关系

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/persons/:id/bindings` | 读取某个人员的绑定关系 |
| `GET` | `/api/person-binding-candidates` | 读取节点上报的本地用户候选 |
| `POST` | `/api/person-bindings` | 新建绑定 |
| `PUT` | `/api/person-bindings/:id` | 更新绑定 |
| `GET` | `/api/person-binding-suggestions` | 获取系统自动检测到的未绑定用户建议 |

#### 统计与时间线

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/persons/:id/timeline?hours=168` | 某个人员的显存时间线 |
| `GET` | `/api/persons/:id/tasks?hours=168` | 与某个人员关联的任务 |
| `GET` | `/api/persons/:id/node-distribution?hours=168` | 某个人员的节点分布 |
| `GET` | `/api/persons/:id/peak-periods?hours=168&top=3` | 某个人员的高峰使用时段 |
| `GET` | `/api/servers/:id/person-activity` | 某台服务器上的人员活动概览 |

#### 个人移动端令牌管理

这些接口要求管理员 JWT：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/persons/:id/mobile-token` | 为某个人员创建移动端令牌 |
| `POST` | `/api/persons/:id/mobile-token/rotate` | 轮换令牌 |
| `DELETE` | `/api/persons/:id/mobile-token` | 吊销令牌 |
| `GET` | `/api/persons/:id/mobile-token/status` | 读取令牌存在状态和最近使用信息 |

### 管理员移动端接口

这些路由服务于 `/m/admin`，认证仍然使用管理员 JWT。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/mobile/admin/summary` | 集群摘要（节点数、任务数） |
| `GET` | `/api/mobile/admin/tasks` | 跨节点任务列表 |
| `GET` | `/api/mobile/admin/servers` | 节点列表与在线状态 |
| `GET` | `/api/mobile/admin/notifications` | 管理员通知流，当前实现直接返回最近告警 |

### 个人移动端接口

这些路由服务于 `/m/me`。认证使用 `X-PMEOW-Person-Token`，而不是管理员 JWT。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/mobile/me/bootstrap` | 个人首页初始化 `bootstrap` 数据 |
| `GET` | `/api/mobile/me/tasks` | 当前人员自己的任务列表 |
| `GET` | `/api/mobile/me/servers` | 当前人员绑定的节点列表 |
| `GET` | `/api/mobile/me/notifications` | 个人通知流 |
| `GET` | `/api/mobile/me/preferences` | 通知偏好设置 |
| `PUT` | `/api/mobile/me/preferences` | 更新通知偏好设置 |
| `POST` | `/api/mobile/me/tasks/:taskId/cancel` | 取消自己名下的任务 |
| `POST` | `/api/mobile/me/notifications/:id/read` | 标记通知已读 |

## UI 实时事件

浏览器连接到 `/` namespace 后，会收到下面几类事件：

| 事件名 | 含义 |
| --- | --- |
| `metricsUpdate` | 最新指标快照 |
| `serverStatus` | 连接状态更新 |
| `securityEvent` | 安全事件更新 |
| `alert` | 告警触发 |
| `hookTriggered` | 钩子执行日志 |
| `taskUpdate` | Agent 任务状态变更 |
| `serversChanged` | 服务器清单发生变化，例如首次 Agent 自动建档 |

这些事件大多来自 `Scheduler` 或 Agent namespace 的桥接逻辑。

## Agent namespace 事件

### Agent 发往服务端

当前 Agent transport 会向 `/agent` namespace 发送：

| 事件名 | 主要字段 | 说明 |
| --- | --- | --- |
| `agent:register` | `agentId`, `hostname`, `version` | 首次连接或重连注册 |
| `agent:metrics` | `MetricsSnapshot` | 周期性指标推送 |
| `agent:taskUpdate` | `taskId`, `status`, `pid`, `exitCode`, 时间戳等 | 任务状态变更 |
| `agent:localUsers` | `timestamp`, `users[]` | 节点本地用户清单，用于绑定候选和归属解析 |
| `agent:heartbeat` | `agentId`, `timestamp` | 心跳 |

注意两个细节：

- Python Agent 的 heartbeat 时间戳来自 `time.time()`，单位是秒。
- Web 侧会在比较超时前先把它规范化成毫秒。

### 服务端发往 Agent

当前服务端会把内部命令 envelope 展开成 Socket.IO 事件名和 payload，发给目标 Agent：

| 事件名 | 主要字段 | 说明 |
| --- | --- | --- |
| `server:cancelTask` | `taskId` | 取消任务 |
| `server:getTaskEvents` | `taskId`, `afterId?` | 拉取任务事件流 |
| `server:pauseQueue` | 无或空 payload | 暂停队列 |
| `server:resumeQueue` | 无或空 payload | 恢复队列 |
| `server:setPriority` | `taskId`, `priority` | 调整优先级 |

## 绑定与规范化规则

Agent namespace 当前做了几层重要规范化：

1. `agent:register` 后，会根据 `agentId + hostname` 建立 live session 会话。
2. 服务端调用 `resolveAgentBinding()`，根据 hostname 尝试解析到唯一服务器记录。
3. 如果 hostname 没有匹配到已有服务器记录，当前实现会自动创建新的 `sourceType=agent` 服务器记录，并用 peer ip 作为 `host`。
4. 如果绑定成功，之后收到的 metrics、task update 和 local users 都会被规范化为绑定后的 `serverId`。
5. 如果 Agent 断开连接或心跳超时，服务端会把 live session 会话从对应 `AgentDataSource` 上摘除。

这意味着如果 Agent 自己上报了错误的 `serverId`，但 hostname 绑定是正确的，Web 侧仍然会用已绑定的 `serverId` 继续处理。

## 共享模型里最常见的几个概念

### `ServerConfig.sourceType`

表示当前服务器记录的数据源模式，只可能是：

- `ssh`
- `agent`

### `MetricsSnapshot.gpuAllocation`

这是 Agent 模式下的重要扩展字段，用来表达：

- 每张卡上 PMEOW 任务的占用
- 普通用户进程的占用
- 未知进程的占用
- 每张卡的有效剩余显存

### `AgentTaskUpdatePayload`

这是服务端维护任务镜像的核心输入，至少包含：

- `serverId`
- `taskId`
- `status`

并可携带命令、用户、GPU 分配、时间戳、退出码和 PID 等字段。

### `AgentLocalUsersPayload`

这是人员绑定候选和归属解析的重要侧带输入，至少包含：

- `serverId`
- `agentId`
- `timestamp`
- `users[]`

## 一个容易误解的点

设置页中的 `apiEnabled`、`apiPort`、`apiToken` 字段当前仍更多是 settings 模型的一部分，而不是一套独立的对外 API 网关。当前仓库实际可用的 Web API 仍然由主服务端口统一承载。