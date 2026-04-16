# GPU Scheduling Reservation Design

## Context

The local agent scheduler currently decides GPU admission from the current machine snapshot plus a historical stability window. The reported failures show two gaps in that logic:

1. Managed PMEOW tasks that declare large VRAM can be treated as cheap when their observed usage is low, which allows later tasks to overcommit the same GPUs.
2. Tasks that omit VRAM are not treated as strict GPU-exclusive owners, so later tasks can still reuse GPUs that should remain blocked.

This design refines local scheduling so declared reservations remain authoritative for managed tasks, unmanaged activity is still protected by history, and exclusive tasks have a clear admission rule.

## Goals

1. Keep managed task reservations authoritative even when observed GPU usage is lower than the declared request.
2. Treat omitted VRAM, or explicit `--vram=0`, as strict GPU exclusivity.
3. Distinguish impossible requests from temporarily blocked requests.
4. Preserve the existing principle that unmanaged activity is judged by a historical window rather than a single noisy sample.
5. Add focused tests for the three reported failures and the new idle-threshold rules.

## Non-Goals

1. No cluster-wide scheduling changes. This remains local-only admission inside the agent daemon.
2. No CLI redesign beyond validating impossible requests more clearly.
3. No attempt to predict future GPU release times.

## Confirmed Rules

### Request Semantics

1. Scheduler admission operates on a concrete resolved GPU count. Existing Python sugar may still default to `1`, but the scheduler must receive a concrete `require_gpu_count` before admission.
2. `require_vram_mb` is `int` type. Omitting `--vram` and explicitly passing `--vram=0` are equivalent; both resolve to `require_vram_mb=0`. No `Optional[int]` / `None` semantics.
3. A task with `require_vram_mb=0` is a strict exclusive GPU task.
4. A task with positive `require_vram_mb` is a shared-capacity task.

### Managed and Unmanaged Accounting

Per GPU, the scheduler keeps two independent resource views:

1. `managed_reserved_mb`
   Sum of declared VRAM for running or reserved PMEOW-managed tasks with positive VRAM on that GPU.
2. `exclusive_owner`
   Marker that the GPU is reserved by a PMEOW-managed exclusive task. While present, no later task may use that GPU.
3. `unmanaged_peak_mb`
   Maximum unmanaged VRAM observed in the history window, multiplied by `1.05`.

Managed reservations do not use the history window and do not shrink based on observed usage. Declared VRAM remains authoritative until the task releases the GPU.

### Safety Margins

1. Global per-GPU schedulable capacity is `total_vram_mb * 0.98`.
2. The unmanaged multiplier is hard-coded to `1.05` for now.
3. Idle thresholds are hard-coded for now:
   - GPU utilization must be less than `3%`
   - VRAM utilization must be less than `3%`
   - Both conditions must hold simultaneously
4. These constants should live in one scheduler-local definition block so they can be promoted to configuration later without changing call sites.

## Admission Model

### Shared-Capacity Tasks

For a task that requests `gpu_count=N` and `vram_mb=X`, a GPU is eligible only if all of the following hold:

1. The GPU is not marked by `exclusive_owner`.
2. `managed_reserved_mb` is included as-is.
3. `unmanaged_peak_mb` is included as-is.
4. `total_vram_mb * 0.98 - managed_reserved_mb - unmanaged_peak_mb >= X`.

The task may launch only when at least `N` GPUs satisfy that rule.

### Exclusive Tasks

For a task that requests `gpu_count=N` and omits VRAM, or uses zero VRAM, a GPU is eligible only if all of the following hold:

1. There is no `exclusive_owner` on the GPU.
2. There is no managed reservation on the GPU now. Any running or reserved managed task on the GPU makes it non-idle even if actual use is small.
3. Unmanaged activity is idle across the history window.
4. The GPU is currently idle by threshold: utilization below `3%` and VRAM utilization below `3%`.

The task may launch only when at least `N` GPUs satisfy that rule. Once selected, those GPUs receive an `exclusive_owner` marker and remain blocked for later tasks until the task exits.

## Impossible vs Waiting Requests

The scheduler should separate requests that can never fit on this node from requests that are only temporarily blocked.

### Immediate Failure (Submission-Time Rejection)

Reject at submission time in `DaemonService` or `socket_server`, before the task enters the queue, when either condition holds:

1. Requested GPU count is greater than physical GPU count.
2. Positive per-GPU VRAM request is physically satisfiable on fewer than the requested number of GPUs, where each GPU's physical schedulable limit is `total_vram_mb * 0.98`.

Implement as `validate_request_possible(per_gpu, require_gpu_count, require_vram_mb) -> str | None`. Return an error message if impossible, `None` if feasible. Call this at the submission path so impossible requests never enter the queue.

### Wait

Enter queue wait when the request is physically possible on this node, but there are not enough currently eligible GPUs because of:

1. Exclusive ownership
2. Managed declared reservations
3. Unmanaged historical peak usage
4. Insufficient eligible GPU count after applying the rules above

## Implementation Shape

### Preferred Approach

Use a dual-ledger scheduler model.

Why:

1. It matches the confirmed business rules directly.
2. It keeps managed declarations and unmanaged history separate, which avoids rule leakage.
3. It makes the reported failures easy to express in tests.

### Per-GPU Utilization Collection

Current snapshot only has aggregated GPU utilization. The scheduler needs per-GPU utilization for exclusive idle checks.

1. `gpu.py` adds `collect_per_gpu_utilization()` querying `nvidia-smi --query-gpu=index,utilization.gpu`.
2. `models.py` adds `utilization_percent: float` to `PerGpuAllocationSummary`.
3. `snapshot.py` calls the new collector and populates the field.
4. `gpu_attribution.py` passes utilization through.

### Constants Block

All scheduling constants live in one block at the top of `scheduler.py`:

```python
CAPACITY_FACTOR = 0.98
UNMANAGED_MULTIPLIER = 1.05
IDLE_UTILIZATION_THRESHOLD = 3.0
IDLE_VRAM_UTILIZATION_THRESHOLD = 3.0
```

These can be promoted to configuration later without changing call sites.

### GpuLedger Dataclass

Introduce a scheduler-internal `GpuLedger` dataclass per GPU:

```python
@dataclass
class GpuLedger:
    gpu_index: int
    total_vram_mb: float
    schedulable_mb: float          # total_vram_mb * CAPACITY_FACTOR
    managed_reserved_mb: float     # sum of declared VRAM for managed tasks on this GPU
    exclusive_owner: str | None    # task_id of exclusive owner, or None
    unmanaged_peak_mb: float       # max unmanaged VRAM in history window * UNMANAGED_MULTIPLIER
    utilization_percent: float     # current GPU utilization %
    vram_utilization_percent: float # current VRAM utilization %
    effective_free_mb: float       # schedulable_mb - managed_reserved_mb - unmanaged_peak_mb
```

Build via `_build_gpu_ledgers(current_per_gpu, history, pending, exclusive_pending)`:
- `managed_reserved_mb` from current snapshot's `pmeow_tasks` declared VRAM.
- `unmanaged_peak_mb` from history window's unmanaged VRAM maximum * `UNMANAGED_MULTIPLIER`.
- `exclusive_owner` from running tasks with `require_vram_mb=0`.

### Same-Batch Exclusive Pending

Within a single `try_schedule` round, if an exclusive task is selected for launch, its GPUs are added to `exclusive_pending: set[int]`. Subsequent tasks in the same batch treat those GPUs as unavailable. This prevents the scheduler from double-booking GPUs within one scheduling cycle.

### Admission Predicates

Keep shared-task and exclusive-task admission as separate predicates:

- `_eligible_shared(ledger: GpuLedger, require_vram_mb: int) -> bool`
- `_eligible_exclusive(ledger: GpuLedger, history_samples, gpu_index: int) -> bool`

### Submission-Time Validation

`validate_request_possible(per_gpu, require_gpu_count, require_vram_mb) -> str | None` is called at the submission path in `DaemonService` or `socket_server`. Impossible requests are rejected before entering the queue.

### effective_free_mb in Attribution Layer

`effective_free_mb` computed in `gpu_attribution.py` is for display and reporting only. All scheduling decisions use `GpuLedger.effective_free_mb` computed inside the scheduler. This avoids coupling the admission logic to the attribution/snapshot pipeline.

### Other Internal Changes

1. Rewrite `try_schedule` to use `GpuLedger` list, maintain `pending` and `exclusive_pending` sets, and route through shared/exclusive predicates.
2. Delete legacy functions: `check_sustained`, `_eligible_gpus`, `_all_samples`, `_min_free_by_gpu`, `_analyze_sustained`.
3. Keep the final GPU selection path unchanged where possible so attached launch reporting and `CUDA_VISIBLE_DEVICES` handling remain stable.

## Logging and Observability

Waiting logs should be more explicit about why a task is blocked. At minimum, the scheduler should distinguish:

1. blocked by exclusive GPUs
2. blocked by managed declared reservations
3. blocked by unmanaged historical usage
4. blocked by insufficient eligible GPU count after filtering

Existing reservation logs that print the selected GPU list should remain.

## Test Plan

Add or update scheduler-centric tests first, with one service-level integration test only if needed to cover attached launch behavior.

Required coverage:

1. Declared-large, observed-small managed reservation still blocks later shared task.
   - Example: on four 3090 GPUs, first task reserves two GPUs at `21g`, later task requests two GPUs at `8g`, and the later task must not launch if only GPUs behind the managed declaration would make it fit.
2. Physically impossible request fails immediately.
   - Example: request exceeds physical GPU count, or per-GPU VRAM exceeds the node's schedulable physical limit.
3. Omitted or zero VRAM behaves as strict exclusivity.
   - Later tasks cannot reuse GPUs selected by the exclusive task.
4. Exclusive idle checks use both managed-current and unmanaged-history constraints.
   - A GPU with any managed reservation is not idle, even if observed usage is low.
   - A GPU with unmanaged usage above idle threshold anywhere in the window is not idle.
5. Shared-capacity checks subtract both ledgers.
   - `managed_reserved_mb` and `unmanaged_peak_mb` both reduce schedulable capacity.
6. Idle threshold boundary coverage.
   - Below `3%` for both metrics counts as idle.
   - At or above `3%` for either metric does not count as idle.

## Acceptance Criteria

The design is successful when all of the following are true:

1. A managed task with a large declaration continues to block capacity according to its declaration, not its observed usage.
2. Exclusive tasks only land on GPUs that satisfy the stricter idle definition and then lock those GPUs for later tasks.
3. Impossible requests fail immediately with a clear reason.
4. Temporarily blocked but physically possible requests remain queued.
5. The three reported scenarios are covered by automated tests and pass consistently.