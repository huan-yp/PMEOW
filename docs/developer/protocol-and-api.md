# 协议与 API 参考

这份文档聚焦当前仓库已经实现的对外接口，包括：

- Web 登录和 REST API
- UI Socket.IO 实时事件
- Agent namespace 事件和控制命令

## 认证模型

### HTTP 登录

当前唯一公开登录入口是：

```text
POST /api/login
```

行为如下：

- 如果数据库里还没有密码，这次登录会初始化密码并返回 token。
- 如果密码已存在，这次登录会校验密码并返回 token。

### 受保护的 REST 路由

除了 `POST /api/login` 之外，`/api/*` 都会先经过 JWT 中间件。调用方需要带：

```text
Authorization: Bearer <token>
```

### UI Socket.IO

浏览器 namespace 是 `/`，握手时也要带 token。服务端会用和 REST 相同的 JWT 逻辑校验它。

### Agent Socket.IO

Agent namespace 是 `/agent`。当前实现没有使用 JWT，而是依赖：

- `agentId`
- `hostname`
- 服务端的 hostname 绑定逻辑
- 心跳维护的 live session

这个模型适合受控内网，不应被当成公网零信任协议。

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
| `GET` | `/api/metrics/latest` | 获取所有服务器的最新 metrics |
| `GET` | `/api/metrics/:serverId/history` | 获取单节点历史 metrics |
| `GET` | `/api/statuses` | 获取调度器维护的 server status |

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
| `POST` | `/api/alerts/:id/suppress` | 抑制一条告警 |
| `POST` | `/api/keys/upload` | 上传 SSH 私钥文件 |

### Agent 节点读写接口

这些路由面向“以某个服务器为中心”的任务读取和控制：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/servers/:id/tasks` | 读取该服务器的任务镜像列表 |
| `GET` | `/api/servers/:id/tasks/:taskId` | 读取单个任务镜像 |
| `GET` | `/api/servers/:id/gpu-allocation` | 读取该服务器的最新 GPU allocation |
| `POST` | `/api/servers/:id/tasks/:taskId/cancel` | 取消任务 |
| `POST` | `/api/servers/:id/queue/pause` | 暂停队列 |
| `POST` | `/api/servers/:id/queue/resume` | 恢复队列 |
| `POST` | `/api/servers/:id/tasks/:taskId/priority` | 调整任务优先级 |

这些控制接口只有在目标服务器已绑定到 live Agent session 时才会成功，否则会返回 `409`。

### Operator 视角接口

这些路由更偏向跨节点运维视图：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/task-queue` | 读取跨节点任务分组 |
| `GET` | `/api/gpu-overview` | 读取集群级 GPU 使用概览 |
| `GET` | `/api/gpu-usage/summary` | 按用户汇总 GPU 使用 |
| `GET` | `/api/gpu-usage/by-user` | 按用户读取时间线 |
| `GET` | `/api/servers/:id/process-audit` | 读取单节点进程审计结果 |
| `GET` | `/api/security/events` | 读取安全事件 |
| `POST` | `/api/security/events/:id/mark-safe` | 标记事件为安全 |

### Person APIs

Endpoints for person attribution management. All person data is optional — when no person records exist, the API returns empty arrays and existing monitoring continues unchanged.

#### Person management

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/persons` | List all persons |
| `POST` | `/api/persons` | Create a person |
| `GET` | `/api/persons/:id` | Get a person by ID |
| `PUT` | `/api/persons/:id` | Update a person |

#### Person bindings

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/persons/:id/bindings` | List bindings for a person |
| `POST` | `/api/person-bindings` | Create a binding |
| `PUT` | `/api/person-bindings/:id` | Update a binding |
| `GET` | `/api/person-binding-suggestions` | Auto-detected unbound users |

#### Person statistics

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/persons/summary?hours=168` | Person summary (VRAM, tasks) |
| `GET` | `/api/persons/:id/timeline?hours=168` | VRAM timeline for a person |
| `GET` | `/api/persons/:id/tasks?hours=168` | Tasks associated with a person |
| `GET` | `/api/servers/:id/person-activity` | Person activity on a server |

#### Compatibility note

When no person data exists, existing monitoring and task APIs work unchanged. Person-aware webhook template variables (`{{personName}}`, `{{personEmail}}`, etc.) resolve to empty strings when no person is matched.

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

这些事件大多来自 `Scheduler` 或 Agent namespace 的桥接逻辑。

## Agent namespace 事件

### Agent 发往服务端

当前 Agent transport 会向 `/agent` namespace 发送：

| 事件名 | 主要字段 | 说明 |
| --- | --- | --- |
| `agent:register` | `agentId`, `hostname`, `version` | 首次连接或重连注册 |
| `agent:metrics` | `MetricsSnapshot` | 周期性指标推送 |
| `agent:taskUpdate` | `taskId`, `status`, `pid`, `exitCode`, 时间戳等 | 任务状态变更 |
| `agent:heartbeat` | `agentId`, `timestamp` | 心跳 |

注意两个细节：

- Python Agent 的 heartbeat 时间戳来自 `time.time()`，单位是秒。
- Web 侧会在比较超时前先把它规范化成毫秒。

### 服务端发往 Agent

当前服务端会把内部命令 envelope 展开成 Socket.IO 事件名和 payload，发给目标 Agent：

| 事件名 | 主要字段 | 说明 |
| --- | --- | --- |
| `server:cancelTask` | `taskId` | 取消任务 |
| `server:pauseQueue` | 无或空 payload | 暂停队列 |
| `server:resumeQueue` | 无或空 payload | 恢复队列 |
| `server:setPriority` | `taskId`, `priority` | 调整优先级 |

## 绑定与规范化规则

Agent namespace 当前做了几层重要规范化：

1. `agent:register` 后，会根据 `agentId + hostname` 建立 live session。
2. 服务端调用 `resolveAgentBinding()`，根据 hostname 尝试解析到唯一服务器记录。
3. 如果绑定成功，之后收到的 metrics 和 task update 都会被规范化为绑定后的 `serverId`。
4. 如果 Agent 断开连接或心跳超时，服务端会把 live session 从对应 `AgentDataSource` 上摘除。

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

## 一个容易误解的点

设置页中的 `apiEnabled`、`apiPort`、`apiToken` 字段当前仍更多是 settings 模型的一部分，而不是一套独立的对外 API 网关。当前仓库实际可用的 Web API 仍然由主服务端口统一承载。