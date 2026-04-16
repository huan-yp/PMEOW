# 任务调度审计与多子进程资源归属排查报告

日期：2026-04-16

## 摘要

本次排查聚焦两个问题：

1. 如何审计一个任务为什么没有开始，例如 GPU 资源不足、持续窗口不满足、被更高优先级任务阻塞、队列暂停等。
2. 当一个任务启动多个子进程时，这些子进程的 CPU、内存和 GPU 占用是否能被正确归属到该任务。

结论如下：

- 调度未启动原因：后端已经具备结构化事件记录与接口暴露能力，前端也已有基础入口，但当前只展示最新一条原因，尚未形成完整可审计视图。
- 多子进程资源归属：当前实现并不能正确覆盖任务的子进程资源归属，尤其是 GPU 归属目前仅基于任务主 PID 与 GPU 进程 PID 的精确匹配。

## 审计范围

本次审计主要检查以下链路：

- Agent 本地调度与任务事件写入
- Web 层任务事件与进程审计接口
- UI 层任务调度页与进程审计页
- Agent 侧进程采集与 GPU 进程归属逻辑

本次为代码与数据流审计，未做运行时复现和端到端手工验证。

## 结论矩阵

| 审计点 | 当前状态 | 结论 |
| --- | --- | --- |
| 任务未启动原因的结构化记录 | 已具备 | 可用于审计，但前端展示不完整 |
| 任务未启动原因的前端界面 | 部分具备 | 仅有简化版原因面板，不是完整时间线 |
| GPU 资源阻塞明细字段 | 已具备 | 已写入事件 details，但前端未充分展示 |
| 多子进程 GPU 归属 | 缺失 | 当前仅按主 PID 精确匹配，不覆盖子进程 |
| 多子进程 CPU/内存归属 | 缺失 | 采集模型缺少 ppid 和任务归属字段 |
| 进程审计页按任务排障能力 | 缺失 | 没有按任务聚合或按进程树展开能力 |

## 一、任务未启动原因审计

### 1.1 已有能力

Agent 在调度循环中会对排队任务进行评估，并在任务无法启动时记录结构化事件：

- queue_paused
- schedule_blocked

关键逻辑位于：

- agent/pmeow/daemon/service.py
- agent/pmeow/queue/scheduler.py

其中 schedule_blocked 事件会写入以下结构化信息：

- message
- reason_code
- current_eligible_gpu_ids
- sustained_eligible_gpu_ids
- current_effective_free_mb
- history_min_free_mb
- pending_vram_mb
- blocker_task_ids

这些字段已经足以支持较完整的调度排障。

### 1.2 调度原因分类

当前调度器明确产出以下 reason_code：

- queue_paused
- blocked_by_higher_priority
- insufficient_gpu_count
- sustained_window_not_satisfied

这些原因来自调度器对以下因素的判断：

- 当前样本中是否有足够 GPU 满足 require_vram_mb
- 历史窗口和当前样本的交集中，是否存在持续满足条件的 GPU 集合
- 本轮更高优先级任务是否已经在 pending 中占用了可调度空间

### 1.3 接口链路

任务事件已经可以通过 Web 层对外获取：

- packages/web/src/agent-routes.ts 提供 /api/servers/:id/tasks/:taskId/events
- packages/core/src/datasource/agent-datasource.ts 提供 getTaskEvents
- packages/ui/src/transport/ws-adapter.ts 已接入 getTaskEvents

因此，前端获取审计信息并不存在后端接口阻塞。

### 1.4 前端现状

当前任务调度页已经有“查看调度原因”能力，位于：

- packages/ui/src/pages/TaskQueue.tsx

但当前展示方式有明显限制：

- 仅抽取最新一条 schedule_blocked 或 queue_paused 事件
- 仅展示 reason_code、时间、当前候选 GPU、持续窗口交集、阻塞任务
- 没有展示 current_effective_free_mb、history_min_free_mb、pending_vram_mb
- 没有展示完整事件时间线
- 无法观察原因随时间的变化过程

结论：

后端数据已基本到位，但前端界面尚未达到“审计视角”。

### 1.5 审计视角下的缺口

若要真正支持“为什么这个任务一直没开始”的排查，当前前端至少还缺：

- 事件时间线视图，而不是只看最新一条原因
- 每次阻塞时各 GPU 的 current_effective_free_mb 与 history_min_free_mb 对比
- pending_vram_mb 的可视化，便于解释同轮更高优先级任务的占用影响
- blocker_task_ids 的可跳转能力，便于继续钻取阻塞任务
- 从 submitted 到 running 或 failed 的完整状态迁移审计

## 二、多子进程资源归属排查

### 2.1 当前 GPU 归属逻辑

GPU 归属逻辑位于：

- agent/pmeow/collector/gpu_attribution.py

当前逻辑会先从 running_tasks 构造一个 pid 到 task 的映射：

- 只有 task.pid 会被放入 pid_to_task
- GPU 进程只有在 proc.pid 与 task.pid 完全相等时，才会被归类为该任务

这意味着：

- 任务主进程占用 GPU：可归属
- 任务子进程占用 GPU：默认不会归属到任务
- 子进程会落到 user_processes 或 unknown_processes，而不是 pmeow_tasks

现有测试也只验证了“任务 PID 与 GPU PID 完全匹配”的场景：

- agent/tests/collector/test_gpu.py

结论：

当前 GPU 归属并不支持按任务进程树归属。

### 2.2 当前 CPU/内存进程采集逻辑

进程采集位于：

- agent/pmeow/collector/processes.py

当前 ProcessInfo 仅包含：

- pid
- user
- cpu_percent
- mem_percent
- rss
- command

ProcessInfo 模型位于：

- agent/pmeow/models.py

当前缺少以下关键字段：

- ppid
- create_time
- task_id 或 owner_task_id
- 进程树信息

这意味着即使想在后处理中做“根据父子关系归并到任务”，当前快照数据也不够。

### 2.3 进程审计 API 的局限

进程审计接口位于：

- packages/web/src/operator-routes.ts

它返回的数据来自：

- packages/core/src/security/audit.ts 的 buildProcessAuditRows

当前 ProcessAuditRow 虽然包含：

- ownerType
- taskId

但这些字段的来源主要是 GPU 使用表中的 pid 粒度归并结果，而不是基于完整进程树推导出的任务归属。

因此当前 process-audit 只能表达：

- 这个 PID 是否在 GPU 归属记录里被认成 task

它不能可靠表达：

- 这个 CPU/内存进程是否属于某个任务的子进程
- 某个任务整体拥有多少子进程及其总资源占用

### 2.4 前端进程表的局限

当前进程表位于：

- packages/ui/src/components/ProcessTable.tsx

当前仅展示：

- PID
- 用户
- 人员
- CPU%
- MEM%
- RSS GB
- VRAM GB
- 风险
- 命令

当前没有展示：

- ownerType
- taskId
- ppid
- 是否为任务根进程或任务子进程
- 按任务聚合视图
- 进程树展开视图

因此前端无法用现有界面确认“这部分资源是不是某个任务的子进程消耗”。

## 三、证据链摘要

### 3.1 调度阻塞审计已具备的证据

- agent/pmeow/daemon/service.py 在调度阻塞时写入 schedule_blocked 事件及结构化 details
- agent/pmeow/queue/scheduler.py 输出 TaskScheduleEvaluation，包含阻塞诊断信息
- packages/web/src/agent-routes.ts 提供任务事件接口
- packages/ui/src/pages/TaskQueue.tsx 已支持按任务拉取事件并展示简化原因面板
- agent/tests/daemon/test_service.py 已验证 queue_paused 与 insufficient_gpu_count 等事件记录

### 3.2 多子进程归属缺口的证据

- agent/pmeow/collector/gpu_attribution.py 仅按 task.pid 和 gpu proc pid 精确匹配
- agent/tests/collector/test_gpu.py 仅覆盖 matching_pid 场景
- agent/pmeow/collector/processes.py 没有采集 ppid 或 task 归属字段
- packages/core/src/security/audit.ts 的 taskId 来源于 GPU 使用行合并，而非任务进程树
- packages/ui/src/components/ProcessTable.tsx 没有任务归属排障维度

## 四、建议的前端审计界面

### 4.1 任务调度审计视图

建议在现有任务调度页基础上升级为可审计视图：

- 每个排队任务支持展开完整事件时间线
- 展示 submitted、queue_paused、schedule_blocked、launch_reserved、attached_started、process_started、launch_reservation_expired、finished 等关键事件
- 对每条 schedule_blocked 展示完整 details 字段
- 将 blocker_task_ids 渲染为可点击跳转项
- 列表态保留“当前最新阻塞原因摘要”

这样可以直接回答：

- 为什么没开始
- 是一直没开始，还是原因发生过变化
- 是 GPU 不够、持续窗口不满足，还是被高优先级任务挤掉

### 4.2 任务资源归属视图

建议在节点详情 processes 页或任务详情页中新增按任务归属的资源视图：

- 按 taskId 聚合展示总 CPU、总 MEM、总 RSS、总 VRAM
- 展示 root pid 与子进程数量
- 支持展开进程树明细
- 支持筛选“只看任务进程”“只看未归属 GPU 进程”“只看某任务”

这样才能直接排查：

- 某个任务是否拉起了多个 worker
- 子进程资源是否被正确归入该任务
- 哪些 GPU 占用仍然是未归属状态

## 五、建议的最小实现落点

### 5.1 若只先补调度审计

可优先做前端，不必先改后端：

- 扩展 packages/ui/src/pages/TaskQueue.tsx
- 将最新一条原因面板改为完整事件时间线
- 增加 current_effective_free_mb、history_min_free_mb、pending_vram_mb 的展示
- 为 blocker_task_ids 增加跳转或联动高亮

该部分风险较低，因为数据已经由 agent 写入。

### 5.2 若要真正补齐多子进程资源归属

必须先从 agent 侧改造：

1. 扩展 ProcessInfo

- 在 agent/pmeow/models.py 增加 ppid、create_time 等字段
- 在 agent/pmeow/collector/processes.py 采集这些字段

2. 建立任务进程树归属

- 以运行中任务的 root pid 为种子
- 递归收集 descendants
- 生成 pid 到 task_id 的完整映射

3. 修改 GPU 归属逻辑

- 在 agent/pmeow/collector/gpu_attribution.py 中，不再只看 task.pid 是否等于 gpu proc pid
- 改为判断 gpu proc pid 是否属于该任务进程树

4. 扩展进程审计模型与前端

- 让 process-audit 返回明确的任务归属字段
- 在 packages/ui/src/components/ProcessTable.tsx 或新的任务资源面板中显示 taskId、ownerType、ppid

## 六、优先级建议

建议按以下顺序推进：

1. 先补任务调度审计前端

- 成本最低
- 立即提升“为什么没启动”的排障效率
- 不依赖后端结构变更

2. 再补多子进程归属的 agent 侧能力

- 这是正确性的根因修复
- 不修这一层，前端再怎么展示也无法可靠证明资源归属

3. 最后补任务资源归属前端视图

- 在后端数据正确后，前端展示才有意义

## 七、最终判断

### 7.1 关于“任务为什么没启动”

当前系统已经具备较强的后端审计基础，主要问题在于前端展示层仍然过于简化。这个点属于“已有基础能力，但还没有形成完整审计界面”。

### 7.2 关于“任务启动多个子进程后资源是否正确归属”

当前实现不能认为是正确支持。无论是 GPU 归属还是 CPU/内存归属，都缺少基于任务进程树的建模与映射能力。这个点属于功能缺口，而不是单纯展示缺口。

## 附：本次排查涉及的关键文件

- agent/pmeow/daemon/service.py
- agent/pmeow/queue/scheduler.py
- agent/pmeow/collector/gpu_attribution.py
- agent/pmeow/collector/processes.py
- agent/pmeow/collector/snapshot.py
- agent/pmeow/models.py
- agent/tests/collector/test_gpu.py
- agent/tests/daemon/test_service.py
- packages/web/src/agent-routes.ts
- packages/web/src/operator-routes.ts
- packages/core/src/security/audit.ts
- packages/core/src/agent/ingest.ts
- packages/core/src/types.ts
- packages/ui/src/pages/TaskQueue.tsx
- packages/ui/src/components/ProcessTable.tsx