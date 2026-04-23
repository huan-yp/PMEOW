# PMEOW VRAM 独占自动回收语义重设计

## 1. 背景

当前仓库已经部分区分“未填写 VRAM”和“显式填写 0”，但语义仍散落在旧数字字段和派生布尔字段中。这解决了部分调度歧义，但还存在三个问题：

- 语义仍分散在旧数字字段和布尔字段中，无法直接表达“独占自动模式”和“共享模式”。
- 独占任务启动后没有观察窗口，也没有一次性回收到共享预留的机制。
- Web、Mobile、日志、调度详情仍主要基于旧字段渲染，容易继续把数字和语义混在一起。

本设计将 VRAM 语义升级为显式模式字段，并加入独占自动任务的观察与一次性回收。

## 2. 硬约束

1. 采用显式字段 `requestedVramMb + vramMode` 作为唯一业务语义源。
2. 不做旧语义兼容，不引入 `legacy_zero_exclusive`。
3. 不新增自动化测试，不调整现有测试策略。
4. 不做 OOM fallback、动态二次调整、回收失败兜底。
5. 不做大规模 UI 或跨端 formatter 抽象重构。

## 3. 语义契约

任务级字段：

```ts
type VramMode = 'exclusive_auto' | 'shared';

requestedVramMb: number | null;
vramMode: VramMode;
```

语义矩阵：

| 用户输入 | `requestedVramMb` | `vramMode` | 调度行为 |
| --- | ---: | --- | --- |
| 不填 `--vram` | `null` | `exclusive_auto` | 独占启动，观察窗口后可一次性回收 |
| 显式 `--vram 0` | `0` | `shared` | 共享调度，单卡预留 0 |
| 显式 `--vram N` | `N` | `shared` | 共享调度，单卡预留 N |

旧 omit 布尔字段不再保留；`require_vram_mb` 仅作为数值型派生字段保留，不能作为调度、采集、展示、日志的主判断依据。

## 4. 数据模型

新增或规范化任务字段：

1. `requested_vram_mb: int | None` / `requestedVramMb: number | null`
2. `vram_mode: "exclusive_auto" | "shared"` / `vramMode`
3. `auto_observe_window_sec: int | None` / `autoObserveWindowSec`
4. `auto_peak_vram_by_gpu_mb: dict[int, int] | None` / `autoPeakVramByGpuMb: Record<number, number> | null`
5. `auto_reclaimed_vram_by_gpu_mb: dict[int, int | None] | None` / `autoReclaimedVramByGpuMb: Record<number, number | null> | null`
6. `auto_reclaim_done: bool` / `autoReclaimDone`

字段含义：

| 字段 | 含义 |
| --- | --- |
| `requestedVramMb` | 用户原始 VRAM 输入；未填为 `null`，显式 0 保留为 `0` |
| `vramMode` | 调度和展示的唯一语义源 |
| `autoObserveWindowSec` | `exclusive_auto` 任务的观察窗口长度，默认 300 秒 |
| `autoPeakVramByGpuMb` | 观察窗口内该任务在每张 assigned GPU 上分别记录的实际显存峰值 |
| `autoReclaimedVramByGpuMb` | 回收后每张 GPU 各自的声明预留；任务尚未完成观察时为 `null`，观察完成后每个 assigned GPU 都有一个键，值为数字表示该 GPU 已回收，值为 `null` 表示该 GPU 仍保持独占 |
| `autoReclaimDone` | 观察回收流程是否已经完成；完成后不再二次调整 |

## 5. Agent 设计

### 5.1 输入解析

后台提交和前台提交都按同一规则生成语义字段：

```text
--vram 未出现:
  requested_vram_mb = None
  vram_mode = exclusive_auto

--vram 0:
  requested_vram_mb = 0
  vram_mode = shared

--vram N:
  requested_vram_mb = N
  vram_mode = shared
```

影响文件：

- `agent/pmeow/__main__.py`
- `agent/pmeow/cli_foreground.py`
- `agent/pmeow/daemon/socket_server.py`

### 5.2 模型

`TaskSpec`、`TaskRecord`、`TaskInfo` 增加第 4 节字段。

影响文件：

- `agent/pmeow/models.py`
- `agent/pmeow/state/task_queue.py`

`TaskQueue.reserve()` 设置启动阶段声明预留时：

- `vramMode == shared`：`declared_vram_per_gpu = requested_vram_mb`
- `vramMode == exclusive_auto`：启动阶段仍可使用 `declared_vram_per_gpu = 0` 作为内部哨兵值

独占判断不得读取 `declared_vram_per_gpu == 0`。回收后的 per-GPU 预留以 `auto_reclaimed_vram_by_gpu_mb[gpu_id]` 为准，不再试图用单个 `declared_vram_per_gpu` 表达多 GPU 任务的各卡差异。

### 5.3 调度器

调度分支：

```text
if task.vram_mode == exclusive_auto:
  use exclusive admission for GPUs where auto_reclaimed_vram_by_gpu_mb[gpu_id] is absent or null
else:
  use shared admission with per-GPU reservation
```

共享预留值：

```text
if task.auto_reclaimed_vram_by_gpu_mb[gpu_id] is a number:
  reservation_mb_for_gpu = task.auto_reclaimed_vram_by_gpu_mb[gpu_id]
else:
  reservation_mb_for_gpu = task.requested_vram_mb or 0
```

影响文件：

- `agent/pmeow/queue/scheduler.py`

调度器不再从 `require_vram_mb == 0` 或 `declared_vram_mb == 0` 推导独占。

### 5.4 采集与账本

新增内部 helper，用于统一判断一个任务当前是否仍占用整卡：

```text
is_exclusive_active(task, gpu_id):
  task.vram_mode == exclusive_auto
  and task.auto_reclaimed_vram_by_gpu_mb[gpu_id] is absent or null
```

账本规则：

- active exclusive task：整卡不可共享，展示为整卡 reserved。
- reclaimed exclusive task：对每张 GPU 独立判断；有数值的 GPU 按 `auto_reclaimed_vram_by_gpu_mb[gpu_id]` 计入 managed reserved，不再阻塞该 GPU；值为 `null` 或缺失的 GPU 仍阻塞整卡。
- shared task：按 `requested_vram_mb` 计入 managed reserved，可为 0。

影响文件：

- `agent/pmeow/collector/gpu_attribution.py`
- `agent/pmeow/collector/snapshot.py`
- `agent/pmeow/queue/scheduler.py`

### 5.5 Daemon 观察与一次性回收

`DaemonService.collect_cycle()` 在采集完成、状态机 tick 后、发送 report 前处理独占自动任务。

观察对象：

- `status == running`
- `vram_mode == exclusive_auto`
- `auto_reclaim_done == false`
- `assigned_gpus` 非空

观察窗口：

- 从 `started_at` 开始计时。
- 默认 `auto_observe_window_sec = 300`。
- 每轮 collect 根据 `per_gpu.pmeow_tasks` 中该 task 在各 assigned GPU 上的 `actual_vram_mb` 分别更新 `auto_peak_vram_by_gpu_mb[gpu_id]`。

回收条件：

```text
window_elapsed = now >= started_at + auto_observe_window_sec
has_peak_for_gpu = auto_peak_vram_by_gpu_mb[gpu_id] is not None
below_threshold_for_gpu = auto_peak_vram_by_gpu_mb[gpu_id] < gpu_total_memory_mb[gpu_id] * 0.7
```

回收值：

```text
auto_reclaimed_vram_by_gpu_mb[gpu_id] =
  ceil(max(auto_peak_vram_by_gpu_mb[gpu_id] * 1.1, auto_peak_vram_by_gpu_mb[gpu_id] + 512))
```

多 GPU 任务必须按 GPU 分别计算峰值、阈值、回收值和是否继续独占。不能用所有 assigned GPUs 的最大峰值生成统一每卡预留，也不能因为一张 GPU 未达回收条件就让其他 GPU 放弃回收。

窗口结束行为：

- 对每张 assigned GPU 独立决策。
- 某 GPU 有峰值且低于该 GPU 阈值：`auto_reclaimed_vram_by_gpu_mb[gpu_id] = reclaim_mb`，该 GPU 不再独占。
- 某 GPU 无峰值：`auto_reclaimed_vram_by_gpu_mb[gpu_id] = null`，该 GPU 保持独占。
- 某 GPU 峰值不低于该 GPU 阈值：`auto_reclaimed_vram_by_gpu_mb[gpu_id] = null`，该 GPU 保持独占。
- 所有 assigned GPU 都完成决策后设置 `auto_reclaim_done=true`。

完成后不再调整。

影响文件：

- `agent/pmeow/daemon/service.py`

## 6. Contracts 与 Server 设计

### 6.1 Contracts

`server/contracts/src/types.ts` 增加：

```ts
export type VramMode = 'exclusive_auto' | 'shared';
```

`TaskInfo`、`TaskRecord` 增加第 4 节字段。

`server/contracts/src/protocol.ts` normalize 后透传新字段。若新 agent 未提供字段，按当前新规则兜底推导，但不做旧语义兼容：

```text
if vramMode == exclusive_auto:
  requestedVramMb = null
else:
  requestedVramMb = requireVramMb when requestedVramMb is missing
```

这里的兜底只是为了避免缺字段崩溃，不引入旧 `0 == exclusive` 解释。

### 6.2 DB

`tasks` 表增列：

```sql
requested_vram_mb INTEGER;
vram_mode TEXT NOT NULL DEFAULT 'shared';
auto_observe_window_sec INTEGER;
auto_peak_vram_by_gpu_mb TEXT;
auto_reclaimed_vram_by_gpu_mb TEXT;
auto_reclaim_done INTEGER NOT NULL DEFAULT 0;
```

`auto_peak_vram_by_gpu_mb` 存储 JSON 对象，键为 GPU id 字符串，值为 MB 整数，例如 `{"0": 6200, "1": 9100}`。`auto_reclaimed_vram_by_gpu_mb` 的值可以是 MB 整数或 `null`，例如 `{"0": 7000, "1": null}` 表示 GPU 0 已回收到 7000 MB，GPU 1 仍保持独占。

迁移规则：

```text
不做任务表迁移。上线时直接删除现有 SQLite 数据库文件，由新 schema 重新创建。
```

不检查创建时间，不引入版本切点，不保留旧 `require_vram_mb=0 => exclusive`。

影响文件：

- `server/core/src/db/database.ts`
- `server/core/src/db/tasks.ts`
- `server/core/src/task/engine.ts`

### 6.3 API 输出

任务列表、任务详情、人员任务列表直接返回新字段。

影响文件：

- `server/runtime/src/routes/task-routes.ts`
- `server/runtime/src/routes/person-routes.ts`
- `apps/common/src/types.ts`

## 7. Web 与 Mobile 展示

统一文案：

| `vramMode` | `requestedVramMb` | 文案 |
| --- | ---: | --- |
| `exclusive_auto` | `null` | `独占（自动观察）` |
| `shared` | `0` | `0 MB（共享 / 不预留）` |
| `shared` | `N` | `N MB（共享）` |

任务详情新增或调整展示：

| 项 | 文案来源 |
| --- | --- |
| 模式 | `vramMode` |
| 请求 VRAM | `requestedVramMb` |
| 观察窗口 | `autoObserveWindowSec` |
| 观察峰值 | `autoPeakVramByGpuMb`，按 GPU 展示 |
| 回收状态 | `autoReclaimDone + autoReclaimedVramByGpuMb` |
| 回收后预留 | `autoReclaimedVramByGpuMb`，按 GPU 展示 |

回收状态文案：

```text
vramMode != exclusive_auto:
  不适用

vramMode == exclusive_auto && !autoReclaimDone:
  观察中

autoReclaimDone && autoReclaimedVramByGpuMb != null:
  按 GPU 显示：GPU 0 已回收至 N MB；GPU 1 未回收，保持独占

autoReclaimDone && autoReclaimedVramByGpuMb == null:
  未生成回收结果，保持独占
```

影响文件：

- `apps/web/src/utils/vram.ts`
- `apps/web/src/components/TaskBrowser.tsx`
- `apps/web/src/pages/TaskDetail.tsx`
- `apps/web/src/hooks/useMetrics.ts`
- `apps/mobile/src/components/common.tsx`
- `apps/mobile/src/screens/PersonTaskDetailScreen.tsx`
- `apps/mobile/src/store/useAppStore.ts`

## 8. 日志与调度详情

任务日志提交模板：

```text
submitted task <id> ... vram_mode=exclusive_auto requested_vram=null
submitted task <id> ... vram_mode=shared requested_vram=0MB
submitted task <id> ... vram_mode=shared requested_vram=<N>MB
```

调度日志模板：

```text
schedule scheduled: need <G> idle GPU(s) in exclusive_auto mode; ...
schedule scheduled: need <G> GPU(s) with >= <N> MB in shared mode; ...
```

回收日志模板：

```text
auto reclaim observed: peaks={gpu0=<N>MB,gpu1=<M>MB} window=<S>s
auto reclaim applied: reserved={gpu0=<N>MB,gpu1=<M>MB} peaks={gpu0=<P>MB,gpu1=<Q>MB}
auto reclaim skipped: gpu=<G> peak=<P>MB threshold=<T>MB keep exclusive
auto reclaim skipped: gpu=<G> no peak sample keep exclusive
```

调度详情 `gpuSnapshot` 增加：

```text
requestedVramMb
vramMode
autoObserveWindowSec
autoPeakVramByGpuMb
autoReclaimedVramByGpuMb
autoReclaimDone
```

## 9. 错误处理

输入错误：

- `requestedVramMb` 不能为负数。
- `vramMode == exclusive_auto` 时 `requestedVramMb` 必须为 `null`。
- `vramMode == shared` 时 `requestedVramMb` 必须为非负数。

协议缺字段：

- 允许 normalize 按第 6.1 节新规则兜底。
- 不按旧 `0 == exclusive` 解释。

观察缺样本：

- 窗口结束时，某张 GPU 无峰值样本则该 GPU 保持独占。
- 每张 GPU 分别写日志；所有 assigned GPU 都决策完后设置 `autoReclaimDone=true`，避免无限观察。

任务提前结束：

- 不执行回收。
- 保留已观察到的 `autoPeakVramByGpuMb`。

## 10. 人工验收点

不新增自动化测试。本次完成后用人工验收确认：

1. 不填 `--vram` 的任务显示为 `独占（自动观察）`。
2. 显式 `--vram 0` 的任务显示为 `0 MB（共享 / 不预留）`。
3. 显式 `--vram 0` 不进入独占调度分支。
4. `exclusive_auto` 任务启动时独占整卡。
5. 观察窗口结束后最多执行一次回收。
6. 某张 GPU 回收成功后，任务不再阻塞该 GPU 的共享调度。
7. 某张 GPU 回收失败或无样本时，该 GPU 保持独占，不影响其他 GPU 的回收结果。
8. 多 GPU 任务按每张 GPU 分别记录峰值并分别计算回收预留。
9. 任务日志包含提交语义、逐 GPU 观察峰值、逐 GPU 回收结果。
10. Web 任务详情显示模式、窗口、逐 GPU 峰值、回收状态。
11. Mobile 任务详情和队列摘要显示相同语义。

## 11. 范围外

- 不做旧语义兼容。
- 不引入 `legacy_zero_exclusive`。
- 不新增自动化测试。
- 不修改历史任务显示为“旧语义独占”。
- 不新增 OOM fallback。
- 不新增动态扩容或二次回收。
- 不做跨端 UI 架构重构。
- 不改变现有优先级和 sustained window 调度逻辑。

## 12. 自审结果

- Placeholder scan：无未决项或未填章节。
- Internal consistency：字段、调度、回收、展示均以 `vramMode` 为唯一语义源；多 GPU 峰值、回收值、独占状态均按 GPU 分别表达。
- Scope check：范围集中在 VRAM 语义、一次性回收、展示透传，可作为一个实现阶段推进。
- Ambiguity check：历史数据明确不做旧语义兼容，`0` 一律按共享 0 处理。
