# Responsive UI Design

## Summary

Add a full-repository responsive UI layer for both [`apps/web`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web) and [`apps/mobile`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile) without changing the existing product semantics, page responsibilities, or core layout intent of either client.

The web console should remain a desktop-first control console with sidebar navigation, data-heavy pages, and detail views. The React Native mobile app should remain a mobile-first duty and personal monitoring experience with bottom-tab navigation and explicit detail drill-ins. The work is not a cross-platform UI unification project.

Responsive behavior is allowed to introduce equivalent presentation variants:

- Web small-screen navigation may switch from fixed sidebar to top bar plus drawer.
- Web table-oriented pages may degrade to card or stacked list layouts on narrow screens.
- Mobile wide-screen layouts may switch from single-column content to split or multi-column content areas.

These variants are allowed only when page meaning, information order, and interaction semantics remain unchanged.

## Current State

### Web

The current web shell in [`apps/web/src/App.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/App.tsx) assumes a desktop viewport:

- Sidebar width is hard-coded through `w-64` and `w-16`.
- Main content width is offset with `ml-64` and `ml-16`.
- No small-screen navigation mode exists.

Page-level responsiveness exists only in scattered local Tailwind grids:

- [`apps/web/src/pages/Overview.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/Overview.tsx)
- [`apps/web/src/pages/People.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/People.tsx)
- [`apps/web/src/pages/PersonCreateWizard.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/PersonCreateWizard.tsx)
- [`apps/web/src/pages/TaskDetail.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/TaskDetail.tsx)
- [`apps/web/src/pages/NodeDetail/*`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/NodeDetail)

The repository lacks a unified responsive shell, consistent container widths, shared table-degradation rules, and common page density rules.

### Mobile / React Native

The current mobile app assumes a phone-sized portrait layout:

- [`apps/mobile/src/app/styles.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/styles.ts) uses fixed spacing and many fixed `row` compositions.
- [`apps/mobile/src/components/common.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/common.tsx) exposes shared shells and cards with no width-aware layout behavior.
- [`apps/mobile/src/App.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/App.tsx) already separates admin, person, and detail-screen branches clearly, but layout mode does not change with width.

This works acceptably for standard phone portrait use, but not for:

- small phones
- phone landscape
- foldables in folded and unfolded states
- tablets in portrait and landscape

## Goals

- Make every web and mobile page readable and operable across supported viewport classes.
- Preserve existing page semantics, routes, navigation logic, and product identity.
- Keep web and mobile distinct rather than converging their designs.
- Cover all pages equally rather than optimizing only high-traffic screens.
- Centralize responsive behavior into shared primitives and rules where practical.

## Non-Goals

- Do not redesign the information architecture of either client.
- Do not make web and mobile visually converge into one product language.
- Do not introduce new product capabilities as part of responsiveness work.
- Do not replace existing navigation models with new router stacks or navigation libraries.
- Do not perform unrelated UI refactors that are not required for responsive behavior.

## Constraints

- All existing pages are considered equally important.
- Original layout semantics must remain intact.
- Equivalent responsive variants are allowed only when they preserve information order and page purpose.
- Web and mobile should remain intentionally different experiences.

## Recommended Approach

Use a progressive enhancement strategy with a small responsive infrastructure layer per client.

### Why this approach

This is the lowest-risk approach that satisfies the constraints:

- It preserves existing semantics and page structure.
- It avoids a repository-wide redesign.
- It gives all pages access to the same responsive rules.
- It reduces repeated one-off fixes by introducing a few shared layout primitives first.

### Rejected alternatives

#### Page-by-page manual patching

Rejected because it creates inconsistent behavior and long-term maintenance drift. The repository already shows scattered responsive behavior; continuing that pattern would worsen inconsistency.

#### Full design-system rebuild

Rejected because it would expand the scope from responsive adaptation into a broad UI refactor, which conflicts with the requirement to preserve original layout and semantics.

## Responsive Model

### Web viewport tiers

The web app should use viewport tiers aligned with its current Tailwind approach:

- `xs`: below `640px`
- `sm`: `640px` to `767px`
- `md`: `768px` to `1023px`
- `lg`: `1024px` to `1279px`
- `xl`: `1280px` and above

These tiers control:

- navigation mode
- page padding
- max content width
- grid column counts
- table degradation behavior
- chart label density

### Mobile layout profiles

The React Native app should use width-driven profiles rather than device-type branching:

- `compact`
- `regular`
- `medium`
- `expanded`

Profile selection should be derived from the current available width and height, not from device branding or operating system heuristics. This ensures correct behavior for foldables, rotation, and split-screen cases.

These profiles control:

- screen padding
- section gaps
- card padding
- stack direction
- summary block counts
- split-pane eligibility
- header density

## Web Architecture

### Responsive shell

[`apps/web/src/App.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/App.tsx) should evolve from a fixed desktop shell into a width-aware shell with equivalent navigation behavior:

- `lg` and above: fixed left sidebar, current console model preserved
- `md`: left sidebar remains available but may default to collapsed
- `sm` and below: replace fixed offset shell with top bar plus drawer navigation

Navigation links, route structure, and role-based visibility rules must remain unchanged.

### Shared web layout primitives

Introduce a small set of reusable layout primitives or conventions under `apps/web/src`:

- `AppShell` or equivalent responsive shell wrapper
- `ResponsiveSidebar` and top-bar trigger behavior
- `PageContainer` for max-width and horizontal padding
- `PageHeader` for title, meta, and action alignment
- shared responsive list and table conventions

The goal is not to over-abstract, but to stop every page from implementing its own breakpoints and spacing policy.

### Web content rules

All pages should follow the same content adaptation rules:

- Title and action areas stack vertically on narrow widths.
- Summary card grids collapse to fewer columns before any text becomes unreadable.
- Secondary metadata wraps or truncates rather than forcing overflow.
- Two-column detail regions collapse to single-column stacks on narrow widths.
- Wide tables degrade by priority, then scroll, then card conversion depending on width and page needs.

## Mobile / React Native Architecture

### Shared responsive layout hook

Add a shared width-aware layout hook in `apps/mobile/src/app/` or a similar shared location, tentatively named `useResponsiveLayout()`.

Responsibilities:

- read current dimensions
- derive orientation
- derive `compact / regular / medium / expanded`
- return spacing and density tokens
- expose helper booleans such as `isTwoColumn`, `isWideHeader`, or equivalent

### Shared responsive style model

[`apps/mobile/src/app/styles.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/styles.ts) should stop being purely static for layout behavior. Visual theme values can remain centralized there, but responsive layout values should be driven by shared layout metrics.

Recommended structure:

- keep color, typography, radius, and surface semantics stable
- derive layout spacing and composition from the responsive profile
- allow common components to switch between row, column, wrap, and multi-column variants without duplicating logic everywhere

### Shared mobile component adaptation

Responsive behavior should be concentrated first in shared components:

- [`AuthenticatedShell`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/common.tsx)
- [`BottomTabs`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/common.tsx)
- [`SectionCard`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/common.tsx)
- [`ServerCard`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/common.tsx)
- [`TaskRow`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/common.tsx)

These components should consume responsive profile information rather than hard-coding phone-portrait assumptions.

## Page-Level Design Rules

### Web pages

#### Shell and navigation

- Preserve the current sidebar-based desktop console identity.
- On narrow screens, swap presentation to top bar plus drawer instead of shrinking the fixed sidebar.
- Keep the same route destinations and access logic for admin and person roles.

#### Dashboard and grid pages

Applies to pages like:

- [`Overview.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/Overview.tsx)
- [`People.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/People.tsx)
- [`PersonCreateWizard.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/PersonCreateWizard.tsx)

Rules:

- card grids scale down from multi-column to single-column
- column-spanning cards lose span before text density becomes unreadable
- title and action clusters stack on narrow widths
- filter bars become vertical stacks when necessary

#### Data-table pages

Applies to pages like:

- [`Nodes.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/Nodes.tsx)
- [`Tasks.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/Tasks.tsx)
- [`Alerts.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/Alerts.tsx)
- [`Security.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/Security.tsx)

Rules:

- `lg+`: keep table-first presentation
- `md`: allow horizontal scroll and hide or compress lower-priority columns
- `sm-`: render stacked card/list variants for primary workflows when tables no longer fit

Table degradation must preserve:

- key status
- primary identity fields
- primary actions
- essential timestamps or summary metrics

#### Detail pages

Applies to pages like:

- [`NodeDetail`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/NodeDetail)
- [`TaskDetail.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/TaskDetail.tsx)
- [`PersonDetail.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/PersonDetail.tsx)

Rules:

- wide layouts may present panels side by side
- narrow layouts stack panels vertically in the existing semantic order
- tabs remain tabs; narrow widths may compress, wrap, or horizontally scroll tab headers
- charts retain trend readability even when axis density is reduced

### Mobile / React Native pages

#### Connection and authentication surfaces

Applies to:

- [`ConnectionScreen.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/screens/ConnectionScreen.tsx)

Rules:

- phones remain single-card and mobile-first
- wide layouts may split explanatory content and form content into equivalent parallel regions

#### Admin and person home screens

Applies to:

- [`AdminScreens.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/screens/AdminScreens.tsx)
- [`PersonScreens.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/screens/PersonScreens.tsx)

Rules:

- `compact` and `regular`: preserve single-column scroll rhythm
- `medium`: allow summary blocks and cards to form two-column compositions
- `expanded`: allow split content zones, such as main content plus secondary event or inbox content, without changing page priority order

#### Task and list screens

Applies to:

- [`PersonScreens.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/screens/PersonScreens.tsx)

Rules:

- maintain task browsing as a primary vertical list pattern
- use wider cards and internal two-column metadata layouts on large widths instead of converting the full task page into a dense multi-column gallery

#### Server detail

Applies to:

- [`ServerDetailScreen.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/screens/ServerDetailScreen.tsx)

Rules:

- phones remain vertically stacked
- `medium`: allow summary sections and metric groups to become two-column
- `expanded`: allow a primary and secondary content split while preserving the same semantic order and drill-down behavior

#### Settings

Applies to:

- [`SettingsScreen.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/screens/SettingsScreen.tsx)

Rules:

- settings groups remain groups
- wide layouts may place groups side by side
- preference order inside each group must remain unchanged

## Implementation Strategy

Use a three-layer implementation model.

### Layer 1: responsive infrastructure

- web shell and container primitives
- mobile layout profile hook and metrics

### Layer 2: shared components

- web page headers, list/table conventions, shell components
- mobile shell, cards, rows, and tab containers

### Layer 3: page adoption

Apply the new responsive primitives to all pages, keeping page-specific logic focused on composition rather than raw viewport decisions.

## File-Level Scope

### Web

Likely files to modify:

- [`apps/web/src/App.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/App.tsx)
- [`apps/web/src/styles/globals.css`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/styles/globals.css)
- page files under [`apps/web/src/pages`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages)
- shared components under [`apps/web/src/components`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/components)

Potential new files:

- responsive shell and container helpers
- table/list responsive primitives

### Mobile

Likely files to modify:

- [`apps/mobile/src/App.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/App.tsx)
- [`apps/mobile/src/app/styles.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/styles.ts)
- shared components in [`apps/mobile/src/components/common.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/common.tsx)
- screen files under [`apps/mobile/src/screens`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/screens)

Potential new files:

- `useResponsiveLayout` hook
- layout helper utilities

## Validation Criteria

### Web

Responsive success means:

- no critical content is obscured by fixed navigation on narrow screens
- every page remains readable and operable across `xs/sm/md/lg/xl`
- small-screen workflows do not depend on unusable fixed-width desktop assumptions
- detail pages preserve meaning when collapsed to one column

### Mobile / React Native

Responsive success means:

- phone portrait, phone landscape, foldable folded, foldable unfolded, tablet portrait, and tablet landscape all remain usable
- no action buttons, status chips, or metadata blocks break layout due to fixed row assumptions
- wide layouts use extra space meaningfully instead of only increasing whitespace
- bottom-tab navigation and detail-state behavior remain unchanged

### Cross-cutting

Responsive work must not break:

- route behavior
- role-based page visibility
- detail-screen branching
- existing task and server drill-in semantics

## Testing Strategy

### Automated

Add or update tests where shared layout logic becomes explicit:

- web shell mode selection helpers, if extracted
- mobile responsive profile helpers
- rendering tests for high-risk shared components where responsive modes affect structure

Existing behavioral tests must continue to pass, especially around:

- auth gating
- task detail behavior
- route-level rendering

### Manual

Manual validation is required for:

- web at representative widths for each tier
- mobile phone portrait and landscape
- foldable narrow and wide postures
- tablet portrait and landscape

Required checks:

- navigation access remains correct
- core page actions remain reachable
- tables degrade predictably
- detail pages remain readable
- layout shifts do not introduce clipping or hidden content

## Risks

### Web shell regressions

Changing navigation presentation can break route highlighting, overlay behavior, or content offset logic if shell responsibilities are not centralized.

### Semantic loss during table degradation

Transforming desktop-style tables into small-screen cards can accidentally drop important actions or status fields if degradation rules are inconsistent.

### False responsiveness on RN wide screens

Simply stretching phone layouts across wider widths would create sparse and awkward screens. Responsive behavior must actively change composition, not just width.

### Fragmented breakpoint logic

If pages continue inventing their own responsive rules, the repository will remain inconsistent and costly to maintain.

## Rollout Notes

This is a client-side design and implementation effort only.

It does not require:

- server API changes
- data model changes
- authentication changes
- role model changes

Documentation updates should be limited to design, plan, and any user-facing notes that become necessary because interaction presentation changes on certain viewport sizes.
