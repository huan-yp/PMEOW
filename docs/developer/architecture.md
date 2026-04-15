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
4. Agent 后续发送 `agent:metrics`、`agent:taskUpdate`、`agent:localUsers` 和 `agent:heartbeat`
5. Web 侧把 payload 规范化成已绑定的 `serverId`
6. `AgentDataSource` 把 snapshot 推给 `Scheduler.handleMetrics()`，任务更新进入任务镜像链路，`localUsers` 则更新人员绑定候选所需的本地用户库存

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

要注意 `agent:localUsers` 不走这条 `handleMetrics()` 链。它是独立侧带事件，直接更新服务端保存的节点本地用户清单，供人员绑定建议和归属解析使用。

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

- 每个 Agent daemon 只根据自己的本地 SQLite 队列做排队和出队
- 准入判断依赖本机 GPU 当前样本和历史窗口，而不是服务端跨节点仲裁
- `priority` 和 `created_at` 仍然是本地排序基础；服务端只负责下发变更，不负责替 Agent 重新决定 admission

## Agent 与服务端的关系

Agent 负责本地事实，服务端负责集群视图和最小控制面。

### Agent 负责

- 本地资源采集
- GPU 归属识别
- 本地任务队列
- 资源满足时启动子进程
- 任务状态和心跳上报
- 本地用户清单上报 `agent:localUsers`
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

Agent 节点也有自己的本地 SQLite 和日志目录，默认在 `~/.pmeow/`。

## 几条必须记住的系统约束

1. 服务端是观察者和干预点，不是全局调度器。
2. Agent 任务日志在节点本地，服务端只保存任务镜像和状态更新。
3. hostname 绑定要求精确匹配；重复服务器记录会导致自动绑定冲突，而完全未匹配时服务端会自动创建新的 agent 服务器记录。
4. `MetricsSnapshot.gpuAllocation` 是 Agent 模式下的重要扩展，但不是所有节点都会有。
5. 用户态看到的任务列表是服务端镜像，和节点本地事实之间通过 task update 保持同步。
6. 个人移动端和管理员登录是两套不同认证体系，不应混为同一权限面。

## 文档与设计档案的关系

如果你需要理解“为什么是现在这个结构”，应再去看 `docs/superpowers/` 下的设计档案。那部分解释的是设计背景；本页解释的是当前真实实现。