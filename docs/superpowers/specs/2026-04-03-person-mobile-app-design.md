# Person Mobile App Design

Date: 2026-04-03

## Summary

This design adds a mobile-first frontend mode for PMEOW centered on the person concept.

The mobile experience serves two different audiences through one shared frontend codebase:

- administrators using a phone-sized version of the existing operator console for high-frequency workflows
- people using a reduced personal view that only exposes information and actions related to their own attributed tasks, bound nodes, and notifications

The mobile mode is implemented as a dedicated mobile-first entry inside the existing frontend rather than as a separate frontend repository.

The personal mobile view depends on the person attribution model defined in [2026-04-03-person-attribution-stats-design.md](./2026-04-03-person-attribution-stats-design.md). That specification remains the source of truth for person identity, bindings, task ownership resolution, and person-facing data semantics. This document only defines the mobile-facing product, API, and interaction layer built on top of that foundation.

## Goals

- Provide a simple mobile-first operator experience for high-frequency administrator workflows
- Provide a person-facing mobile view for self-service visibility into attributed tasks, bound nodes, and notifications
- Keep administrator mobile access inside the current Web auth model
- Avoid introducing a full person login and account system in v1
- Reuse the current frontend and Web server architecture instead of creating a separate mobile frontend stack
- Support task-state notifications, node online or offline notifications, and configurable GPU availability notifications in the mobile app experience
- Preserve strict server-side filtering so personal tokens can only access data attributed to the current person

## Non-Goals

- Building a separate native iOS or Android client in v1
- Replacing the existing desktop console
- Making the personal mobile view a full operator console clone
- Introducing a full user account, password, or self-service identity system for people
- Exposing full cluster-wide node visibility to personal users
- Reworking person attribution rules defined in the person attribution design

## Current State

- PMEOW currently provides a desktop-oriented React frontend in `packages/ui`
- The Web server already acts as the central operator-facing observation and control plane
- The current frontend exposes task, node, alert, and GPU views for administrators
- The current person design exists as a separate specification and defines the attribution layer required for person-facing views
- There is no dedicated mobile-first frontend mode today
- There is no personal token-based mobile entry today
- There is no dedicated mobile notification model today

## Design Decisions

### 1. One Frontend Codebase With A Dedicated Mobile-First Entry

The mobile app mode is implemented inside the existing `packages/ui` frontend.

Chosen rules:

- keep one frontend codebase
- add a dedicated mobile-first route shell
- keep the current desktop console intact
- do not create a separate frontend package or repository for v1

Rationale:

- the project already has a working frontend, transport layer, and operator data flow
- the requested scope is a simple mobile frontend, not a fully independent product
- person mobile and administrator mobile should reuse the same domain models and API surface

### 2. Two Mobile Experiences Inside The Same Product

The mobile entry contains two distinct experience layers.

#### Administrator Mobile Mode

Administrator mobile mode is a reduced mobile version of the existing operator console.

Chosen rules:

- continue to use the existing administrator auth flow
- prioritize high-frequency pages only
- leave heavyweight management flows on desktop

V1 administrator mobile pages:

- home summary
- task list
- node list and node detail summary
- notification list

This is intentionally not full desktop parity.

#### Personal Mobile Mode

Personal mobile mode is a reduced self-service view for one person.

Chosen rules:

- only show information attributed to the current person
- expose only minimal task operations
- do not expose operator-wide management features
- do not expose unrelated people, tasks, or nodes

V1 personal mobile pages:

- home
- my tasks
- my nodes
- notifications
- settings as a secondary page rather than a primary tab

### 3. Personal Access Uses Person Tokens Rather Than Person Accounts

The personal mobile view does not introduce a separate account system.

Chosen rules:

- each person can be assigned a long-lived mobile access token
- the token is generated, rotated, or revoked by administrators
- the token is used only for personal mobile APIs
- the token does not grant access to administrator routes

Implications:

- no password reset or person-auth session system is required in v1
- the personal mobile experience can be bootstrapped by pasting, scanning, or importing a token into the app shell
- all authorization is enforced on the server side based on the resolved person behind the token

### 4. Mobile Notification Delivery Uses Person Preferences Plus App-Level Device Registration

The mobile app mode must support system-level notifications.

Chosen rules:

- notification preferences are stored at the person level in v1
- system notification delivery is handled by the mobile app shell
- device registration exists as an implementation detail of the app shell, not as a first-class management UI in v1

This reconciles two requirements:

- users want system status-bar notifications
- users do not want device management to become part of the v1 product surface

Trade-off:

- multiple devices for the same person will share the same event preferences in v1
- per-device notification settings are deferred

### 5. Notification Event Model

The mobile experience requires an explicit person-facing event model.

V1 personal notification events:

- own task started running
- own task completed successfully
- own task failed
- own task cancelled
- bound node went offline
- bound node recovered online
- GPU availability event when explicitly enabled

Rules:

- task events are enabled by default
- node online or offline events are enabled by default
- GPU availability notifications are disabled by default
- users can configure which personal events should notify them

### 6. GPU Availability Notification Semantics

GPU availability notifications are opt-in and threshold-based.

Chosen rules:

- no GPU availability notification is emitted by default
- once enabled, the trigger rule is: there exist at least `X` GPUs and each of those GPUs has at least `Y` GB of available VRAM
- the default `Y` value is based on 80 percent of single-GPU VRAM on the target node class
- nodes may be treated as homogeneous per machine for v1 threshold calculation

This avoids noisy alerts while keeping the rule understandable for end users.

### 7. Personal Data Visibility Is Strictly Scoped

The personal mobile view must not expose cluster-wide data.

Chosen rules:

- the personal task list contains only tasks attributed to the current person
- the personal node list contains only nodes currently bound to usernames mapped to the current person
- cluster-wide summaries are not shown to personal users
- operator-only controls remain hidden from the personal mobile interface

This is a product rule as well as a security rule.

## Information Architecture

### Administrator Mobile Mode

Administrator mobile mode focuses on quick inspection and intervention.

#### Home

Displays:

- cluster summary cards
- active task counts
- problematic node highlights
- unread notification count

#### Tasks

Displays:

- current task queue state
- task status summaries
- common task actions appropriate for mobile

#### Nodes

Displays:

- node list with online state
- condensed node resource summaries
- link into node detail summary

#### Notifications

Displays:

- recent task, node, and alert events relevant to operator triage

### Personal Mobile Mode

Personal mobile mode focuses on visibility, notifications, and minimal self-service actions.

#### Home

Displays:

- running task summary
- queued task summary
- unread notifications
- bound node overview
- GPU availability summary when configured

#### My Tasks

Displays:

- own queued tasks
- own running tasks
- own recent finished tasks

Supported v1 actions:

- cancel own queued tasks
- cancel own running tasks when the backend already supports that control path
- open failure context for failed tasks

#### My Nodes

Displays:

- nodes bound to the current person through active bindings
- online or offline state
- condensed GPU availability summary
- recent activity timestamp

#### Notifications

Displays:

- task lifecycle notifications
- node online or offline notifications
- configured GPU availability notifications

Supported v1 actions:

- mark notification as read
- mute selected notification categories

#### Settings

Displays:

- notification toggles
- GPU availability threshold settings
- notification permission state

Settings is intentionally secondary and not a primary bottom-tab destination.

## API Shape

The mobile design adds mobile-focused API families rather than forcing the desktop API surface to carry all mobile concerns directly.

Recommended route families:

- `GET /api/mobile/admin/summary`
- `GET /api/mobile/admin/tasks`
- `GET /api/mobile/admin/servers`
- `GET /api/mobile/admin/notifications`
- `GET /api/mobile/me/bootstrap`
- `GET /api/mobile/me/tasks`
- `POST /api/mobile/me/tasks/:taskId/cancel`
- `GET /api/mobile/me/servers`
- `GET /api/mobile/me/notifications`
- `POST /api/mobile/me/notifications/:id/read`
- `GET /api/mobile/me/preferences`
- `PUT /api/mobile/me/preferences`

API rules:

- administrator mobile routes continue to require administrator authentication
- personal mobile routes require a valid person mobile token
- personal mobile responses are already filtered on the server side by resolved person identity
- personal task actions must re-check ownership server-side before executing control actions

## Frontend Structure

The mobile implementation should live inside `packages/ui` with dedicated route and component boundaries.

Recommended structure:

- `packages/ui/src/mobile/layouts`
- `packages/ui/src/mobile/screens/admin`
- `packages/ui/src/mobile/screens/person`
- `packages/ui/src/mobile/components`
- `packages/ui/src/mobile/state`

Boundary rules:

- desktop pages remain the source of truth for desktop workflows
- mobile screens are not just CSS wrappers around desktop pages
- cards, badges, list items, and charts may be shared where practical
- shell navigation, tab structure, and empty states should be mobile-specific

## Mobile App Shell Expectations

The product should be compatible with a Web-shell mobile packaging layer.

The app shell is responsible for:

- persisting the personal token or administrator session bootstrap data
- registering the device notification channel
- relaying system notification permission state to the frontend
- opening the correct mobile route after a notification tap

The app shell is not responsible for:

- re-implementing person attribution logic
- duplicating backend state handling
- replacing the Web server as the source of truth

## Error Handling And Empty States

- revoked or expired personal token shows a dedicated access-invalid screen with operator contact guidance
- no tasks, nodes, or notifications for a person should render empty states rather than generic errors
- missing notification permission should not block app usage and should instead surface a clear reminder in settings
- GPU notifications remain silent until explicitly enabled and configured
- personal route access to unrelated data must fail closed

## Testing Strategy

Unit and integration coverage should include at least the following groups.

### Mobile Authorization Tests

- administrator mobile routes reject personal tokens
- personal mobile routes reject administrator tokens when route type is incompatible
- personal task actions reject tasks not attributed to the current person

### Mobile Data Scoping Tests

- personal task lists only return attributed tasks
- personal node lists only return bound nodes for the current person
- notification feeds only return events scoped to the current person

### Notification Tests

- default notification preferences match the chosen v1 defaults
- GPU availability notifications are disabled by default
- updating preferences changes event delivery behavior
- notification read and mute actions behave correctly

### UI Tests

- administrator mobile home renders correctly on narrow screens
- personal mobile home renders correctly with and without tasks
- token-invalid flow renders the dedicated blocked state
- notification permission-missing state renders correctly
- mobile navigation works correctly across administrator and personal flows

## Rollout Plan

### Phase 1: Mobile Foundation

- add mobile route shell inside `packages/ui`
- add administrator mobile summary, tasks, nodes, and notifications pages
- add personal token auth bootstrap
- add personal home, tasks, nodes, notifications, and settings screens

### Phase 2: Notification Delivery

- add person-level notification preferences
- add mobile notification feed APIs
- integrate mobile app shell system-notification delivery

### Phase 3: Refinement

- improve task actions and task detail depth
- improve node detail summaries for mobile
- evaluate whether person-level preferences need later device-level expansion

## Relationship To Existing Person Specification

This mobile design depends on the following existing specification:

- [2026-04-03-person-attribution-stats-design.md](./2026-04-03-person-attribution-stats-design.md)

Dependency rules:

- person identity and binding semantics remain defined by the attribution spec
- personal mobile task visibility must use the shared attribution order from the attribution spec
- personal node visibility uses active bindings and person resolution from the attribution spec
- future webhook enrichment in the attribution spec remains orthogonal to the mobile product surface

## User Experience Summary

The intended v1 experience is:

- administrators can use a phone-friendly view for the highest-frequency monitoring and intervention workflows
- people can use a limited mobile view to see only their own tasks, nodes, and notifications
- the same frontend codebase powers desktop and mobile experiences without forcing one information architecture onto both
- system-level mobile notifications exist for important personal events without introducing a full account system
- the mobile layer stays aligned with the person attribution foundation rather than inventing separate ownership logic

## Self-Review

### Placeholder Scan

- No TODO or TBD markers remain
- The notification and token model are explicit

### Internal Consistency

- One codebase and two mobile audiences remain consistent across architecture, API, and UI sections
- Personal data scoping remains server-side throughout the design
- Mobile notification behavior matches the chosen token and preference model

### Scope Check

- The design stays focused on mobile product shape, permissions, and UI/API boundaries
- Native standalone mobile clients and full person account systems remain out of scope

### Ambiguity Check

- The personal token model is explicitly administrator-managed
- GPU availability notification defaults and semantics are explicit
- Personal node visibility is explicitly limited to nodes bound to the current person