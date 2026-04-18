## Agent 职责

### 管理和调度本地任务

- 调度本地任务
  - 提交任务
  - 取消任务
  - 基于历史窗口资源占用信息调度任务
- 维护任务队列状态和任务状态
  - 任务提交时的信息
  - 任务运行时信息
  - 任务被尝试调度时的状态信息
- 维护资源占用状态
  - GPU 占用需要结合任务队列，预留的资源也要考虑

**Agent 本身不做任何持久化**

### 汇报信息

汇报资源占用状态、汇报任务队列和任务状态。

### 对外接口

- 取消任务。
- 调整任务优先级。

## Agent 架构

- `collector/`
  - 给定 `task_queue` 实例，生成硬件资源状态信息。
  - 入口点 `collect_snapshot`
- `queue/`
  - `scheduler.py`：调度逻辑部分
  - `history.py`：维护 GPU 历史窗口信息的数据结构。
- `state/`
  - 主要维护 `task_queue` 实例
- `daemon/`
  - `service.py`：总控编排
  - `runtime_monitor`：进程生命周期管理。
- `executor/`
  - 实际执行任务相关
- `transport/`
  - 和 Web 模块通信


## 采集数据流

``` 
→ GPU 进程和任务队列对齐，得到 per_gpu 分配摘要
→ 采集 CPU/内存/磁盘/网络/进程/本地用户
→ 采集任务队列为 task_snapshot
→ reporter 封装成 UnifiedReport
→ transport 上报
```

## Task 控制流

```
submit
→ queued
→ collect_cycle 评估
→ scheduler 结合当前快照和历史窗口做准入
→ reserve GPU
→ 启动或等待 attached 确认
→ running
→ runtime_monitor/executor 监控任务汇报状态变动
→ task_queue 回收
```