# Web(Core) 模块架构

Web 和 Core 两个包共同构成服务端。Core 是纯逻辑库（不依赖 HTTP/Socket），Web 是运行时外壳。

## 职责划分

### Core（`packages/core`）

- 定义所有领域类型（`types.ts`）
- 提供数据库访问层（`db/`）
- 编排数据摄入流水线（`ingest/`）
- 任务管理查询和控制（`task/`）
- 告警管理查询和控制（`alert/`）
- 安全分析（`security/`）
- 人员通知等管理（`person/`）
- 管理 Agent 会话（`node/`）
- 定义 Agent ↔ Server 通信协议（`agent/`）
- 不依赖任何运行时框架，可被任意上层调用

### Web（`packages/web`）

- HTTP 服务器 + Socket.IO 双通道
- 路由层：把 HTTP 请求映射到 Core 函数
- Agent 接入层：处理 Agent WebSocket 注册和汇报
- UI 推送层：将 Core 产生的事件实时推送给前端
- 认证：双模式（管理员 JWT / 个人令牌 `pt_` 前缀），统一抽象为 `Principal`
  - `AdminPrincipal`：管理员，拥有全部访问权限
  - `PersonPrincipal`：普通用户，仅可访问其绑定节点和归属任务
  - `adminOnly` 中间件用于限制仅管理员可调用的路由
- 静态文件托管（UI 产物）

## 权限与 WebSocket 过滤

UI WebSocket 命名空间使用与 HTTP 相同的双模式认证。连接建立后，服务端根据 `socket.data.principal` 对每条推送事件做权限过滤：

| 事件 | 管理员 | 普通用户 |
|------|--------|----------|
| `metricsUpdate` | 全部 | 仅绑定节点 |
| `taskEvent` | 全部 | 仅归属任务 |
| `alertStateChange` | 全部 | 不推送 |
| `securityEvent` | 全部 | 不推送 |
| `serverStatus` | 全部 | 仅绑定节点 |
| `serversChanged` | 全部 | 全部 |

过滤逻辑集中在 `ui-broadcast.ts`，通过 `packages/core` 导出的 `canAccessServer` / `canAccessTask` 做权限判定。

## 人员令牌

- 令牌存储在 `person_tokens` 表，存 SHA-256 哈希，不存明文
- 令牌格式：`pt_` + 32 字节随机 base64url
- CRUD 操作在 `packages/core/src/db/person-tokens.ts`
- HTTP 路由在 `person-routes.ts`，均限 `adminOnly`


## 启动组装流程（`app.ts` → `createWebRuntime`）

1. 初始化 SQLite 数据库
2. 创建 `AgentSessionRegistry`（内存）
3. 创建 `AlertEngine`
4. 创建 `IngestPipeline`，注入四个回调（均转发给 `UIBroadcast`）
5. 挂载 HTTP 路由（`/api/*`），路由层直接调用 Core 导出的函数
6. 创建 Agent WebSocket 命名空间（`/agent`）
7. 创建 UI WebSocket 命名空间（`/`），附加认证中间件
8. 托管 UI 静态文件（如果存在）
9. 启动离线检测定时器（10s 间隔，调用 `AlertEngine.sweepOffline`）

## 相关文档

- [数据摄入链路](Web 数据摄入链路.md) — IngestPipeline 内部处理步骤
- [任务事件模型](任务事件模型.md) — 任务 diff 和事件生成
- [告警事件处理](告警事件处理.md) — 告警闭环状态机
