# 当前架构概览

这份文档描述的是当前已经落地的 PMEOW 运行模型，而不是理想化的未来目标。

## 运行层次

PMEOW 现在由四个主要部分组成：

1. `packages/ui`：React 前端，给管理员提供 Web 控制台。
2. `packages/web`：Express + Socket.IO Web 服务，承载认证、REST API、UI 实时事件和 Agent namespace。
3. `packages/core`：共享核心逻辑，负责数据模型、SQLite、数据源抽象、调度器、告警、钩子和安全处理。
4. `agent/`：独立 Python Agent，运行在计算节点本地，负责采集、任务队列、自主调度、执行器和 Socket.IO 通信。

## 仓库结构和职责划分

当前 Monorepo 的核心布局是：

```text
packages/
  core/   共享模型、SQLite、datasource、scheduler、alerts、security
  ui/     React UI
  web/    Express + Socket.IO 服务端
agent/    Python Agent，独立于 pnpm workspace
```

这个划分背后的约束很明确：

- `core` 是 TypeScript 侧的共享事实来源。
- `web` 负责把 `core` 暴露成 HTTP 与 Socket.IO 接口。
- `ui` 只消费 Web 暴露的状态和操作。
- `agent` 不进入 pnpm workspace，它有自己独立的 Python 依赖和测试体系。

## 两种节点数据源

服务端通过 `NodeDataSource` 抽象同时支持两类节点：

- `ssh`：服务端主动通过 SSH 采集指标。
- `agent`：计算节点主动把指标推送到服务端。

单个服务器记录同一时刻只应有一种活跃数据源。服务端不会并行把 SSH 和 Agent 结果混在一起。

### SSH 节点

- 由 `Scheduler` 的定时器主动轮询
- 通过 `SSHDataSource` 和 SSHManager 连接
- 采集结果直接进入 `saveMetrics`

### Agent 节点

- Agent 连接 `/agent` namespace
- 服务端通过 hostname 解析绑定关系
- 指标不是被轮询，而是由 Agent 主动推送
- 指标进入 `AgentDataSource.pushMetrics()` 后触发 `metricsReceived`

## 核心数据流

### 浏览器到服务端

- 浏览器先通过 `POST /api/login` 获取 token
- 后续所有 `/api/*` 请求都走 Bearer token
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
4. Agent 后续发送 `agent:metrics`
5. Web 侧把 payload 规范化成已绑定的 `serverId`
6. `AgentDataSource` 把 snapshot 推给 `Scheduler.handleMetrics()`

### 统一的后处理链路

无论数据来自 SSH 还是 Agent，进入 `handleMetrics()` 后都会按同一顺序继续处理：

1. 持久化 metrics 或 agent 扩展数据
2. 更新内存中的 server status
3. 广播 `metricsUpdate` 给 UI
4. 执行告警检查
5. 执行安全快照处理
6. 异步执行钩子规则

这个顺序很重要。调试时如果发现 UI 有数据但数据库没更新，或者 security event 缺失，应该优先沿着这条链路逐段确认。

## Scheduler 的职责边界

当前 `Scheduler` 的职责是：

- 管理 data source 生命周期
- 轮询 SSH 节点
- 接收 Agent 指标事件
- 统一触发持久化、告警、钩子和安全处理

它不负责：

- 为 Agent 节点生成任务
- 在服务端重新排队或抢占任务
- 维护任务日志正文

这条边界不能轻易打破。PMEOW 的任务调度主体仍然是节点本地的 Python Agent。

## Agent 与服务端的关系

Agent 负责本地事实，服务端负责集群视图和最小控制面。

### Agent 负责

- 本地资源采集
- GPU 归属识别
- 本地任务队列
- 资源满足时启动子进程
- 任务状态和心跳上报

### 服务端负责

- 维护跨节点的任务镜像视图
- 展示 GPU overview 和 process audit
- 暴露取消、暂停、恢复和调整优先级的控制 API
- 记录安全事件和告警历史

## 持久化模型

服务端主存储是 SQLite，关键表包括：

- `servers`
- `metrics`
- `hooks`
- `hook_logs`
- `settings`
- `alert_history`
- `agent_tasks`
- `gpu_usage_stats`
- `security_events`
- `persons`
- `person_server_bindings`

Person attribution 是一个可选层：`persons` 表存储人员档案，`person_server_bindings` 表把人员与服务器上的操作系统用户名关联起来。钩子和统计查询通过 `resolvePersonForTask()` 在运行时把任务归属到人员，如果没有任何 person 记录，所有原有逻辑保持不变。

这意味着当前系统更接近单实例、实验室规模的运维平台，而不是面向高并发多租户的控制平面。

Agent 节点也有自己的本地 SQLite 和日志目录，默认在 `~/.pmeow/`。

## 鉴权与会话

### Web 侧

- `POST /api/login` 是唯一公开入口
- `/api/*` 路由统一走 JWT 中间件
- UI Socket.IO namespace `/` 也要求 token

### Agent 侧

当前 `/agent` namespace 不使用 JWT。服务端主要依赖：

- `agentId`
- `hostname`
- 心跳维护的 live session
- hostname 到 `servers.host` 的精确绑定

因此，Agent 的安全边界更偏向受控内网和可信节点场景，而不是公网暴露场景。

## 几条必须记住的系统约束

1. 服务端是观察者和干预点，不是全局调度器。
2. Agent 任务日志在节点本地，服务端只保存任务镜像和状态更新。
3. hostname 绑定要求精确匹配，重复服务器记录会导致自动绑定失败。
4. `MetricsSnapshot.gpuAllocation` 是 Agent 模式下的重要扩展，但不是所有节点都会有。
5. 用户态看到的任务列表是服务端镜像，和节点本地事实之间通过 task update 保持同步。

## 文档与设计档案的关系

如果你需要理解“为什么是现在这个结构”，应再去看 `docs/superpowers/specs/2026-04-01-pmeow-v2-design.md`。那份文档解释的是设计背景；本页解释的是当前真实实现。