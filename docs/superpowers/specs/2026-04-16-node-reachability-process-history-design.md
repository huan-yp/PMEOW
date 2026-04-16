# Node Reachability And Process History Design

Date: 2026-04-16

## Summary

This design unifies node status presentation across the overview and node detail surfaces, and introduces a dedicated process-history model for retention, replay, and process-level analysis.

The status presentation change standardizes each node on two side-by-side status signals:

- left: online state
- right: internet reachability state

The process-history change introduces a layered storage strategy:

- short-term raw process snapshots retained for 72 hours
- long-term bucketed Top-N process summaries plus per-bucket totals retained beyond the raw window

The first user-facing history feature is timeline replay of the full process list at a selected time. A later follow-up adds a single-process trajectory view.

## Goals

- Show online state and internet reachability together for every node in the runtime view
- Show online state and internet reachability together in the overview summary
- Keep the status presentation visually consistent across node card, overview summary, and node detail header
- Add process-table sorting by CPU, memory, RSS, VRAM, and per-process GPU utilization
- Add simple process-table filters for common operator workflows
- Retain process history with a storage model that supports replay without keeping all raw data forever
- Make timeline replay the primary first-step process history experience
- Preserve a path to later add single-process trajectory analysis
- Keep the design compatible with both current metrics retention and existing node types

## Non-Goals

- Reworking the full layout language of the overview page
- Replacing the current metrics history pipeline for CPU, memory, disk, network, and GPU node metrics
- Providing full-fidelity raw process history for long-term retention windows
- Delivering perfect per-process GPU utilization coverage on every node type in v1
- Building a general-purpose investigation notebook or arbitrary multi-metric replay system

## Current State

- Node cards already show online state, but internet reachability is only surfaced as a separate aggregate indicator and historical chart rather than a peer status badge.
- The overview page currently treats node presence and internet reachability as separate summary cards.
- The node detail page already shows online state in the header and internet reachability in history charts, but not as a paired status indicator in the primary header summary.
- The process panel currently renders a static table of audit rows with no interactive sorting, filtering, replay controls, or historical retrieval model.
- Current process audit rows contain CPU percent, memory percent, RSS, VRAM, ownership, and suspicious reasons, but not per-process GPU utilization.
- Raw metrics snapshots already persist process arrays inside the metrics table, and raw metrics retention defaults to 7 days.
- Existing metrics aggregation only summarizes node-level metrics and internet reachability ratios; it does not summarize process history.

## Design Decisions

### 1. Standardize Dual Status Presentation

All node-oriented surfaces will present two status badges in a fixed left-right order.

Display rule:

- left badge: online status
- right badge: internet reachability status

Online badge states:

- online
- connecting
- error
- offline

Internet badge states:

- reachable
- unreachable
- unprobed

Unprobed is explicit. The UI must not hide missing internet probe data, because operators need to distinguish between a healthy probe result and missing capability or stale reporting.

This same left-right rule applies to:

- node runtime cards
- overview summary card
- node detail header

Rationale:

- operators should not need to reinterpret status placement between surfaces
- online and internet reachability answer different operational questions and should be visible together
- missing probe data is operationally important and should not collapse into offline or unreachable

### 2. Replace Split Overview Aggregates With One Combined Status Summary

The overview summary replaces separate presence and internet cards with one combined status card.

Combined card structure:

- left side: online-state totals
- right side: internet-state totals

Left-side totals:

- online
- offline
- connecting
- error when present

Right-side totals:

- reachable
- unreachable
- unprobed

This combined card becomes the canonical high-level fleet status summary.

Rationale:

- it matches the desired user mental model of left = node presence and right = internet state
- it reduces card fragmentation in the overview header
- it keeps the per-node and fleet-level status language aligned

### 3. Extend Process Table With Interactive Sorting And Simple Filtering

The process panel becomes an operator-oriented table rather than a static audit dump.

Sorting to support in the first release:

- CPU percent
- memory percent
- RSS
- VRAM
- per-process GPU utilization percent

Basic filter set for the first release:

- only GPU processes
- only suspicious processes
- only processes resolved to a bound person

Sorting behavior:

- default sort is descending by CPU percent
- clicking the active sort toggles descending and ascending
- rows with missing values for the active sort field sort after rows with real values in descending mode and before them in ascending mode only when necessary for deterministic ordering

Filtering behavior:

- filters are combinable
- filters are local to the current table view and do not mutate server-side data
- replay mode uses the same sorting and filtering controls as the live table

Rationale:

- these sorts and filters cover the common first-pass workflows: resource triage, GPU occupancy review, and suspicious process review
- keeping sorting and filtering local avoids overcomplicating the initial history API

### 4. Add Per-Process GPU Utilization As A Progressive Capability

Per-process GPU utilization is required for the requested GPU sorting behavior, but it is not present in the current process model.

The model will therefore be extended with an optional per-process GPU utilization field.

Design rule:

- nodes that can collect per-process GPU utilization expose it
- nodes that cannot collect it return no value for that field
- the UI displays N/A when the field is absent
- VRAM remains available regardless of GPU utilization capability

This is an explicitly progressive capability model rather than a hard requirement that every node type produce comparable data on day one.

Expected compatibility behavior:

- Agent nodes with supported NVIDIA tooling are the primary first target
- unsupported environments continue to function with CPU, memory, RSS, and VRAM sorting
- the process table can still expose GPU-utilization sorting, but rows without values are visibly incomplete rather than misleadingly zero

Rationale:

- the user requirement is real, but forcing universal support before release would block the broader process-history work
- N/A is more honest than synthesizing fake GPU utilization values

### 5. Create A Dedicated Process-History Storage Layer

Process history should not rely solely on replaying large raw metrics JSON blobs from the generic metrics table.

Instead, add a dedicated process-history storage layer with two tiers.

Tier 1: raw process snapshots

- stores per-snapshot process rows needed for accurate short-term replay
- retained for 72 hours
- intended for timeline playback and recent incident investigation

Tier 2: bucketed long-term summaries

- stores Top-N process rows for each time bucket
- stores per-bucket aggregate totals for the full process set
- retained beyond the 72-hour raw window

Chosen default retention profile:

- raw snapshots: 72 hours
- 1-minute process summary buckets: 7 days
- 15-minute process summary buckets: 90 days

This mirrors the existing raw-plus-aggregate philosophy already used for node metrics, but with a process-specific schema.

### 6. Define What Long-Term Process Summaries Preserve

Each long-term process-summary bucket preserves two things.

First, Top-N process rows.

Chosen bucket contents for each Top-N item:

- process identity key
- pid
- createTime or startTime
- user
- resolved person information when available
- command summary
- CPU percent
- memory percent
- RSS
- VRAM
- per-process GPU utilization percent when available
- suspicious flag or reasons summary

Second, bucket-level totals.

Required per-bucket totals:

- total process count
- GPU process count
- suspicious process count
- summed CPU percent across visible processes
- summed RSS
- summed VRAM

Chosen Top-N ranking rule for summary storage:

- rank primarily by a configurable resource score that favors GPU utilization, VRAM, CPU, and RSS
- keep the ranking implementation internal so the UI can request the bucket and render its preserved list without recomputing from dropped rows

Chosen default Top-N size:

- 20 processes per bucket

Rationale:

- Top-N rows preserve the most operationally relevant processes without long-term raw explosion
- bucket totals preserve system-level context so operators can see whether preserved rows explain most activity or only a small visible slice

### 7. Define Stable Process Identity For History And Trajectory Views

PID alone is not a stable long-term process identity because PIDs are reused.

The historical identity model must therefore use a composite identity.

Chosen identity:

- serverId
- pid
- createTime or startTime

Fallback metadata:

- command hash or normalized command text
- username

Design rule:

- replay views operate on snapshot rows and do not require stitched identity
- single-process trajectory views require stitched identity using the composite key

Rationale:

- without process start time, a long-range trajectory risks incorrectly merging unrelated processes that reused the same PID

### 8. Make Timeline Replay The First History Experience

The first history UI feature is replay of the full process list over time on a single node.

Replay UI elements:

- time range selector
- timeline scrubber
- play and pause controls
- previous and next step controls
- timestamp label for the current frame

Replay behavior:

- the operator picks a time range within the retained raw window
- the UI loads frame metadata or summary points for the range
- selecting a frame loads the process list for that snapshot timestamp
- the process table updates in place and reuses the same sort and filter controls as the live view

Loading strategy:

- do not fetch the full raw process list for all timestamps up front
- fetch a lightweight frame index first
- fetch the selected frame on demand

Rationale:

- this is the most direct answer to “what was happening on this node at that time?”
- on-demand frame loading keeps the first implementation bounded even with large process sets

### 9. Plan Single-Process Trajectory As The Next Increment

After timeline replay is stable, add a single-process trajectory view.

The single-process trajectory view should show:

- first seen and last seen
- CPU trend
- RSS trend
- VRAM trend
- per-process GPU utilization trend when available
- suspicious-state changes when relevant

Entry path:

- open from a process row in the live table or replay table

This phase is intentionally deferred until the identity model and history storage layer are proven by replay.

### 10. Add Process-History Settings Separate From Generic Metrics Settings

Current generic settings such as rawRetentionDays should not silently govern the new process-history model if the product intends different cost envelopes.

Add dedicated process-history settings.

Chosen initial settings and defaults:

- processRawRetentionHours
- processSummaryRetentionDays
- processSummaryTopN
- processSummaryBucketShortMs
- processSummaryBucketLongMs

Chosen defaults:

- processRawRetentionHours = 72
- processSummaryRetentionDays = 90
- processSummaryTopN = 20
- processSummaryBucketShortMs = 60_000
- processSummaryBucketLongMs = 900_000

These settings should exist explicitly so operators understand the storage policy.

Rationale:

- process history has a different volume profile from node metrics
- explicit settings avoid hidden coupling and make future tuning safer

## Data Model

Recommended new storage concepts:

- process_snapshots or equivalent raw-process table keyed by serverId and timestamp
- process_snapshot_rows or equivalent row table keyed by snapshot identity and process identity
- process_summary_buckets for Top-N preserved rows and bucket totals

Recommended logical response shapes:

```ts
interface NodeStatusSummary {
  online: {
    online: number;
    connecting: number;
    error: number;
    offline: number;
  };
  internet: {
    reachable: number;
    unreachable: number;
    unprobed: number;
  };
}

interface ProcessHistoryFrame {
  serverId: string;
  timestamp: number;
  processes: ProcessHistoryRow[];
}

interface ProcessHistoryRow {
  processKey: string;
  pid: number;
  createTime?: number;
  user: string;
  resolvedPersonId?: string;
  resolvedPersonName?: string;
  command: string;
  cpuPercent: number;
  memPercent: number;
  rss: number;
  gpuMemoryMB: number;
  gpuUtilPercent?: number;
  suspiciousReasons: string[];
}

interface ProcessReplayIndexPoint {
  timestamp: number;
  processCount: number;
  gpuProcessCount: number;
  suspiciousProcessCount: number;
}

interface ProcessSummaryBucket {
  serverId: string;
  bucketStart: number;
  bucketSize: number;
  totals: {
    processCount: number;
    gpuProcessCount: number;
    suspiciousProcessCount: number;
    totalCpuPercent: number;
    totalRss: number;
    totalGpuMemoryMB: number;
  };
  topProcesses: ProcessHistoryRow[];
}
```

The exact physical schema can differ, but the logical model must support:

- frame-by-frame replay within the raw window
- bucketed long-term summaries
- later stitched trajectory queries by processKey

## API Design

Chosen API additions:

- a combined node-status summary source for overview totals
- a process replay index route for frame discovery
- a process frame route for loading one replay timestamp
- a process summary route for longer-range summarized history
- a process trajectory route for the later second phase

Per-node current badges do not require a new dedicated route. Existing live status plus latest metrics sources remain authoritative for current online and internet states after the UI maps them into the unified badge model.

Recommended route family:

- /api/overview/node-status-summary
- /api/servers/:id/process-history/index
- /api/servers/:id/process-history/frame
- /api/servers/:id/process-history/summary
- /api/servers/:id/process-history/process/:processKey

Design rules:

- replay index and frame routes are optimized for the 72-hour raw window
- summary routes serve longer ranges and may return bucketed Top-N data instead of full frames
- the later single-process route is optional in the first release, but the model should not block it

## UI Behavior

### Node Cards

- keep the existing source badge
- show online badge on the left and internet badge on the right
- internet badge uses reachable, unreachable, or unprobed
- stale metrics continue to dim the body metrics, but the status badges remain explicit

### Overview Summary

- replace separate presence and internet cards with one combined status card
- the left half visually groups node connection states
- the right half visually groups internet probe states
- wording and color semantics should match node cards

### Node Detail Header

- show the same online-left and internet-right status pair used on the node card
- keep last-seen information separate from the badges

### Process Panel

- add a compact control bar above the table
- control bar contains sort selector, sort direction, and simple filter toggles
- replay mode reuses the same table component to avoid divergent live and historical presentations
- rows with no gpuUtilPercent display N/A rather than 0

### Replay Experience

- default entry stays on the live table
- operators can switch into replay mode from the process tab
- replay mode shows the selected timestamp clearly and allows stepping without leaving the process tab

## Retention And Storage Strategy

Chosen policy:

- short-term accuracy is prioritized for 72 hours
- long-term visibility is preserved through summaries rather than raw replay

Operational implications:

- recent incidents can be replayed frame by frame
- older periods remain inspectable through bucket summaries and later stitched process trajectories
- storage growth is bounded by Top-N preservation rather than total-process cardinality over time

Cleanup policy:

- raw process snapshots expire independently of generic metrics raw retention
- process summaries expire independently of node metric aggregates
- summary generation must run before raw snapshot cleanup so the long-term view is not punctured

## Error Handling

- if internet probe data is missing, show unprobed rather than unreachable
- if a node is offline and the last known internet state is stale, the UI may still show the last reported internet badge but must not imply freshness beyond the last-seen timestamp
- if replay index loading fails, the process tab falls back to the live table with a recoverable error state
- if a selected replay frame is missing, the UI keeps the replay position but shows that the frame is unavailable
- if per-process GPU utilization cannot be collected on a node, the UI must not invent zeros or suppress the sort option entirely

## Testing

### Core And Storage Tests

- stores and retrieves raw process frames for a server across timestamps
- expires raw process history after the configured retention window
- generates Top-N summary buckets before raw cleanup
- preserves per-bucket totals even when some rows are dropped from Top-N storage
- uses stable process identity across snapshots when createTime is present

### API Tests

- overview status summary counts online and internet states correctly, including unprobed
- process replay index returns frame metadata for the raw window
- process frame route returns one timestamped process list
- process summary route returns bucket totals plus Top-N rows
- nodes without per-process GPU utilization return rows without gpuUtilPercent rather than invalid values

### UI Tests

- node cards render dual status badges in the correct order
- overview summary renders one combined left-right status card
- node detail header renders the same paired status treatment
- process table sorts by CPU, memory, RSS, VRAM, and GPU utilization
- process table filters only GPU, suspicious, and bound-person rows correctly
- replay mode updates the table when the selected frame changes
- rows with missing gpuUtilPercent render N/A

## Rollout Plan

Recommended implementation sequence:

1. unify node card, overview summary, and node detail header on dual status presentation
2. add process-table sorting and simple filters for live data
3. extend collection and types for optional per-process GPU utilization
4. introduce raw process-history storage and replay index plus frame APIs
5. add replay mode in the process tab
6. add long-term summary buckets and retention maintenance
7. add single-process trajectory in a follow-up increment

This sequence delivers visible operator value early while keeping the storage and API work staged behind a stable UI direction.