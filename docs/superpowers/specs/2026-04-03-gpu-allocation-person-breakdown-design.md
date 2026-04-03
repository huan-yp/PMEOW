# GPU Allocation Person Breakdown Design

Date: 2026-04-03

## Summary

This design updates the Agent-mode GPU allocation card so each GPU shows VRAM usage by person or username instead of only Task, User, Unknown, and Free aggregates.

The card remains a per-GPU stacked-bar view. Each occupied segment represents a resolved owner for that GPU at one snapshot in time:

- show person displayName when the usage resolves to a bound person
- otherwise show the system username
- show Unknown only when no reliable username can be derived

The existing raw GPU allocation API remains unchanged. A new derived API provides person-resolved per-GPU segments for UI rendering.

## Goals

- Show per-GPU VRAM occupancy in the GPU allocation card by person or username
- Keep the current multi-GPU layout and total-memory context
- Prefer person displayName over raw username when a binding exists
- Fall back to system username when no person binding exists
- Keep Unknown as an explicit bucket only for usage with no reliable username
- Resolve task and process ownership using one snapshot timestamp so the card stays internally consistent
- Keep the existing raw gpu-allocation route stable for other callers

## Non-Goals

- Changing the Agent metrics payload format
- Replacing the existing server-level person activity summary
- Adding historical person GPU timelines to this card
- Exposing every process or task as a separate visual segment
- Reworking SSH-mode server detail behavior

## Current State

- The current GPU allocation card renders one stacked bar per GPU with four aggregate categories: Task, User, Unknown, and Free.
- The raw Agent metrics payload already includes per-GPU task allocations and per-GPU user processes.
- Ordinary user processes include a system username.
- PMEOW task allocations include taskId and memory values, but not the username directly.
- The server-side mirrored task store persists taskId to user.
- Person resolution already exists for task ownership and for server-local username bindings.
- The current person activity API only returns server-level aggregate totals by person, not per-GPU ownership segments.

## Design Decisions

### 1. Add A Dedicated Resolved GPU Allocation API

Add a new server route dedicated to this card.

Recommended route:

- /api/servers/:id/gpu-allocation/resolved

This route must:

- read the latest metrics snapshot for the server
- use that snapshot timestamp as the attribution timestamp
- derive per-GPU owner segments from the raw gpuAllocation payload
- return a UI-ready response with resolved display names and memory totals

The existing raw route remains unchanged:

- /api/servers/:id/gpu-allocation

Rationale:

- raw collection data and resolved attribution data remain separate
- attribution logic can evolve without changing the raw metrics contract
- the UI can explicitly consume a derived view built for presentation

### 2. Resolve Ownership Per Snapshot

All ownership shown in the card must be resolved against the latest GPU snapshot timestamp.

Resolution order:

For PMEOW task allocations:

1. find the mirrored task by taskId
2. read task.user from the mirrored task record when available
3. resolve person with task override first, then username binding, using the snapshot timestamp
4. if a person resolves, show person displayName
5. otherwise show task.user when available
6. if no person and no username are available, group the usage into Unknown

For ordinary user processes:

1. read the process username from raw gpuAllocation
2. resolve person by server plus username using the snapshot timestamp
3. if a person resolves, show person displayName
4. otherwise show the raw username

For unknown processes:

- keep them in Unknown
- do not guess a username or person

This preserves the user-approved rule:

- person name first
- username second
- Unknown only when no username exists

### 3. Merge Segments By Display Identity Per GPU

Within the same GPU, segments are merged by resolved visual owner identity.

Chosen rule:

- if the resolved person is the same, combine the memory into one segment
- if there is no person but the username is the same, combine the memory into one segment
- if usage cannot be attributed to either person or username, combine it into one Unknown segment

This means a single GPU can show one combined segment for a person even when that total came from both:

- PMEOW task GPU usage
- ordinary user-process GPU usage

This keeps the card readable and matches the goal of answering who is occupying each GPU right now.

### 4. Return A UI-Oriented Response Shape

Recommended response shape:

```ts
interface ResolvedGpuAllocationResponse {
  serverId: string;
  snapshotTimestamp: number;
  perGpu: ResolvedPerGpuAllocation[];
}

interface ResolvedPerGpuAllocation {
  gpuIndex: number;
  totalMemoryMB: number;
  freeMB: number;
  segments: ResolvedGpuAllocationSegment[];
}

interface ResolvedGpuAllocationSegment {
  ownerKey: string;
  ownerKind: 'person' | 'user' | 'unknown';
  displayName: string;
  usedMemoryMB: number;
  personId?: string;
  rawUser?: string;
  sourceKinds: Array<'task' | 'user_process' | 'unknown_process'>;
}
```

Field intent:

- ownerKey is a stable identity key for deterministic color assignment in the UI
- ownerKind tells the UI how the label was resolved
- displayName is the exact label rendered in the card
- usedMemoryMB is the merged segment size
- personId and rawUser are optional metadata for future drill-down or debugging
- sourceKinds preserves provenance without forcing separate segments
- freeMB is returned separately so the UI can continue rendering remaining capacity

Recommended ownerKey rules:

- person: person:<personId>
- user: user:<rawUser>
- unknown: unknown

### 5. Update Only The GPU Allocation Card UI

The server detail page keeps one GPU allocation section, but the content of each per-GPU bar changes.

Per GPU card layout:

1. top row: GPU index and total memory
2. stacked bar: one segment per resolved owner plus Free
3. text legend below the bar: one row or pill per occupied segment with displayName and usedMemoryMB

Chosen display rules:

- keep the multi-GPU structure exactly as today
- replace Task, User, Unknown aggregate occupied segments with person or username segments
- keep Free as the neutral remainder segment
- show one text entry per occupied segment below the bar
- do not split the same owner into separate task and process segments

Example legend entries:

- Alice 4096 MB
- train-user 2048 MB
- Unknown 512 MB

### 6. Use Stable Deterministic Colors In The UI

Segment colors must stay stable across refreshes for the same ownerKey.

Rules:

- derive occupied-segment color from ownerKey with a deterministic palette selection
- reserve a fixed neutral color for Free
- reserve a fixed caution color for Unknown

This avoids the current problem where the meaning of color is only category-based and instead lets the operator build recognition for specific owners.

## API Behavior

### No GPU Allocation Data

If the latest metrics snapshot has no gpuAllocation payload, the resolved route returns null.

The UI continues to render the existing empty state for the GPU allocation card.

### Missing Mirrored Task Or Missing Task User

If a task allocation exists but no mirrored task record is available, or the mirrored task does not include user:

- do not invent a username
- do not show taskId as the primary owner label in the card
- group that usage into Unknown

This preserves the approved display rule and avoids turning the card into a debugging surface.

### Unbound Usernames

If a raw username exists but no person binding resolves:

- display the raw username
- keep ownerKind as user

This makes unbound usage visible without requiring person setup.

## Implementation Notes

- Add a new core-level helper that derives resolved per-GPU segments from latest metrics, mirrored tasks, and person-resolution helpers.
- Keep the existing getServerPersonActivity logic unchanged.
- Add a new web route and UI transport method for the resolved response.
- Update the GPU allocation component to render per-owner segments and legend entries.
- Keep all new behavior scoped to Agent-mode server detail, since SSH mode does not provide this attribution model.

## Error Handling

- If the resolved route fails, the UI should fall back to the existing no-data state for this card rather than crashing the page.
- If a segment resolves to a person with a missing person record, fall back to the raw username when available, otherwise Unknown.
- If freeMB becomes negative after aggregation drift, clamp it to zero in the response or UI, matching the existing card behavior.

## Testing

### Core Tests

- resolves a task segment to person displayName through task user and binding
- falls back from task segment to username when no person binding exists
- merges task and user-process usage for the same resolved person on one GPU
- merges multiple raw rows for the same unresolved username on one GPU
- groups rows with no resolvable username into Unknown

### Web Tests

- returns null from the resolved route when no gpuAllocation exists
- returns per-GPU resolved segments with snapshotTimestamp from latest metrics

### UI Tests

- renders one segment per resolved owner plus Free
- renders legend entries using person name first, username second, Unknown last
- keeps multi-GPU layout intact
- shows merged totals for the same owner on the same GPU

## Rollout Notes

- No migration of historical raw data is required for this card.
- The feature improves current snapshot readability even when no person records exist, because raw usernames still display.
- Existing dashboards and APIs that consume raw gpuAllocation remain unaffected.