# 数据摄入链路

Agent 定时上报 `UnifiedReport`，`IngestPipeline` 作为唯一入口接收并分发给各领域模块。

## 入口

- `IngestPipeline`（`ingest/pipeline.ts`）是所有汇报数据的唯一接收点。
- 外部只需调用 `pipeline.processReport(serverId, report)`。
- Pipeline 内部维护一份 `latestReports: Map<serverId, UnifiedReport>` 缓存，用于提供上一轮汇报给下游 diff。

## 处理步骤

收到一轮 `UnifiedReport` 后，Pipeline 按固定顺序执行以下六步：

### 1. 缓存当前汇报

将本轮 report 存入 `latestReports`，覆盖上一轮。

### 2. Metrics 推送

通过 `onMetricsUpdate` 回调将完整 report 推送给前端（实时仪表盘刷新）。

### 3. 任务处理

委托 `TaskEngine`（`task/engine.ts`）。

- 输入：上一轮 report（来自缓存）和本轮 report。
- `TaskEngine` 提取 active 集合（`queued + running`）和 `recentlyEnded`，调用 `diffTasks`（`task/differ.ts`）计算状态变化。
- 对每条 diff 结果：active 走 `upsertTask`，ended 走 `endTask`，每条落库后立即生成 `TaskEvent`。
- Pipeline 遍历返回的 `TaskEvent[]`，通过 `onTaskEvent` 回调逐条广播。

详见 [任务事件模型](任务事件模型.md)。

### 4. 告警闭环

委托 `AlertEngine`（`alert/engine.ts`）。

- 输入：本轮 report 和全局 `AppSettings`。
- `AlertEngine` 内部：
  1. 调用 `detectThresholds`（无状态）检测 CPU/内存/磁盘/GPU 温度阈值。
  2. 调用 `detectGpuIdle`（有状态，依赖 `AlertStateStore`）检测 GPU 空占显存。
  3. 将所有异常交给 `reconcileAlerts`（`db/alerts.ts`）与数据库中的告警表做闭环——新异常转 `ACTIVE`、已消失异常转 `RESOLVED`、`SILENCED` 不受影响。
- Pipeline 只广播可推送的变化（新 ACTIVE 和 ACTIVE→RESOLVED），通过 `onAlertStateChange` 回调。

> 离线检测不在汇报链路中。`AlertEngine.sweepOffline` 由应用层定时器独立调用。

详见 [告警事件处理](告警事件处理.md)。

### 5. 安全检查

委托 `processSecurityCheck`（`security/pipeline.ts`）。

- 调用 `analyzeReport` 扫描可疑进程（挖矿关键词）和无主 GPU 占用。
- 对每条发现，查数据库去重（同 fingerprint 已有未关闭记录则跳过），新发现落库。
- 通过 `onSecurityEvent` 回调广播新事件。

### 6. 快照落盘

委托 `SnapshotScheduler`（`ingest/snapshot-scheduler.ts`）。

- 按 `snapshotRecentIntervalSeconds` 和 `snapshotArchiveIntervalSeconds` 两档节奏，决定是否写入 `recent` / `archive` 快照。
- `recent` 快照写入后会清理超出 `snapshotRecentKeepCount` 的旧记录。
- `archive` 快照只写入不清理。

## 数据流总览

```
Agent ──UnifiedReport──▶ IngestPipeline.processReport()
                            │
                            ├─ 1. latestReports 缓存
                            │
                            ├─ 2. onMetricsUpdate ──▶ 前端实时刷新
                            │
                            ├─ 3. TaskEngine.processReport()
                            │      ├─ diffTasks()
                            │      ├─ upsertTask / endTask (DB)
                            │      └─▶ TaskEvent[] ──▶ onTaskEvent
                            │
                            ├─ 4. AlertEngine.processReport()
                            │      ├─ detectThresholds()
                            │      ├─ detectGpuIdle(StateStore)
                            │      ├─ reconcileAlerts (DB)
                            │      └─▶ AlertStateChange[] ──▶ onAlertStateChange
                            │
                            ├─ 5. processSecurityCheck()
                            │      ├─ analyzeReport()
                            │      ├─ 去重 + 落库 (DB)
                            │      └─▶ SecurityEventRecord[] ──▶ onSecurityEvent
                            │
                            └─ 6. SnapshotScheduler
                                   ├─ saveSnapshot(recent) + 清理
                                   └─ saveSnapshot(archive)
```

## 回调接口

Pipeline 构造时接收 `IngestCallbacks`，由上层（web 模块）注入具体实现：

| 回调 | 触发时机 | 载荷类型 |
|---|---|---|
| `onMetricsUpdate` | 每轮汇报 | `(serverId, UnifiedReport)` |
| `onTaskEvent` | 任务状态变化 | `TaskEvent` |
| `onAlertStateChange` | 告警状态迁移（仅可广播的） | `AlertStateChange` |
| `onSecurityEvent` | 新安全事件 | `SecurityEventRecord` |

## 文件索引

| 文件 | 职责 |
|---|---|
| `ingest/pipeline.ts` | 编排入口，串联所有步骤 |
| `ingest/snapshot-scheduler.ts` | 快照节奏控制（内存计时器） |
| `task/engine.ts` | 任务摄入唯一入口 |
| `task/differ.ts` | 任务 diff 算法 |
| `task/events.ts` | 任务事件类型 |
| `task/service.ts` | 任务查询和控制 |
| `alert/engine.ts` | 告警引擎入口 |
| `alert/state-store.ts` | 告警状态表（内存，重启丢失） |
| `alert/detectors.ts` | 阈值/GPU空占/离线检测 |
| `security/pipeline.ts` | 安全检查编排 |
| `security/analyzer.ts` | 安全分析（挖矿关键词、无主GPU） |
| `db/alerts.ts` | 告警闭环落库（reconcile） |
| `db/tasks.ts` | 任务落库（upsert/end） |
| `db/snapshots.ts` | 快照落库与查询 |
| `db/settings.ts` | 全局设置读写 |
