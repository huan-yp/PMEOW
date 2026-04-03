# PMEOW Documentation Refresh Design

Date: 2026-04-03
Status: Approved for planning

## Context

PMEOW already has a reasonable documentation split between the top-level README, user documentation, developer documentation, and design archives. The problem is not a lack of structure. The problem is that recent product and UI changes have outpaced the documents that describe them.

Recent repository history indicates that the product surface has continued to evolve in areas such as people management, guided creation flows, mobile connection flows, node overview refreshes, rate charts, and agent status behavior. The current documentation stack does not consistently surface those changes in the right entry points.

Examples of currently important entry documents:

- `README.md`
- `docs/README.md`
- `docs/user/README.md`
- `docs/user/web-console.md`
- `docs/user/mobile-app.md`
- `docs/developer/README.md`
- `docs/developer/local-development.md`

## Goals

- Rebuild documentation around reader journeys rather than around whichever file happened to exist first.
- Keep formal documentation strictly aligned with the current behavior on `main`.
- Fix the highest-value gaps first: missing or outdated feature explanations that affect onboarding and daily use.
- Preserve the existing top-level split between user docs, developer docs, and design archives.
- Reduce future drift by making document ownership and update triggers explicit.

## Non-Goals

- Do not document unshipped or speculative roadmap items in formal docs.
- Do not collapse user and developer documentation into a single mixed manual.
- Do not perform a large-scale docs rewrite that discards the current directory layout entirely.

## Recommended Approach

Use a reader-journey-first information architecture.

This keeps the current high-level split intact while reorganizing content so a reader can start from a goal instead of needing to understand the repo layout first.

Alternative approaches that were considered but rejected:

1. Feature-domain-first reorganization.
   This would group everything by areas such as people, mobile, tasks, security, and agent. It is easier for maintainers who think in features, but it mixes audiences too aggressively and makes onboarding harder.
2. Minimal patching only.
   This would preserve the current structure and only update stale paragraphs. It has the lowest short-term cost, but it leaves the current navigation and ownership problems in place and is likely to drift again quickly.

## Information Architecture

### Top-Level README

`README.md` should become a concise landing page with four responsibilities only:

1. Project positioning.
2. Current, shipped capability summary.
3. Shortest viable startup path.
4. Clear navigation into `docs/`.

The README should stop acting as a full operator or developer manual. Detailed API lists, deep page behavior, and development workflows belong below `docs/`.

### Documentation Hub

`docs/README.md` should become the task-oriented hub for the whole documentation set.

It should route readers by intent:

- I want to try the project quickly.
- I want to deploy the web server.
- I want to connect an agent node.
- I want to operate the system day to day.
- I want to use or distribute the mobile experience.
- I want to develop or modify the codebase.

### User Documentation

`docs/user/README.md` should remain the operator-facing entry point, but its role should be clarified.

The user docs should separate two concerns that are currently too easy to mix together:

- Page navigation and control-surface orientation.
- End-to-end operational workflows.

Planned structure:

- Keep `getting-started.md` as the first-run path.
- Keep `web-server.md` for deployment and persistence.
- Keep `agent-nodes.md` for agent installation and node onboarding.
- Keep `web-console.md`, but narrow it to control-surface orientation and page-level mental models.
- Add `docs/user/people-and-access.md` as the dedicated user-facing page for people and access management, covering person records, guided creation, binding workflows, mobile token lifecycle, and the boundary between desktop admin flows and personal mobile access.
- Keep `mobile-app.md` for mobile entry points, connection flows, and operator versus person authentication paths.
- Keep `troubleshooting.md` for failure modes and operational recovery.

### Developer Documentation

`docs/developer/README.md` should stay focused on the current implementation rather than historical context.

Its sections remain valid:

- `architecture.md`
- `local-development.md`
- `protocol-and-api.md`
- `testing-and-debugging.md`

The change is not structural so much as contractual: these documents should explicitly describe only current behavior on `main`, and point historical rationale or future work back to `docs/superpowers/`.

### Design Archives

`docs/superpowers/` remains separate from formal docs.

Formal docs answer:

- What exists now?
- How do I use it?
- How do I work on it?

Design archives answer:

- Why was this direction chosen?
- What was planned in stages?
- What future work is being considered?

If formal docs and planning archives ever disagree, the formal docs must be updated to match shipped code, and the archives remain historical artifacts rather than operator instructions.

## Content Work Phases

### Phase 1: Entry and Orientation

Update:

- `README.md`
- `docs/README.md`
- `docs/user/getting-started.md`

Objectives:

- Make the current product surface obvious to first-time readers.
- Route readers into the correct path without forcing them to infer repo structure.
- Reflect key current capabilities that are already present on `main`.

This phase should explicitly clarify high-value realities such as:

- PMEOW includes a web admin surface, a Python agent, and mobile-oriented entry points.
- Scheduling authority stays on agent nodes.
- The web server is primarily the observer and control surface.

### Phase 2: Operator Workflows

Update:

- `docs/user/web-console.md`
- `docs/user/mobile-app.md`
- `docs/user/agent-nodes.md`
- `docs/user/troubleshooting.md`
- `docs/user/people-and-access.md`

Objectives:

- Separate "where to click" from "how to complete the task".
- Document the current people-management and access-management flow end to end.
- Make mobile connection and token lifecycle understandable without requiring code reading.

This phase should cover shipped behavior around:

- People overview and person management flows.
- Guided creation and binding workflows.
- Mobile connection for both person and admin entry paths.
- Operational boundaries for tasks, security, settings, and agent-backed views.

### Phase 3: Developer Alignment

Update:

- `docs/developer/local-development.md`
- `docs/developer/architecture.md`
- `docs/developer/protocol-and-api.md`
- `docs/developer/testing-and-debugging.md`

Objectives:

- Align commands and scripts with the current repo.
- Align architecture wording with current agent-versus-web responsibilities.
- Align protocol docs with currently shipped routes and lifecycle semantics.
- Make the testing and debugging docs reliable for current contributors.

This phase should verify details against the actual repository entry points such as the root package scripts, current UI surfaces, web routes, and existing tests.

## Document Ownership Model

Each capability area should have one primary, authoritative document. Other documents may link to it, but should not duplicate detailed behavior.

Initial ownership mapping:

- Project entry and scope: `README.md`
- Documentation navigation: `docs/README.md`
- First-run validation: `docs/user/getting-started.md`
- Server deployment: `docs/user/web-server.md`
- Agent onboarding: `docs/user/agent-nodes.md`
- Console navigation: `docs/user/web-console.md`
- People and access workflows: `docs/user/people-and-access.md`
- Mobile usage and connection: `docs/user/mobile-app.md`
- Operator failure handling: `docs/user/troubleshooting.md`
- Architecture and responsibilities: `docs/developer/architecture.md`
- Local developer setup: `docs/developer/local-development.md`
- Protocol and API semantics: `docs/developer/protocol-and-api.md`
- Test and debug workflows: `docs/developer/testing-and-debugging.md`

## Update Triggers

Future changes must check documentation whenever any of the following change:

- Startup, build, or test commands.
- Navigation structure or user-visible workflow steps.
- API routes, transport semantics, or authentication boundaries.
- Role boundaries between admin, person, web server, and agent.

These triggers should be restated in the developer-facing documentation so contributors do not treat documentation as optional cleanup.

## Verification Strategy

Documentation refresh work should verify against three sources of truth:

1. Repository commands and scripts.
2. Current shipped UI and route behavior.
3. Tests that encode important workflows.

Acceptance criteria for the refresh:

- A first-time reader can identify where to start within minutes.
- An operator can find the correct document for deployment, people management, mobile access, and daily monitoring workflows.
- A contributor can follow the development docs to run the local environment and understand the current architecture boundary.
- Formal docs do not describe planned-but-unshipped behavior as if it already exists.

## Risk Management

The main risk is continuing to append new paragraphs without tightening boundaries. That would preserve the current drift pattern.

To reduce that risk:

- Prefer deleting or moving stale detail over layering more explanation on top of it.
- Keep page-overview content separate from task workflow content.
- Keep formal documentation separate from planning archives.
- Prefer one canonical explanation per capability area.

## Implementation Notes for the Follow-Up Plan

The follow-up implementation plan should break work into independent documentation changesets that can be reviewed in order:

1. Entry-point refresh.
2. User workflow restructuring.
3. Developer doc alignment.
4. Cross-link cleanup and stale-content removal.

The implementation plan should also include a lightweight review checklist so each documentation PR confirms command accuracy, navigation accuracy, and scope accuracy.