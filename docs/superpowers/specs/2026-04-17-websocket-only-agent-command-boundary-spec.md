# Web 到 Agent 仅 WebSocket 命令边界规范

日期：2026-04-17

## 背景

当前任务审计请求 `GET /api/servers/:id/tasks/:taskId/audit` 在用户侧出现了 `500 Internal Server Error`。静态排查后的事实如下：

1. 当前实现中，浏览器到 Web 服务使用 HTTP/REST。
2. Web 服务到 agent 的任务审计读取已经是通过 live agent session 上的 Socket.IO command `server:getTaskAuditDetail` 完成，而不是通过 HTTP 请求 agent。
3. agent 侧已经实现 `server:getTaskAuditDetail` 的处理，并返回结构化审计数据。
4. 当前问题的根因方向不是“传输通道走错”，而是“server 到 agent 的命令边界、能力合同与错误映射没有统一收口”，导致本应属于可预期业务失败的场景仍可能暴露成 `500`。

本规范不改变“浏览器到 Web 仍可使用 REST facade”的设计，只收紧并统一“Web 到 agent 只能走 WebSocket 命令”的约束和相关错误模型。

## 目标

本次规范目标有 6 条：

1. 明确 Web 服务到 agent 的所有读写命令只能通过 WebSocket live session 传输。
2. 明确不允许服务端新增任何对 agent 的 HTTP 拉取实现或 fallback。
3. 将审计详情、任务事件、取消任务、暂停队列、恢复队列、修改优先级这 6 类 server 到 agent 命令统一纳入同一套边界规则。
4. 将 offline、timeout、not_supported、not_found、invalid_target 等预期失败从 `500` 中分离出来，映射为稳定的业务错误状态码。
5. 不兼容旧 agent 的降级回退路径；若命令未实现，必须明确返回“不支持”，而不是伪装成通用失败。
6. 为后续实现和回归测试提供统一验收标准，避免只修复任务审计接口而其他命令仍保留旧行为。

## 非目标

本次不做以下事项：

1. 不将浏览器到 Web 的 REST 接口全部改造成浏览器到 WebSocket。
2. 不重做 UI 任务审计详情页的信息架构。
3. 不扩展 SSH 节点的任务审计能力。
4. 不为旧 agent 增加兼容降级或回退到任务镜像加事件拼装的替代逻辑。
5. 不引入新的服务间传输层或额外 command gateway 进程。

## 方案选择

本规范采用以下方案：

- 保留浏览器到 Web 的 REST facade。
- 统一 Web 到 agent 的内部命令层，唯一合法传输方式是 live agent session 上的 WebSocket command。
- 对外 REST 路由只作为 facade，不承担 transport fallback、旧版本兼容或 agent 细节拼装。

未采用的方案：

1. 浏览器到 Web 也全部改为 WebSocket。该方案改动面过大，且不是当前 500 问题的根因。
2. 为 server 到 agent 单独抽出独立命令网关进程。当前问题不需要引入新的部署单元。

## 架构概览

系统边界按三层定义：

1. 浏览器到 Web：允许 HTTP/REST 或浏览器 namespace WebSocket，属于前端消费边界。
2. Web 到 agent：只允许通过 `/agent` live session 发送 WebSocket command，并等待 ack/response。
3. agent 本地控制面：agent 可继续通过本地 daemon socket 为 CLI 提供本机接口，但这不属于中心 Web 到 agent 通信。

硬约束如下：

1. Web 服务不得直接对 agent 暴露的任何 HTTP 地址发起请求来获取任务、审计、事件、日志或队列状态。
2. Web 服务不得为任何 server 到 agent 命令增加 HTTP fallback。
3. 一个命令如果没有 live session，必须失败，而不是尝试绕过 live session 去找其他通道。
4. 一个命令如果 agent 未声明支持，必须返回明确的不支持错误，而不是继续发送后依赖运行时异常。

## Core Components

### 1. Route Facade

REST 路由层职责仅限于：

1. 鉴权。
2. 路径参数与请求体校验。
3. 校验目标 server 是否属于 agent 命令节点。
4. 将请求委托给统一命令层。
5. 将统一命令层返回的内部错误映射成 HTTP 响应。

Route facade 不负责：

1. 直接操作 WebSocket session。
2. 用字符串匹配错误消息来决定状态码。
3. 为单个命令私自定义特例化 fallback。

### 2. Agent Command Service

统一命令层负责：

1. 根据 serverId 获取 live agent session。
2. 校验目标命令是否在支持能力集合中。
3. 发起 request/emit。
4. 处理 ack、超时和断线。
5. 将 transport 层异常转换成稳定的内部错误类型。

该层是所有 server 到 agent 命令的唯一入口。

### 3. Capability Contract

需要为每个 server 到 agent 命令建立显式能力合同。至少包含：

1. `getTaskEvents`
2. `getTaskAuditDetail`
3. `cancelTask`
4. `pauseQueue`
5. `resumeQueue`
6. `setPriority`

能力合同必须是显式结构，而不是“对象上碰巧有某个方法”。

目的有两点：

1. 防止像 `getTaskAuditDetail` 这样新增命令时，路由边界未同步收口，最后在运行时才暴露成 `500`。
2. 为不兼容旧 agent 的错误语义提供稳定依据。

### 4. Protocol Layer

协议层继续定义 command name、payload 和 response 结构。它负责：

1. 维持 Web 和 agent 对同一命令的名称一致性。
2. 维持 payload/response 形状一致。
3. 为 capability contract 提供对应的命令标识。

协议层不负责错误映射；错误映射属于统一命令层与 route facade 的职责。

### 5. Error Mapping Layer

内部错误必须是可枚举、可测试的类型，而不是依赖文本匹配。最少应覆盖：

1. `offline`
2. `timeout`
3. `not_supported`
4. `not_found`
5. `invalid_target`
6. `invalid_input`
7. `internal`

## 数据流

所有 server 到 agent 命令共享同一套数据流：

1. UI 调用 Web REST facade，例如任务审计、任务事件、取消任务或队列控制。
2. Route facade 完成参数、权限和目标节点校验。
3. Route facade 调用统一命令层，而不是直接访问具体 data source 细节。
4. 统一命令层解析 serverId 对应的 live agent session。
5. 统一命令层校验目标命令是否受支持。
6. 命令通过 WebSocket command 发送到 agent。
7. agent 返回 ack/response，或发生超时/断线。
8. 统一命令层将 transport 结果转换为内部错误类型或成功结果。
9. Route facade 将结果映射为稳定的 HTTP 响应。

这条链路中没有任何一步允许替换为 HTTP 到 agent 的直连请求。

## 错误处理规范

### HTTP 状态码映射

以下语义必须固定：

1. `400 Bad Request`：参数非法。
2. `404 Not Found`：task 不存在，或 task 不属于指定 server。
3. `409 Conflict`：目标 server 不是 agent 命令节点，或 live session 当前离线。
4. `501 Not Implemented`：agent 版本不支持该命令。
5. `504 Gateway Timeout`：agent 请求超时。
6. `500 Internal Server Error`：仅限未分类的服务端缺陷或真正的内部异常。

### 错误消息规范

对外消息需要可读且稳定，至少覆盖：

1. `Agent 未在线`
2. `目标节点不支持该命令`
3. `Agent 版本不支持此命令`
4. `Agent 响应超时`
5. `任务不存在`

错误消息不应直接暴露底层 transport 异常原文。

### 禁止事项

1. 不允许继续使用 `error.message.includes('is offline')` 这样的字符串匹配做错误分类。
2. 不允许将所有命令异常统一 catch 后返回 `500`。
3. 不允许让 UI 自己猜测“这是离线、超时还是不支持”。

## 命令覆盖范围

本规范统一覆盖以下命令：

1. 读取任务事件。
2. 读取任务审计详情。
3. 取消任务。
4. 暂停队列。
5. 恢复队列。
6. 修改优先级。

任何未来新增的 server 到 agent 命令，也必须接入同一套 capability contract、错误类型和测试矩阵后才能对外暴露。

## 节点能力边界

该能力是 Agent-only capability。

规则如下：

1. 只有 `agent` 类型节点允许进入 server 到 agent 命令链路。
2. `ssh` 类型节点不得伪装为可发送这些命令的目标。
3. 对不满足条件的目标节点，必须在 route facade 或统一命令层前置失败，返回 `409`，而不是进入后续 transport 流程。

## 审计详情接口的专门要求

虽然本规范覆盖全部 server 到 agent 命令，但本轮问题首先暴露在任务审计详情接口，因此该接口额外要求：

1. `GET /api/servers/:id/tasks/:taskId/audit` 只能作为 facade，不能自己拼接降级数据。
2. 当 agent 不支持 `getTaskAuditDetail` 时，必须明确返回 `501`，而不是落成 `500`。
3. 当 task 不存在时，必须返回 `404`。
4. 当 agent 离线时，必须返回 `409`。
5. 当 agent 超时未响应时，必须返回 `504`。

## 测试策略

### 1. 公共成功路径

Web 集成测试至少覆盖以下命令的成功路径：

1. `getTaskEvents`
2. `getTaskAuditDetail`
3. `cancelTask`
4. `pauseQueue`
5. `resumeQueue`
6. `setPriority`

### 2. 公共失败矩阵

每个命令都应尽量复用同一套失败测试矩阵，至少包括：

1. agent 离线。
2. agent 不支持命令。
3. agent 响应超时。
4. 目标任务不存在。
5. 参数非法。
6. 目标节点类型错误。

### 3. 合同测试

需要新增或补齐以下合同测试：

1. capability contract 未声明的命令不得被 route facade 继续调用。
2. route facade 不得依赖字符串匹配错误消息。
3. Web 到 agent 命令只通过定义好的 WebSocket command 发出。
4. 协议文档与实现中的命令集合保持一致。

### 4. 回归重点

回归重点不是只看任务审计接口恢复可用，而是确认所有 server 到 agent 命令都不再把预期失败漏成 `500`。

## 文档要求

以下文档需要与本规范保持一致：

1. 开发协议文档必须明确写出“Web 到 agent 仅允许 WebSocket command”。
2. 与任务审计相关的设计文档需要引用这条边界，而不是重复发明 transport 规则。
3. 如果后续新增命令，必须同步更新协议文档和能力合同清单。

## 验收标准

本规范的实现完成后，应满足以下验收条件：

1. 任务审计请求不再因离线、超时、未支持、未找到而返回 `500`。
2. 任务事件、取消、暂停、恢复、优先级调整与审计详情采用同一套错误分类规则。
3. Web 代码中不存在新增的对 agent HTTP 拉取逻辑。
4. 对旧 agent 的不支持场景会明确返回 `501`。
5. 对 SSH 节点或非 agent 命令目标会明确返回 `409`。
6. 测试覆盖公共成功路径与公共失败矩阵。
7. 协议和开发文档与实现一致。

## 风险与取舍

本规范的主要取舍如下：

1. 不兼容旧 agent 会要求部署时同步升级，但能显著降低服务端为了兼容旧命令集而产生的分支复杂度。
2. 保留 REST facade 意味着前端无需同步重写 transport，但 Web 内部必须承担清晰的错误映射职责。
3. 将全部 server 到 agent 命令统一收口，会比只修一条审计路由多一些改动，但能避免同类问题在其他命令上重复出现。

## 实施范围建议

建议将实现拆成一个清晰开发周期完成，最小顺序如下：

1. 收口 capability contract 与统一内部错误类型。
2. 让全部 server 到 agent 命令接入统一命令层。
3. 修正 route facade 的状态码映射。
4. 增补 Web 集成测试与合同测试。
5. 同步更新开发协议文档。

本规范到此为止，后续实现应严格以本页作为边界依据。