# 基于进程状态的统一任务运行时监控设计

Date: 2026-04-16

## 摘要

本设计引入一个 daemon 内部的统一运行时监控层 RuntimeMonitorLoop，使 PMEOW 对任务状态的判断从“依赖前台调用方回写”升级为“依赖本地进程状态事实”。

该设计首版覆盖两类本地任务：

- attached_python
- daemon_shell

设计目标是同时解决以下问题：

- attached_python 在本地 Ctrl+C 后长期卡在 running
- 前台 CLI 崩溃或 finish 回写丢失导致 orphan running
- resource_reservations 残留
- GPU attribution 只认任务根 PID，无法覆盖多子进程
- 服务端镜像任务状态长期无法收敛

首版采用以下已确认决策：

- 范围：统一设计所有本地任务，第一版同时覆盖 attached_python 和 daemon_shell
- 终态语义：Ctrl+C 与 orphan running 首版统一记为 failed；Ctrl+C 使用 exit_code = 130，orphan 使用 reason_code 区分
- 持久化：持久化当前进程树，不做高频历史快照
- 监控循环：新增独立 RuntimeMonitorLoop，不复用 metrics collect_cycle
- 判活口径：按整棵已归属进程树判活，而不是只看 root pid

## 背景与问题

当前 [agent/pmeow/cli_python.py](agent/pmeow/cli_python.py) 与 [agent/pmeow/executor/attached.py](agent/pmeow/executor/attached.py) 的 attached_python 链路在 confirm_attached_launch 之后，仍然依赖前台 CLI 存活到 finish_attached_task 才能让 daemon 得到终态。

这带来三个结构性问题：

1. 任务终态写回依赖前台调用栈，而不是 daemon 对本地进程事实的判断。
2. 运行时资源归属缺少统一的进程树事实源，导致 [agent/pmeow/collector/gpu_attribution.py](agent/pmeow/collector/gpu_attribution.py) 只能按 task.pid 精确匹配 GPU 进程。
3. 当前 [agent/pmeow/collector/processes.py](agent/pmeow/collector/processes.py) 与 [agent/pmeow/models.py](agent/pmeow/models.py) 的进程采集模型没有 ppid、depth、任务归属等字段，无法支撑多子进程任务的运行时归属。

现有实现中，[agent/pmeow/daemon/service.py](agent/pmeow/daemon/service.py) 已能回收 launching 超时，但不会对 running orphan 做持续自愈；而 [agent/pmeow/store/tasks.py](agent/pmeow/store/tasks.py) 的 finish_task 也没有终态守卫，无法天然抵御迟到 finish 覆盖既有终态的问题。

## 目标

本设计的目标如下：

1. 让 daemon 根据本地进程状态独立判断任务是否仍在运行，不再把终态收敛建立在前台 CLI 是否成功回写上。
2. 为 attached_python 与 daemon_shell 提供统一的运行时监控模型，而不是两个各自演化的状态来源。
3. 为 GPU attribution 和后续 CPU/MEM process audit 提供统一的任务进程树事实源。
4. 让 orphan running、迟到 finish、daemon 重启恢复都能通过一致的状态机收敛。
5. 保持服务端“镜像和控制面”角色不变，不把服务端升级为全局调度器。

## 非目标

本设计首版不包含以下内容：

1. 不引入高频进程树历史快照或独立的进程时序数据库。
2. 不改变服务端任务镜像协议中的公开 TaskStatus 枚举。
3. 不在首版中引入 interrupted、orphaned 等新的终态枚举值。
4. 不把任务日志正文主动上传到服务端。
5. 不在首版中交付完整的 UI 历史审计界面；UI 可以后续基于新事实源增量接入。

## 架构概览

本设计在 daemon 内新增一层 RuntimeMonitorLoop，与现有 [agent/pmeow/daemon/service.py](agent/pmeow/daemon/service.py) 中的调度与 transport 能力并列协作。

它的职责是：

1. 在任务进入 running 时注册 root pid。
2. 周期性刷新该任务的当前进程树。
3. 根据进程树事实判断任务是否仍存活。
4. 在需要终态收敛时调用统一的 finalize 状态机。
5. 为资源归属提供 pid 到 task_id 的统一映射。

该新增层不改变 [docs/developer/architecture.md](docs/developer/architecture.md) 中既有系统边界：

- agent 仍负责本地事实、调度、执行和状态上报
- 服务端仍负责任务镜像、集群视图和控制面

## 运行时状态模型

### 对外状态

对外公开的任务状态继续沿用当前模型：

- queued
- launching
- running
- completed
- failed
- cancelled

这意味着服务端、Web 和 UI 无需因为首版设计而先经历一轮协议重构。

### 对内运行时相位

在 daemon 内新增独立的运行时相位 runtime_phase，用于表达 monitor 的内部控制状态。建议值如下：

- registered：已登记 root pid，等待首轮稳定树刷新
- running：树中至少有一个已归属成员存活
- finalizing：已判定需要终态收敛，正在执行 guarded finalize
- finalized：运行时监控已结束，等待清理或仅保留审计字段

runtime_phase 不暴露到对外 TaskStatus，也不由服务端镜像直接消费。

## 数据模型

### 新增 task_runtime

新增 task_runtime 表，按 task_id 一行，作为 daemon 内部运行时控制面表。建议字段包括：

- task_id
- launch_mode
- root_pid
- runtime_phase
- first_started_at
- last_seen_at
- finalize_source
- finalize_reason_code
- last_observed_exit_code
- updated_at

其中：

- finalize_source 用于记录终态来源，例如 runner_exit、cli_finish、cancel、monitor_orphan
- finalize_reason_code 用于记录细粒度原因，例如 ctrl_c、orphaned、explicit_cancel

### 新增 task_processes

新增 task_processes 表，表示任务当前进程树，不做高频历史快照。建议字段包括：

- task_id
- pid
- ppid
- depth
- user
- command
- is_root
- first_seen_at
- last_seen_at

约束建议：

- 主键或唯一键使用 task_id + pid
- 仅保留当前仍归属于任务的活进程
- 任务终态后统一删除该任务的 current tree 记录

### store 层 finalize 守卫

在 [agent/pmeow/store/tasks.py](agent/pmeow/store/tasks.py) 中引入统一 finalize helper，替代分散裸调用 finish_task 的路径。该 helper 的职责是：

1. 校验任务是否仍未终态。
2. 统一写入 terminal status、exit_code、finished_at。
3. 清理 resource_reservations。
4. 删除 task_runtime 与 task_processes 当前记录。
5. 记录 task_events 审计信息。
6. 返回是否真正完成状态迁移，供调用方判断是否需要发送 taskUpdate。

这层守卫用于阻止迟到 finish 覆盖已收敛终态。

## 运行流程

### 1. 任务启动登记

无论来源是 attached_python 还是 daemon_shell，只要任务进入 running，就调用统一的 register_root_process：

- attached_python：在 confirm_attached_launch 成功后调用
- daemon_shell：在 runner 确认子进程已启动后调用

该步骤完成以下动作：

1. 将任务公开状态置为 running。
2. 向 task_runtime 写入 root_pid 与 runtime_phase=registered。
3. 向 task_processes 写入 root 节点。
4. 发送 running taskUpdate。

### 2. RuntimeMonitorLoop 周期刷新

daemon 内新增独立 RuntimeMonitorLoop，建议刷新间隔为 1 到 2 秒。它与 metrics collect_cycle 解耦，避免终态收敛延迟被 collection_interval 绑定。

每轮刷新针对所有 active task_runtime 执行以下步骤：

1. 读取该任务上一轮 current tree 中仍存活的 pid 集合。
2. 以这些活 pid 为种子，扩展发现其子进程，构建下一轮 current tree。
3. upsert task_processes 中仍活的成员并刷新 last_seen_at。
4. 删除不再属于 current tree 的 pid 记录。
5. 如果树中仍有任意成员存活，则保持 runtime_phase=running。
6. 如果整棵树都不存在，则进入 finalizing。

### 3. 判活口径

任务是否继续 running，按“整棵已归属进程树是否仍有成员存活”判断，而不是只看 root pid。

采用该规则的原因：

- daemon_shell 可能先退出包装层 shell，但真正工作进程仍在执行
- attached_python 或用户脚本也可能派生 worker 进程后让父进程退出

如果只按 root pid 判活，容易把仍在执行的多进程任务过早 finalize。

### 4. 终态收敛

当 monitor 判定整棵树已消失，或接收到 runner_exit、cli_finish、cancel 等终态来源时，统一进入 guarded finalize。

终态优先级建议如下：

1. explicit_cancel
2. runner_exit 或 cli_finish 提供的可信 exit_code
3. monitor_orphan 推断终态

守卫规则如下：

1. 若任务已是终态，则忽略迟到来源，只记录调试事件。
2. 若任务仍未终态，则写入最终状态并清理运行时状态。
3. 只有首次成功 finalize 的来源可以发送终态 taskUpdate。

## attached_python 与 daemon_shell 的统一接入

### attached_python

attached_python 仍然允许 CLI 在本地终端中获得即时体验，但 CLI 不再是任务终态的唯一事实源。

首版建议继续保留以下行为：

- CLI 尝试在 Ctrl+C 后做 best-effort finish_attached_task
- attached 执行器将 Ctrl+C 收敛为稳定退出结果，建议 exit_code=130

但即使 CLI 在 confirm 之后崩溃、被强杀或 finish 回写失败，daemon 也能依靠 RuntimeMonitorLoop 收敛 orphan running。

### daemon_shell

daemon_shell 的 runner callback 仍然保留，因为它能提供更快的完成信号和更可信的退出码。但它不再是单一事实源，而是 guarded finalize 的一种输入来源。

这使 attached_python 与 daemon_shell 在运行时语义上统一：

- 都由 register_root_process 建立运行时事实源
- 都由 RuntimeMonitorLoop 周期刷新进程树
- 都由 guarded finalize 收敛终态

## 资源归属设计

### GPU attribution

将 [agent/pmeow/collector/gpu_attribution.py](agent/pmeow/collector/gpu_attribution.py) 的映射逻辑从“只匹配 task.pid”升级为“匹配 task_processes 中任意当前活 pid”。

这样可以覆盖：

- root pid 占用 GPU 的单进程任务
- 子进程实际占用 GPU 的多进程任务

该设计直接解决现有“GPU 归因只认根 PID”的缺口。

### CPU/MEM process audit

首版不要求立刻重构完整 UI，但应为后续 process audit 打好基础：

- [agent/pmeow/collector/processes.py](agent/pmeow/collector/processes.py) 需要采集 ppid
- [agent/pmeow/models.py](agent/pmeow/models.py) 中的 ProcessInfo 需要扩展至少 ppid 字段
- process audit 后续可以通过 pid 与 task_processes 做映射，得到 task_id 归属

## 终态语义

首版采用保守语义：

- Ctrl+C => failed, exit_code = 130, finalize_reason_code = ctrl_c
- orphan running => failed, finalize_reason_code = orphaned
- explicit cancel => cancelled

暂不引入 interrupted 或 orphaned 这样的公开终态枚举值，以减少链路变更面。

## Windows 与跨平台考虑

Windows 上不建议依赖复杂信号语义推断。首版跨平台策略应以 psutil 的进程存在性判断和回调退出码为主，避免构造过强的控制台信号假设。

设计要求如下：

1. 进程树刷新逻辑必须优先依赖 psutil，可跨平台工作。
2. 不要求在首版中精确区分所有 Windows 控制台中断来源。
3. 只要监控器能在树消失后稳定 finalize，系统语义就可接受。

## daemon 重启恢复

daemon 启动时，新增运行时恢复逻辑：

1. 读取 tasks 中仍为 running 的记录。
2. 读取 task_runtime 中仍处于 active phase 的记录。
3. 为这些任务重建 active monitor 集合。
4. 若对应 current tree 已不存在或所有 pid 均不可见，则立即走 orphan finalize。

这样可以避免 daemon 重启后依然长期保留脏 running 状态。

## 事件与审计

首版建议新增或强化以下 task_events：

- runtime_registered
- runtime_tree_refreshed（可选，仅在 debug 或采样模式下记录，避免事件过多）
- runtime_finalize_started
- runtime_finalize_ignored_late_source
- runtime_orphan_detected
- runtime_recovered_after_restart

这些事件用于排障，不要求全部立刻展示到 UI，但应该为后续审计界面留出结构化基础。

## 实施分期

### Phase 1：运行时闭环

目标：先解决挂死、orphan 和终态守卫。

范围包括：

- 新增 task_runtime
- 新增 RuntimeMonitorLoop
- 引入 guarded finalize
- attached_python 接入 register_root_process
- daemon_shell 接入 register_root_process
- daemon 重启恢复

### Phase 2：进程树驱动归属

目标：让资源归属建立在 current tree 上。

范围包括：

- 新增 task_processes
- 扩展 ProcessInfo 至少支持 ppid
- GPU attribution 改按 current tree 任意 pid 匹配
- 为后续 CPU/MEM process audit 暴露 task_id 映射

### Phase 3：审计与 UI 消费

目标：把新事实源暴露给前端排障。

范围包括：

- 扩展任务调度审计页
- 扩展 process audit 或任务详情视图
- 展示 orphan、late finish ignored、runtime recovered 等事件

## 风险与规避

### 1. 迟到终态覆盖

风险：CLI finish 或 runner callback 在 monitor 已 finalize 后才到达。

规避：所有终态来源统一走 guarded finalize，已终态时只记事件不覆写。

### 2. 仅靠 root pid 会误判多进程任务结束

风险：包装层先退出，worker 仍在运行。

规避：按整棵 current tree 判活，不按 root pid 单点判活。

### 3. 监控循环与 metrics 采集耦合过深

风险：终态收敛受 collection_interval 影响，导致卡死持续时间过长。

规避：将 RuntimeMonitorLoop 独立于 collect_cycle。

### 4. 事件和数据库写放大

风险：高频刷树导致写放大和 task_events 噪音。

规避：只持久化 current tree，不做高频历史快照；tree_refreshed 事件默认不逐轮落库。

## 测试策略

### 1. store tests

建议补充 [agent/tests/store/test_tasks.py](agent/tests/store/test_tasks.py)：

- guarded finalize 只能对未终态任务成功一次
- 迟到 finish 不覆盖既有终态
- finalize 后 resource_reservations 被释放

### 2. daemon/runtime tests

建议补充 [agent/tests/daemon/test_service.py](agent/tests/daemon/test_service.py)：

- attached_python 与 daemon_shell 在 running 后都会登记 root pid
- RuntimeMonitorLoop 在树消失后能自动 finalize
- daemon 重启恢复后能清理 orphan running

### 3. CLI/executor tests

建议补充 [agent/tests/test_cli_python.py](agent/tests/test_cli_python.py) 与新增 [agent/tests/executor/test_attached.py](agent/tests/executor/test_attached.py)：

- confirm 成功后 Ctrl+C，CLI best-effort finish 仍会尝试发送
- 即使 CLI finish 未成功，daemon 最终仍通过 monitor 收敛终态

### 4. collector/attribution tests

建议扩展 [agent/tests/collector/test_gpu.py](agent/tests/collector/test_gpu.py)：

- root pid 匹配 GPU 进程
- 子进程 pid 匹配 GPU 进程
- 多子进程占用被正确归属到同一 task_id

## 验收标准

满足以下条件，可认为首版设计目标达成：

1. attached_python 在 confirm 后发生 Ctrl+C，不再长期停留在 running。
2. CLI 崩溃或 finish 回写丢失时，daemon 仍能在可接受延迟内收敛 orphan running。
3. resource_reservations 不会因为 attached or orphan 场景长期残留。
4. 服务端最终能收到终态 taskUpdate，Web 侧镜像状态能收敛。
5. GPU attribution 不再只依赖 task.pid，而能覆盖任务树中的子进程。

## 结论

与“只做客户端补丁”相比，这个基于进程状态的统一运行时监控设计能一次性解决当前问题的根因：系统不再把任务终态收敛寄托在前台调用方是否活着，而是由 daemon 基于本地进程事实独立判断。

它的复杂度明显低于“全量过程审计平台”，但足以为后续任务审计、进程归属和 UI 排障提供坚实基础，因此适合作为本次修复与演进的正式方向。