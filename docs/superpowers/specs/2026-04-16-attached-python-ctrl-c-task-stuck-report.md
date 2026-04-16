# Attached Python Ctrl+C 任务挂死报告

Date: 2026-04-16

## 摘要

当前通过 Python sugar 路径执行的 attached_python 任务，在本地终端按 Ctrl+C 中断后，存在较高概率长期停留在 running 状态。

这不是单纯的前端展示问题，而是一个端到端状态收敛缺失问题：

- agent 本地 SQLite 中的任务状态可能持续为 running
- resource_reservations 可能持续残留
- metrics 采集会继续把该任务当作 running 参与 GPU attribution
- 服务端与 web 侧拿不到终态 taskUpdate，任务会长期显示为进行中

该问题的根因已定位，修复路径也已收敛。当前待审阅事项主要是：

- Ctrl+C 的业务语义是否应记为 failed 还是 cancelled
- 本次修复是否只做客户端根修，还是同时补上 daemon 侧 orphan running 兜底

## 问题复现路径

典型路径如下：

1. 用户通过 Python sugar 提交任务。
2. daemon 调度该任务并将其置为 launching，预留 GPU。
3. 本地 CLI 在终端中启动 attached 子进程。
4. 子进程启动后，CLI 调用 confirm_attached_launch，daemon 将任务置为 running。
5. 用户在本地终端按 Ctrl+C。
6. CLI 未能稳定执行 finish_attached_task。
7. 任务在 daemon 数据库中保持 running，前端长期显示进行中。

## 现状证据

### 1. Python sugar 路径依赖本地 CLI 回写终态

[agent/pmeow/cli_python.py](agent/pmeow/cli_python.py) 中，attached_python 的正常终态完全依赖本地 CLI 在 attached 子进程结束后调用 finish_attached_task：

- 提交任务
- 轮询直到 status == launching
- 本地启动 attached 子进程
- on_started 后调用 confirm_attached_launch
- 子进程退出后调用 finish_attached_task

这意味着一旦本地 CLI 在 confirm 之后、finish 之前被 Ctrl+C 打断，daemon 就收不到终态。

### 2. attached 执行器未对 Ctrl+C 做稳定收尾

[agent/pmeow/executor/attached.py](agent/pmeow/executor/attached.py) 当前负责本地运行子进程并转发终端 IO，但没有把 KeyboardInterrupt 明确收敛为“可回写的终态退出码”。

结果是：

- 中断可能直接打断 Python sugar 调用栈
- 上层无法保证走到 finish_attached_task

### 3. daemon 当前只兜 launching 超时，不兜 running orphan

[agent/pmeow/daemon/service.py](agent/pmeow/daemon/service.py) 当前已有 launching deadline 过期回收逻辑，但 attached_python 一旦被 confirm 为 running，daemon 不会主动检查该 pid 是否仍然存活。

因此只要 finish_attached_task 丢失，任务会一直停留在 running，直到 daemon 重启时被恢复逻辑兜底。

### 4. 数据污染不仅影响任务列表，也影响资源归因

[agent/pmeow/collector/snapshot.py](agent/pmeow/collector/snapshot.py) 会读取本地任务库中 status == running 的任务做 GPU attribution。

因此该问题的后果不仅是 web 队列页显示错误，还包括：

- GPU 占用归因可能持续保留该任务
- 排队与资源判断可能被残留 reservation 干扰

### 5. web 侧主要依赖 taskUpdate 收敛镜像任务状态

[packages/core/src/db/agent-tasks.ts](packages/core/src/db/agent-tasks.ts) 维护镜像任务状态，running 队列与 recent 队列依赖终态更新进入 completed、failed、cancelled。

如果 agent 未发送终态 taskUpdate，则 web 侧会长期保留 running 记录。

## 根因判断

根因不是某个单点判断错误，而是 attached_python 的运行模型里缺少“本地中断后的强制收尾保证”。

更具体地说：

- confirm_attached_launch 把状态推进到了 running
- finish_attached_task 是唯一常规终态回写路径
- Ctrl+C 可能中断本地 CLI，使 finish_attached_task 丢失
- daemon 没有对 attached running orphan 提供持续自愈能力

所以问题本质是：

**终态写回依赖前台客户端存活，但系统没有为前台客户端异常退出设计第二道收敛机制。**

## 修复选项

### 方案 A：只做客户端根修

修复点：

- 在 [agent/pmeow/executor/attached.py](agent/pmeow/executor/attached.py) 中处理中断路径，将 Ctrl+C 收敛为稳定的退出结果，建议退出码使用 130。
- 在 [agent/pmeow/cli_python.py](agent/pmeow/cli_python.py) 中对 attached 执行段引入 confirmed 标志。
- 仅在 confirm_attached_launch 成功后，保证无论正常退出还是 KeyboardInterrupt，最终都会尝试调用 finish_attached_task。
- 若中断发生在 confirm 之前，则不调用 finish_attached_task，继续依赖 launching deadline 回收现有语义。

优点：

- 改动最小
- 直接命中当前已知 bug 主路径
- 不需要改 schema

局限：

- 只能覆盖“本地 Ctrl+C”这类可控路径
- 无法覆盖前台 CLI 崩溃、终端被强杀、网络回写失败、机器掉电等情况

### 方案 B：客户端根修 + daemon 侧 orphan running 兜底

包含方案 A 的全部内容，并补充：

- 在 [agent/pmeow/daemon/service.py](agent/pmeow/daemon/service.py) 中增加 attached_python running 任务的 pid 存活检查
- 对 pid 已不存在的 attached running 任务进行终态收敛
- 清理 resource_reservations
- 记录专门事件
- 向服务端发送终态 taskUpdate

优点：

- 不仅解决 Ctrl+C，还提升整条 attached_python 链路的鲁棒性
- 能覆盖前台 CLI 异常退出导致的长期脏状态
- 能同步修复数据库、GPU attribution、web 任务镜像三个层面的问题

局限：

- 改动面略大于方案 A
- 需要谨慎处理“迟到 finish”与“daemon 先判死”之间的竞态

## 推荐方案

推荐选择方案 B。

理由：

- 方案 A 是必要的，但不是充分的
- 当前问题已经暴露出系统把终态收敛完全寄托在前台 CLI 上，这个假设本身不稳
- daemon 已经对 restart 后 running 任务提供恢复语义，说明系统设计上并不排斥对 orphan task 做服务端兜底

推荐落地顺序：

1. 先修客户端中断收尾，解决 Ctrl+C 主路径。
2. 再补 daemon 侧 attached orphan running 回收。
3. 同时给任务终态写入增加状态守卫，避免迟到 finish 覆盖已收敛终态。

## 建议终态语义

### 选项 1：记为 failed，exit_code = 130

优点：

- 最贴近真实进程退出语义
- 与现有 finish_task 根据 exit_code 推导 completed 或 failed 的逻辑天然兼容
- 代码改动最小

缺点：

- 从用户视角看，Ctrl+C 更像“主动取消”，文案上不够友好

### 选项 2：记为 cancelled

优点：

- 更贴近“用户主动中断”的业务含义
- 前端展示可能更符合直觉

缺点：

- 需要扩展 attached 终态写回语义，不再只是 exit_code 到 completed 或 failed 的自然映射
- 需要更谨慎地区分“本地 Ctrl+C”与“进程异常失败”

### 建议

若本次目标是尽快、安全地修掉当前 bug，建议先采用：

- Ctrl+C => failed
- exit_code = 130

后续若产品层明确要求“本地主动中断必须展示为 cancelled”，再单独做语义升级。

## 实施要点

### 1. 客户端根修

建议修改以下文件：

- [agent/pmeow/executor/attached.py](agent/pmeow/executor/attached.py)
- [agent/pmeow/cli_python.py](agent/pmeow/cli_python.py)

预期行为：

- attached 子进程已经成功启动并 confirm 后，本地 Ctrl+C 不再导致任务永远卡在 running
- daemon 最终能收到 finish 回写
- resource_reservations 被释放
- web 侧能收到终态更新

### 2. 服务端兜底

建议修改以下文件：

- [agent/pmeow/daemon/service.py](agent/pmeow/daemon/service.py)
- [agent/pmeow/store/tasks.py](agent/pmeow/store/tasks.py)

预期行为：

- attached_python 任务若数据库中仍是 running，但 pid 已经不存在，则 daemon 自动收敛为终态
- 不允许迟到 finish 覆盖已收敛任务

## 测试建议

建议至少补充以下测试：

1. [agent/tests/test_cli_python.py](agent/tests/test_cli_python.py)
   意图：confirm 成功后模拟 Ctrl+C，断言 finish_attached_task 仍被调用一次，且退出码为非零。

2. [agent/tests/test_cli_python.py](agent/tests/test_cli_python.py)
   意图：若中断发生在 confirm 前，不应发送 finish_attached_task，避免误收尾。

3. [agent/tests/executor/test_attached.py](agent/tests/executor/test_attached.py)
   意图：直接验证 attached 执行器的 KeyboardInterrupt 收尾行为。

4. [agent/tests/daemon/test_service.py](agent/tests/daemon/test_service.py)
   意图：attached running 任务的 pid 已消失时，daemon 会将其收敛为终态并发送更新。

5. [agent/tests/daemon/test_service.py](agent/tests/daemon/test_service.py)
   意图：daemon 已先判死后，迟到的 finish_attached_task 不得覆盖最终状态。

6. [agent/tests/store/test_tasks.py](agent/tests/store/test_tasks.py)
   意图：若引入状态守卫式 finalize helper，验证只有 running 任务可以被 finalize。

7. [agent/tests/test_e2e_smoke.py](agent/tests/test_e2e_smoke.py)
   意图：覆盖完整 Python sugar 路径，确保本地中断后任务不会残留为 running。

## 风险与取舍

### 1. 只修客户端无法彻底防止脏状态

如果本次只做方案 A，确实能解决“用户 Ctrl+C”主路径，但仍会保留其他前台异常退出场景下的 running 残留。

### 2. daemon 兜底要避免终态覆盖竞态

如果 daemon 先将 orphan attached task 判为 failed，而客户端稍后又发送 finish，则必须保证迟到回写不会覆盖既有终态。

### 3. 不建议对 orphan running 自动重排

对于已经进入 running 的 attached_python 任务，不建议自动 requeue。

原因是该任务可能已经执行过部分用户代码，自动重排会带来重复执行风险。更安全的语义是收敛为 failed 或 cancelled，而不是重新排队。

### 4. Windows 信号语义需保守处理

在 Windows 上，Ctrl+C 对父子进程的影响可能不同于类 Unix 环境。实现中应优先采用“尽量等待子进程退出，再做升级终止”的保守策略，避免额外制造双重中断问题。

## 待确认事项

当前尚未拍板的事项如下：

1. Ctrl+C 的最终状态语义：failed 还是 cancelled
2. 本次修复范围：只做客户端根修，还是同时补 daemon 兜底

在以上两项确认后，可进入编码实施阶段。