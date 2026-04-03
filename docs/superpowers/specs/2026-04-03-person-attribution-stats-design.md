# Person Attribution And Stats Design

Date: 2026-04-03

## Summary

This design adds an optional person-attribution layer to PMEOW for operator-facing statistics, task ownership enhancement, and webhook template enrichment.

The system must continue to operate normally when no person data is configured. Server monitoring, Agent metrics ingestion, task mirroring, alerting, and existing hooks remain valid without any person records.

Person attribution is introduced as an enhancement layer over existing raw facts:

- servers and Agent nodes remain the runtime subjects
- system usernames remain valid raw identifiers
- tasks and GPU usage continue to be persisted as they are today
- person attribution is resolved on top of those facts for statistics, dashboards, and webhook context

The design favors stable attribution semantics over aggressive retroactive rewriting. Binding changes affect future attribution only. Historical person statistics are built from attribution facts recorded after this feature is introduced.

## Goals

- Introduce a person entity that can represent an individual without making it a login prerequisite
- Bind server-local system usernames to a person using the key server plus username
- Allow tasks to resolve to a person through explicit override first and username binding second
- Provide person-level GPU and VRAM statistics focused on current usage, timeline, active nodes, and task load
- Support fixed core profile fields plus custom fields for future webhook expansion
- Keep an explicit unassigned state for data that cannot be mapped to a person
- Preserve the current system behavior when no person data is present
- Add a phased path for person management, dashboards, and webhook template enrichment

## Non-Goals

- Adding end-user login, self-service access, or person-scoped permissions in v1
- Making person configuration mandatory for Agent or server operation
- Retrofitting all historical metrics and task history into person attribution before rollout
- Replacing current server-centric and username-centric operator views
- Turning PMEOW into a full event-sourced billing or quota platform in v1

## Current State

- The current server remains the observation and intervention point for Agent nodes
- Agent metrics and task updates are normalized to a bound serverId at Web ingress
- GPU allocation data already distinguishes PMEOW tasks, user processes, and unknown processes
- Cross-node task state is mirrored on the server side
- Operator APIs already expose server-level task, GPU, and security views
- Existing GPU summary routes aggregate by raw username rather than by a first-class person entity
- Existing hooks and webhook actions consume template variables derived from server and metrics context only

## Design Decisions

### 1. Person Is An Optional Enhancement Layer

The person concept is introduced as an operator-side metadata and attribution layer, not as a runtime dependency.

Implications:

- no person record is required for a server to connect
- no person record is required for an Agent to report metrics or tasks
- no person record is required for existing hooks or alerts to execute
- unresolved data is kept and exposed as unassigned rather than rejected

This keeps the system robust in partially configured environments and aligns with the requirement that PMEOW must still run correctly even when the person concept is unused.

### 2. Data Model

The design introduces four person-related objects.

#### Person

Person is a profile entity, not an auth account.

Recommended fields:

- id
- displayName
- email
- qq
- note
- customFields
- status
- createdAt
- updatedAt

Field rules:

- displayName is the primary human-readable name
- email, qq, and note are optional core fields
- customFields is a string-to-string map in v1
- status supports at least active and archived

The v1 custom field model is intentionally simple. Values are stored as strings so they can be surfaced in filters and webhook templates without introducing a full schema engine.

#### PersonBinding

PersonBinding maps a server-local system username to a person.

Binding key:

- serverId
- systemUser

Recommended fields:

- id
- personId
- serverId
- systemUser
- source
- enabled
- effectiveFrom
- effectiveTo
- createdAt
- updatedAt

Rules:

- one active binding at a time for the same serverId plus systemUser pair
- binding changes are represented by closing the old row and opening a new row
- source distinguishes manual creation from system-suggested bindings

This time-window model is required because historical attribution must remain attached to the person that was effective when the raw fact was observed.

#### TaskOwnerOverride

TaskOwnerOverride supports explicit task-to-person attribution.

Purpose:

- explicit person assignment takes precedence over username mapping
- the system can distinguish manual ownership assignment from inferred ownership
- future Agent-side explicit person assignment can be represented without overloading raw task fields

Recommended fields:

- id
- taskId
- serverId
- personId
- source
- effectiveFrom
- effectiveTo
- createdAt
- updatedAt

V1 can treat this as a current override layer while still recording enough metadata to explain why a task resolved to a given person.

#### PersonAttributionFact

PersonAttributionFact is a lightweight derived attribution ledger used for person statistics and history.

It is not a full replacement for raw metrics, raw task mirrors, or current persistence tables.

Recommended fields:

- id
- timestamp
- sourceType
- serverId
- personId
- rawUser
- taskId
- gpuIndex
- vramMB
- taskStatus
- resolutionSource
- metadataJson

Purpose:

- preserve historical person attribution even if bindings change later
- support person timelines and cumulative metrics without expensive back-scans over all raw tables
- allow unassigned rows by storing null personId while preserving rawUser and source metadata

Resolution states must remain distinguishable:

- resolved to person
- unassigned with known raw username
- unknown with no reliable raw owner

### 3. Attribution Rules

All person-facing views must use one shared attribution order so statistics, task details, and webhook context do not disagree.

#### Task Attribution Order

Task ownership resolves in this order:

1. active TaskOwnerOverride
2. active PersonBinding matched by serverId plus task user
3. unassigned

Each resolved task should carry attribution metadata in operator-facing responses:

- resolvedPersonId
- resolvedPersonSummary
- resolutionSource

#### GPU Attribution Order

GPU usage resolves by source category.

For PMEOW task GPU rows:

- resolve through the task attribution result

For ordinary user process rows:

- resolve through PersonBinding using serverId plus process username

For unknown processes:

- preserve as unknown and do not guess a person

This allows person statistics to cover both scheduled PMEOW tasks and non-task user processes while keeping provenance explicit.

### 4. Historical Semantics

Historical attribution must not be retroactively rewritten when an operator changes a binding.

Chosen rule:

- binding changes affect future data only
- existing person attribution history remains attached to the previously effective person

Implications:

- PersonBinding requires effectiveFrom and effectiveTo semantics
- PersonAttributionFact is persisted from the point the feature goes live
- historical person statistics are stable and explainable

### 5. Statistics Model

The primary subject of the new dashboards is the person rather than the raw username.

#### Current Summary Metrics

The person overview should provide at least:

- current VRAM usage
- current running task count
- current queued task count
- active server count
- latest activity timestamp
- unassigned usage proportion at aggregate level

#### Historical Views

The person detail view should provide at least:

- VRAM timeline
- per-server VRAM distribution
- recent task summary or task list
- period aggregates for 24h, 7d, and 30d windows

#### Cumulative Metrics

Chosen metric rules:

- primary cumulative metric: VRAM occupancy duration
- secondary cumulative metric: task runtime duration
- additional supporting metric: VRAM capacity-time accumulation in GB*h

Rationale:

- pure runtime is too task-centric for a GPU resource dashboard
- occupancy duration captures how long a person held GPU memory
- GB*h differentiates small and large memory footprints over the same duration

### 6. Person Profile And Binding Management

V1 management style is operator-managed rather than self-service.

Chosen rules:

- bindings are maintained manually by administrators
- the system should provide suggested bindings based on observed unassigned usernames
- person profile custom fields are stored as strings

Suggested binding feeds should be built from observed raw usernames that have activity but no active person mapping.

### 7. API Shape

The design keeps existing APIs compatible and adds parallel person-facing APIs.

Recommended new route families:

- GET /api/persons
- POST /api/persons
- GET /api/persons/:id
- PUT /api/persons/:id
- GET /api/persons/:id/bindings
- POST /api/person-bindings
- PUT /api/person-bindings/:id
- GET /api/person-binding-suggestions
- GET /api/persons/summary
- GET /api/persons/:id/timeline
- GET /api/persons/:id/tasks

Compatibility rules:

- current server, task, and GPU routes remain available
- existing raw-username GPU routes remain available for debugging and transition
- existing task and GPU payloads may be enriched with resolvedPerson and resolutionSource fields without breaking current consumers

### 8. Webhook And Template Context

The v1 webhook model does not change trigger evaluation or routing architecture.

Chosen rule:

- webhook enhancement is template-context only

When a hook-triggering event resolves to a person, the context may include:

- personId
- personName
- personEmail
- personQQ
- personNote
- personCustomFields

Raw source context remains available alongside person fields:

- serverName
- serverHost
- rawUser when present
- taskId when present
- existing metrics-derived variables

Unassigned behavior in v1:

- person fields resolve to empty strings when no person is matched

This was chosen over explicit unassigned flags in the template context to keep webhook payload construction simple in v1.

### 9. UI Surface

The UI should not overload the existing server detail page with the full person management workflow.

Recommended operator surfaces:

#### Person Management Page

- person profile CRUD
- binding management
- binding suggestion review
- visibility into active versus archived people

#### Person Overview Page

- global person summary cards and ranking
- current VRAM usage
- running and queued task counts
- active servers
- aggregate unassigned resource hints

#### Person Detail Page

- person profile fields
- custom fields
- timeline charts
- per-server breakdown
- task summaries

#### Server Detail Enhancements

- light person-related overlays only
- show which people currently map to activity on that node
- highlight activity that remains unassigned

### 10. Phased Delivery

The approved rollout path is a single design with phased implementation.

#### Phase 1: Attribution Foundation

- Person
- PersonBinding
- TaskOwnerOverride
- attribution resolution
- PersonAttributionFact persistence
- unassigned suggestion feed

#### Phase 2: Person Statistics And Dashboards

- person overview API and page
- person detail API and page
- historical charts and aggregates

#### Phase 3: Webhook Template Enrichment

- person fields added to template context
- documentation for person-aware webhook payloads

## Error Handling And Lifecycle Rules

- overlapping active bindings for the same serverId plus systemUser are rejected
- missing person references in bindings or task overrides are rejected
- archiving is preferred over hard deletion for people with historical attribution
- unresolved attribution never blocks ingestion or runtime control flows
- zero-person deployments remain fully supported

## Backfill Strategy

Chosen rollout behavior:

- no retroactive backfill of old raw history into person attribution

Implications:

- existing historical data remains available through current server and username views
- person views begin accumulating history from feature rollout onward
- implementation is simpler and avoids rewriting older semantics based on current bindings

## Testing Strategy

Unit and integration coverage should include at least the following groups.

### Model And Persistence Tests

- person profile CRUD
- binding overlap rejection
- binding time-window behavior
- task override precedence
- archived person behavior

### Attribution Tests

- task attribution through override
- task attribution through binding fallback
- GPU task attribution through resolved task owner
- user process attribution through binding
- unknown process preservation
- unassigned row handling

### API Tests

- person management endpoints
- binding endpoints
- suggestion endpoints
- person summary endpoint
- person timeline endpoint
- person task listing endpoint
- compatibility of existing endpoints with optional resolved person enrichment

### Webhook Tests

- resolved person fields appear correctly in templates
- unresolved person fields produce empty strings
- raw source fields remain available alongside person fields

### UI Tests

- empty person state
- unassigned-state rendering
- person overview rendering
- person detail rendering
- server detail enhancement without regression to current flows

### Compatibility Tests

- zero-person configuration leaves current monitoring and control flows unchanged
- Agent metrics ingestion continues to work without person configuration
- existing hook execution remains valid when person attribution is absent

## User Experience Summary

The intended operator experience is:

- raw monitoring still works out of the box
- operators may optionally create person profiles and bindings
- once bindings exist, GPU and task activity starts appearing under people rather than only raw usernames
- unassigned activity remains visible so operators can continuously improve attribution coverage
- webhook payloads can gradually become person-aware without requiring a new notification engine

## Self-Review

### Placeholder Scan

- No TODO or TBD markers remain
- The phased rollout is explicit and finite

### Internal Consistency

- Person remains optional across summary, API, UI, and webhook sections
- Historical semantics align with effective time windows and no-backfill rollout
- Task attribution precedence is consistent across task, GPU, and webhook usage

### Scope Check

- The design is focused on person attribution, statistics, and webhook context enrichment
- Billing, quotas, and end-user login are explicitly deferred

### Ambiguity Check

- Binding key is explicitly serverId plus systemUser
- Unassigned webhook fields are explicitly empty strings in v1
- Historical data behavior is explicitly future-only with no retroactive backfill