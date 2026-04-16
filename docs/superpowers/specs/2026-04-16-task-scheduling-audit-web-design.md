# 任务调度审计 Web 设计

## 目标

本设计聚焦两个直接问题：

1. Web 管理端无法审计任务为什么开始、为什么等待、为什么结束。
2. 当前任务调度页采用三栏并排布局，表格过窄，不适合排障与审计。

本次设计的目标是：

- 将任务调度页改为三个 tab：排队中、运行中、最近完成。
- 为三个 tab 中的任务都提供统一的审计入口。
- 提供独立的任务审计详情页，能够复盘任务从提交到结束的关键调度过程。
- 审计信息必须尽量保留做出调度决策时的资源与队列事实，而不是只展示抽象的 reason code。

## 范围

本次只覆盖 Web 管理端，不包含移动端。

本次采用轻量全链路方案：

- 保留 task_events 作为任务审计主线。
- 补齐普通任务缺失的 started 和 finalized 事件。
- 新增统一的任务审计详情接口。
- 将当前任务页改为 tab + 独立详情页。

本次不做：

- 移动端任务审计页改造。
- 自动 hang 判定或推理性结论。
- 兼容旧版行内 reason 面板与旧版消费方式。
- 多子进程资源归属（进程树建模、GPU 归属按进程树匹配）。

Agent 侧调度重构（双账本 `GpuLedger`、exclusive 语义、per-GPU utilization 采集、提交时拒绝不可能请求）的规则与实现细节见 [GPU Scheduling Reservation Design](2026-04-16-gpu-scheduling-reservation-design.md)。本文仅定义 Web/UI 侧如何消费调度结果。

## 背景与现状

当前后端已经具备部分结构化任务事件能力。现有实现已经会记录 submitted、queue_paused、schedule_blocked、launch_reserved、attached_started、attached_finished 等事件；其中 schedule_blocked 还会附带阻塞原因与候选 GPU 信息。

但当前 Web 页面的消费方式过于简化：

- 当前任务页位于 [packages/ui/src/pages/TaskQueue.tsx](packages/ui/src/pages/TaskQueue.tsx)。
- 页面在每个节点下使用三栏并排卡片展示排队、运行、最近完成。
- “查看调度原因”只对 queued 任务开放。
- 前端只读取事件列表中的最新一条 schedule_blocked 或 queue_paused，并在行内展开。

这使得页面只能部分回答“为什么还没开始”，但不能回答：

- 为什么这次被选中启动。
- 启动过程发生了什么。
- 为什么以当前终态结束。
- 调度判断当时的资源和竞争任务具体是什么。

## 设计原则

### 1. 审计优先于摘要

详情页的目标不是展示一条状态说明，而是让操作员能够复盘调度链路。

### 2. 事实优先于推理

第一版不对 hang 给出自动结论，只展示系统明确记录的事件、终态原因和最后已知运行事实。

### 3. 决策可复现

关键调度事件必须记录当时参与判断的资源事实和队列竞争事实，至少达到“事后能解释这次判断为什么成立”的程度。

### 4. 替换旧路径，不做兼容层

不继续维护当前“行内展开最后一条调度原因”的旧交互。统一切到新的任务审计详情页与统一审计数据模型，以保持代码简洁。

## 总体方案

### Web 页面结构

任务列表页继续按节点分组，但节点内部从三栏并排改成单内容区 tab：

- 排队中
- 运行中
- 最近完成

每个 tab 中的表格独占整行宽度，保留基本操作能力：

- 取消任务
- 提高优先级
- 查看审计详情

三个 tab 中的任务都提供“查看审计详情”入口，不再限制为 queued 任务。

### 审计详情页

新增独立任务审计详情页，建议路由为：

- /tasks/:serverId/:taskId

详情页承担完整排障职责，包含四个主要区域：

1. 任务摘要
2. 生命周期时间线
3. 决策复盘面板
4. 终态事实面板

详情页不使用弹窗或右侧抽屉，因为审计内容天然是纵向链路，适合独立页面承载。

## 数据模型与接口

### 任务审计详情接口

不再让详情页直接拼装列表页缓存和裸 task_events，而是新增统一任务审计接口。

**通道选择**：审计详情通过新 Socket.IO command `getTaskAuditDetail` 从 agent 获取。Agent 直接返回结构化数据，Web 层通过 `GET /api/servers/:id/tasks/:taskId/audit` 对外暴露。

返回结构：

```typescript
interface AgentTaskAuditDetail {
  task: TaskSummary;
  events: TaskEvent[];          // ordered by timestamp
  runtime?: TaskRuntimeSummary; // latest runtime state if still running
}
```

其中：

- task summary 用于展示基础任务信息与终态摘要。
- ordered events 是详情页的主数据源。
- latest runtime summary 用于展示最后已知 pid、gpu_ids、心跳或 orphan 检测结果等运行事实。

**实现路径**：

1. Agent `socket_server.py` 注册 `getTaskAuditDetail` command。
2. Core `agent-datasource.ts` 新增 `getTaskAuditDetail(taskId)` 方法。
3. Web `agent-namespace.ts` 新增 `SERVER_COMMAND.getTaskAuditDetail` handler。
4. Web `operator-routes.ts` 新增 `GET /api/servers/:id/tasks/:taskId/audit`。
5. UI `ws-adapter.ts` 新增 `getTaskAuditDetail(serverId, taskId)`。

列表页继续使用现有 task queue snapshot；详情页进入后单独请求任务审计详情。

### 生命周期事件模型

保留 task_events 作为统一审计主线，但事件模型升级为面向审计消费。

必须覆盖的事件语义：

- submitted
- queue_paused
- schedule_blocked
- schedule_started 或等价的“本轮被选中”事件
- launch_reserved
- process_started 或 attached_started 的统一启动事件语义
- launch_reservation_expired
- finalized 或等价的统一结束事件
- runtime_orphan_detected
- daemon_restart

其中 schedule_started、process_started、finalized 是本次新增或统一的重点，因为它们决定页面能否解释“为什么开始”和“为什么结束”。
**事件迁移**：旧 `runtime_finalized` 事件通过 DB migration rename 为 `finalized`（`UPDATE task_events SET event_type='finalized' WHERE event_type='runtime_finalized'`）。不新建事件类型与旧类型并存。
### 统一结束事件

第一版要求所有终态统一落审计事件，不再只改任务状态。结束事件至少包含：

- status
- exit_code
- finalize_source
- finalize_reason_code
- last known pid
- last known gpu_ids
- finished_at

这样页面可以表达 completed、failed、cancelled、orphaned 等终态，不需要做推理性解释。

## 决策复盘快照

### 快照目标

对每条 schedule_blocked 或 schedule_started，必须保留一份最小可复盘快照。目标不是完整复制原始采样，而是保留足够的输入事实，让用户理解这次调度判断的依据。

### 快照内容

快照至少需要覆盖三类信息。

第一类：任务请求条件

- require_gpu_count
- require_vram_mb
- priority
- launch_mode

第二类：资源事实

- 每张 GPU 当时是否满足空闲阈值
- 每张 GPU 的 managed reserved 使用情况
- 每张 GPU 的 unmanaged 历史窗口峰值
- 每张 GPU 的 effective free
- 每张 GPU 是否存在 exclusive_owner
- 当前候选 GPU 集合
- 持续窗口交集

第三类：队列竞争事实

- 参与比较的前序任务摘要
- 每个阻塞任务的 task_id
- priority
- status
- 声明资源
- 已预留或已占用的 GPU

### 资源语义要求

决策快照中的资源事实直接来自 scheduler 内部的 `GpuLedger` 结构，字段已确定：

```
gpu_index, total_vram_mb, schedulable_mb, managed_reserved_mb,
exclusive_owner, unmanaged_peak_mb, utilization_percent,
vram_utilization_percent, effective_free_mb
```

详情页必须能表达以下调度语义：

- 空闲 GPU 判定采用阈值：GPU 使用率 < 3% 且显存占用率 < 3%，两个条件同时满足时才视为空闲。
- 受管任务占用按 `managed_reserved_mb`（调度系统已分配或已预留的声明资源）计算，不看实际使用值。
- 非受管占用按 `unmanaged_peak_mb`（历史窗口内观测峰值 × 1.05）计算。
- 对共享任务，可用资源 = `schedulable_mb - managed_reserved_mb - unmanaged_peak_mb`。
- 对独占任务，详情页需要表达该 GPU 的 `utilization_percent` 和 `vram_utilization_percent` 是否满足空闲阈值，以及 `exclusive_owner` 是否已被占用。
- `effective_free_mb` 在 attribution 层仅作展示用途，调度判断完全由 scheduler `GpuLedger` 内部计算。

UI 不暴露公式字符串，但暴露 `GpuLedger` 的原始事实字段，让操作者能理解判断依据。

## 页面信息架构

### 列表页

列表页每个节点区域包含：

- 节点名称与节点 ID
- 队列摘要计数
- 暂停队列 / 恢复队列按钮
- tab 切换区
- 当前 tab 的全宽任务表格

最近完成 tab 继续保留分页能力，但分页只作用于该节点的最近完成列表。

### 详情页任务摘要

任务摘要区显示：

- task id
- command
- user
- priority
- current status
- created_at
- started_at
- finished_at
- exit_code
- finalize_reason_code

### 生命周期时间线

时间线按时间顺序展示关键事件，并用事件类型标签区分：

- 提交
- 排队阻塞
- 队列暂停
- 本轮被选中
- 资源预留
- 进程启动
- 结束

每个事件展示：

- 时间
- 事件标签
- 核心说明
- 可展开的结构化 details

### 决策复盘面板

针对 schedule_blocked 和 schedule_started 事件，展示复盘卡片。复盘卡片内建议包含：

- 任务请求摘要
- 每 GPU 资源表
- 阻塞任务摘要表
- 最终判断摘要

每 GPU 资源表至少包含（对应 `GpuLedger` 字段）：

- GPU 编号（`gpu_index`）
- 是否空闲（`utilization_percent` < 3% 且 `vram_utilization_percent` < 3%）
- managed reserved（`managed_reserved_mb`）
- unmanaged peak（`unmanaged_peak_mb`）
- effective free（`effective_free_mb`）
- exclusive owner（`exclusive_owner`）
- 是否入选候选集

### 终态事实面板

终态事实面板只展示系统明确知道的信息，例如：

- finalize_source
- finalize_reason_code
- exit_code
- runtime_orphan_detected
- daemon_restart
- 最后已知 pid
- 最后已知 gpu_ids
- 最后心跳时间

第一版不显示“已判定为 hang”之类的推理结论。

## 替换策略

本次采用替换式方案，不保留旧版 reason 面板路径：

- 删除或废弃当前列表页内“只读最后一条阻塞原因”的交互。
- 列表页统一跳转到详情页。
- 详情页只消费新的统一任务审计接口（`getTaskAuditDetail`）与统一事件模型。
- 历史旧任务不作为兼容目标，不为旧事件格式增加特判逻辑。
- DB migration 将旧 `runtime_finalized` 事件统一 rename 为 `finalized`，不保留旧类型。

这样可以避免 UI 层同时维护两种审计逻辑，并使测试边界更清晰。

## 异常处理

### 列表页

- 任务操作失败只影响当前行或当前节点，不阻塞其他内容。
- 跳转详情页前不需要预加载全部事件，避免列表页承担过多状态。

### 详情页

- 节点离线、任务不存在、审计数据读取失败分别使用独立提示。
- 接口失败时不回退到旧版行内 reason 面板。
- 如果缺少某个事件区段，直接显示该区段未记录，而不是做兼容推断。

## 测试策略

### Agent 侧

- 验证普通任务完整写入 schedule_started、process_started、finalized 等统一事件。
- 验证 attached 任务与普通任务在审计时间线上具备一致语义。
- 验证 schedule_blocked 和 schedule_started 的 details 中包含关键资源与竞争事实。
- 验证结束事件包含 status、exit_code、finalize_source、finalize_reason_code。

### Web/Core 侧

- 验证任务审计详情接口的协议与路由。
- 验证 datasource 能稳定返回 task summary、ordered events、latest runtime summary。
- 不再继续维护旧的“裸 task_events + 行内阻塞原因面板”测试路径。

### UI 侧

- 验证任务页由三栏改为三个 tab 后，切换、分页和操作按钮仍然正确。
- 验证三个 tab 中的任务都能进入详情页。
- 验证详情页正确渲染任务摘要、生命周期时间线、决策复盘面板和终态事实面板。
- 验证详情页错误态与空数据态。

## 成功标准

完成后，Web 管理端应当能够稳定回答以下问题：

- 这个任务为什么还没开始。
- 这个任务为什么这轮被选中启动。
- 做出这个判断时，系统资源和竞争任务分别是什么。
- 这个任务最后为什么结束为当前状态。

同时，任务页不再因为三栏并排而难以阅读，调度查看入口在三个 tab 中保持一致。

## 实施边界

本设计是任务调度审计 Web 化的第一步，重点是把审计能力做成可用的操作界面，而不是一次性建设完整任务平台。

后续若需要扩展，可以在同一详情页中继续挂接：

- 进程树
- process audit
- 更细的 runtime monitor 历史
- 后续更强的 hang 诊断

但这些内容不属于本次设计的必需范围。