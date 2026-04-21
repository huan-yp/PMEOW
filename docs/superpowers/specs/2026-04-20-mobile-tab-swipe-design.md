# Mobile Tab Swipe Design

## Summary

Add full-screen horizontal swipe switching for the mobile app's bottom-level tabs on both admin and person experiences. The implementation should preserve the current app structure, where [`apps/mobile/src/App.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/App.tsx) owns tab state and detail screens are rendered as explicit branch states rather than through a navigation library.

The design keeps swipe behavior limited to first-level bottom tabs:

- Admin tabs: `dashboard`, `alerts`, `settings`
- Person tabs: `home`, `tasks`, `settings`

Detail screens remain outside the swipe container:

- [`ServerDetailScreen`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/screens/ServerDetailScreen.tsx)
- [`PersonTaskDetailScreen`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/screens/PersonTaskDetailScreen.tsx)

This avoids turning a simple tab shell into a mixed navigation stack with competing gesture semantics.

## Current State

The current mobile app does not use `react-navigation` or any existing pager abstraction.

- [`apps/mobile/src/App.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/App.tsx) stores `adminTab` and `personTab` in local React state.
- [`apps/mobile/src/components/common.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/common.tsx) exposes:
  - `AuthenticatedShell`, which lays out the header, content area, and bottom tabs
  - `BottomTabs`, which renders the bottom button bar
- Tab bodies are rendered via direct conditional branches in `App.tsx`.
- Person task detail is already modeled as a substate of the `tasks` tab through:
  - [`isPersonTaskDetailVisible`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/constants.ts)
  - [`normalizeSelectedTaskIdForTab`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/constants.ts)

This structure is simple and predictable. The design should extend it rather than replace it.

## Goals

- Enable left and right full-screen swipe switching between bottom tabs.
- Support the feature for both admin and person roles.
- Keep bottom-tab button selection and swipe navigation fully synchronized.
- Preserve current detail-screen behavior and existing task-detail semantics.
- Minimize architectural churn in the mobile app.

## Non-Goals

- Do not introduce a general-purpose navigation stack.
- Do not make detail screens horizontally swipeable.
- Do not change authentication, store hydration, realtime logic, or notification behavior.
- Do not add circular tab wrapping.
- Do not add drag-progress visuals or custom gesture animation beyond the pager's default behavior.

## Proposed Approach

Use `react-native-pager-view` as the paging implementation for first-level tabs.

### Why this approach

`react-native-pager-view` is the lowest-complexity path for the current codebase:

- The app already targets Android and includes only an Android native project.
- Many tab scenes contain `ScrollView`s, so hand-rolled gesture recognition would need to solve horizontal-vs-vertical conflict handling.
- A native pager gives stable adjacent-page swiping, edge clamping, and page selection callbacks with less code and lower risk than a custom `PanResponder` solution.

### Rejected alternatives

#### Custom `Animated` plus `PanResponder`

Rejected because it shifts complexity from dependency management into gesture correctness:

- Competing horizontal and vertical gestures
- Swipe threshold tuning
- Velocity handling
- Rebound behavior
- State synchronization with bottom-tab buttons
- Future maintenance burden

#### Full navigation-library migration

Rejected because it is disproportionate to the requirement. The current app already has a working shell and explicit detail-state branches. Replacing that with a larger navigation framework would add migration cost without solving an existing architectural problem.

## Architecture

### State ownership

`App.tsx` remains the single source of truth for:

- `adminTab`
- `personTab`
- `selectedServerId`
- `selectedTaskId`

Swipe gestures and bottom-tab presses will both feed the same tab state setters already used today.

### New shared tab pager abstraction

Add a reusable component near [`apps/mobile/src/components/common.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/common.tsx), tentatively named `SwipeTabView<T extends string>`.

Responsibilities:

- Map tab ids to pager page indexes
- Render a pager scene per first-level tab
- Drive external tab state from `onPageSelected`
- Move the pager when external tab state changes due to bottom-tab presses
- Keep all first-level tab scenes mounted inside the pager

Expected props:

- `tabs: Array<{ id: T; label: string }>`
- `activeTab: T`
- `onChangeTab: (tab: T) => void`
- `renderScene: (tab: T) => ReactNode`

No role-specific pager component is needed. Admin and person shells can both reuse the same abstraction.

### Existing bottom tabs stay simple

`BottomTabs` remains a presentational component with button presses only. It should not own or know about the pager implementation.

This keeps responsibilities clear:

- `BottomTabs`: visible control
- `SwipeTabView`: swipe container and tab-index synchronization
- `App.tsx`: authoritative tab and detail state

## Scene Composition

### Admin flow

When an authenticated admin is on a first-level tab view:

- Render a swipe container with scenes for `dashboard`, `alerts`, and `settings`
- Keep the bottom bar visible
- Update `adminTab` from either bottom-tab presses or pager swipes

When an admin opens a server detail screen:

- Do not render the pager
- Render the existing `ServerDetailScreen` branch exactly as today
- Restore the pager view when returning to the main admin shell

### Person flow

When an authenticated person is on a first-level tab view:

- Render a swipe container with scenes for `home`, `tasks`, and `settings`
- Keep the bottom bar visible
- Update `personTab` from either bottom-tab presses or pager swipes

When a person opens task detail:

- Treat it as a detail substate of `tasks`, as already established by current code and tests
- Do not render the pager while the detail screen is visible
- Render the existing `PersonTaskDetailScreen` branch exactly as today
- Return to the pager-backed `tasks` scene when leaving detail

This preserves the current mental model: swipe changes tabs, detail is a focused drill-in state.

## Behavioral Rules

### Tab switching

- Swiping only moves between adjacent tabs.
- Attempting to swipe past the first or last tab keeps the current tab.
- Bottom-tab highlighting continues to reflect `activeTab` only.
- Bottom-tab presses and swipe gestures are equivalent from a state perspective.

### Person task detail semantics

The current helper `normalizeSelectedTaskIdForTab` remains authoritative. Leaving `tasks`, whether by tapping another tab or swiping to another tab, clears `selectedTaskId`.

This is intentional and should not change. It prevents stale hidden detail state from surviving after the user leaves the `tasks` first-level context.

### Scene lifetime

First-level tab scenes should remain mounted inside the pager rather than being unmounted on every tab switch.

Reasons:

- Reduced UI churn
- Better perceived responsiveness
- Natural preservation of in-tab scroll position when returning to a tab

The design accepts preserved scene-local UI state as the preferred behavior for first-level tabs.

## File-Level Changes

### [`apps/mobile/package.json`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/package.json)

- Add `react-native-pager-view` as a mobile dependency

### [`apps/mobile/src/components/common.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/common.tsx)

- Add the new shared `SwipeTabView` component
- Keep `BottomTabs` API unchanged
- Keep `AuthenticatedShell` API unchanged and host the pager through its existing `children` slot

### [`apps/mobile/src/App.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/App.tsx)

- Replace first-level tab conditional rendering with pager scene composition for admin and person shells
- Preserve existing detail-screen branches for server detail and task detail
- Continue using `setAdminTab` and `handleChangePersonTab` as the top-level tab change handlers

### [`apps/mobile/src/app/constants.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/constants.ts)

- Add small pure helpers for tab id to page index mapping and page index back to tab id mapping
- Preserve existing task-detail helper semantics

### [`apps/mobile/tests/person-task-detail.test.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/tests/person-task-detail.test.ts)

- Keep existing task-detail semantics coverage

### New test file

Add a pure-logic test file for tab-index mapping and detail-state branching, using the existing `vitest` setup.

## Error Handling and Fallbacks

If the pager dependency hits an integration problem in the current React Native 0.79 Android setup, the abstraction should remain in place and degrade internally to a non-swipe implementation rather than forcing another top-level structural rewrite.

That means:

- Keep the external `SwipeTabView` contract stable
- Avoid leaking pager-specific assumptions into role-specific screen code
- Preserve compatibility with the current button-only tab switching flow as an emergency fallback

This fallback is a contingency, not the target outcome.

## Testing Strategy

### Automated

Use the existing `vitest` setup for state and helper semantics.

Target coverage:

- Tab id to page index mapping, if extracted to a helper
- Page index back to tab id mapping, if extracted to a helper
- Existing person task detail semantics remain unchanged
- Leaving `tasks` clears selected task id regardless of how tab change is triggered
- Detail-state branches continue to bypass the swipe container

### Manual Android validation

Because the repository does not currently include mobile gesture integration tests, manual Android validation is required.

Required checks:

- Admin first-level tabs can be switched by swiping
- Person first-level tabs can be switched by swiping
- Bottom bar highlight follows swipe results
- Bottom bar taps still work after introducing the pager
- Server detail does not allow tab swiping while visible
- Person task detail does not allow tab swiping while visible
- Leaving `tasks` clears the detail state and returns to first-level tab behavior
- Vertical scrolling in scene content remains usable

## Risks

### Gesture competition with nested scroll content

This is the main functional risk. The design mitigates it by using a native pager rather than custom gesture code.

### Scene persistence side effects

Keeping tab scenes mounted may preserve some local UI state that was previously reset by conditional rendering. This is an acceptable tradeoff because preserved scroll position is beneficial, and the app currently has little scene-local transient state beyond view position and basic expansion toggles.

### Dependency integration friction

Adding a native dependency can surface build or linking issues. The design contains that risk by introducing a shared abstraction rather than wiring the dependency directly into role-specific screen logic.

## Rollout Notes

This is a local UI-shell enhancement. No server changes, API changes, data model changes, or documentation changes outside the mobile design and implementation artifacts are required for the feature itself.

The implementation should remain tightly scoped to `apps/mobile` and the associated design and plan documents under `docs/superpowers/`.
