# People Active Filter Design

Date: 2026-04-16

## Summary

This design adds a lightweight activity filter to the people directory page.

The people page will gain a small header toggle with two options:

- all
- currently active

The default view will be currently active.

Current activity is defined entirely from the existing person summary payload. A person is considered active when any of the following is true:

- running task count is greater than 0
- queued task count is greater than 0
- active server count is greater than 0
- current VRAM is greater than 0

This is a UI-layer change only. It does not require new backend filters or API fields.

## Goals

- Let operators quickly focus the people directory on people with live or pending workload
- Keep the filter model simple with only two states in the first release
- Default the page to the more operationally useful active view
- Reuse the existing person summary data instead of introducing a new API contract
- Preserve the current page loading sequence where the base people list renders before the heavier summary query completes

## Non-Goals

- Adding a broader multi-filter system to the people directory
- Changing directory card ordering or introducing activity-based ranking
- Introducing server-side filtering or new query parameters for the people list
- Changing the meaning of any existing person summary metric
- Redesigning the people page layout beyond the new header toggle and filter-specific empty state

## Current State

- The people directory page renders a grid of person cards from the full person list.
- Page data loads in two stages: first the person records, then the heavier summary payload.
- Cards already display the metrics needed to infer current activity: current VRAM, running tasks, queued tasks, and active server count.
- The page currently has no list filtering controls.
- The existing empty state only covers the case where there are no people at all, not the case where a filter returns no matches.

## Design Decisions

### 1. Add A Two-State Header Filter

The people directory header will include a compact toggle control near the page title.

Supported filter states:

- all
- currently active

The first render defaults to currently active.

Rationale:

- this matches the requested scope without overbuilding a general filtering framework
- a visible two-state toggle is lighter and faster than a dropdown when only two options exist
- defaulting to currently active makes the page immediately useful for operational review

### 2. Define Activity From Existing Summary Metrics

The currently active filter is evaluated entirely in the UI after person summary data has loaded.

Active rule:

- include the person if runningTaskCount > 0
- include the person if queuedTaskCount > 0
- include the person if activeServerCount > 0
- include the person if currentVramMB > 0
- exclude the person only when all four values are 0

Rationale:

- it follows the agreed definition that any live or pending operational signal should count as active
- it avoids backend work because the needed fields already exist in the current summary model
- it keeps the activity rule easy to explain and test

### 3. Keep Filtering Local To The Render Layer

The page will continue to fetch the full person list and then the full summary list. Filtering is applied only to the final row set used for rendering.

Design rule:

- do not add API parameters
- do not split the summary endpoint
- do not change card metric presentation

Implication:

- when summary is still loading, the page continues to show the existing loading state
- once summary resolves, the active filter is applied to the merged directory rows
- if summary fails and falls back to an empty summary array, the active filter resolves against zero-valued metrics and returns no active people

Rationale:

- it preserves the current fast-first-render behavior
- it keeps the change isolated to the people page
- it avoids mismatched semantics between frontend and backend filtering

### 4. Add A Filter-Specific Empty State

The page needs a distinct empty state for the currently active filter.

Behavior:

- if there are no people at all, keep the existing global empty state
- if there are people but none match currently active, show a filter empty state instead
- the filter empty state should clearly say that there are currently no active people
- the filter empty state should provide an obvious action to switch back to all

Rationale:

- reusing the global no-people empty state would be misleading
- operators need a quick way to recover from an empty filtered result without guessing where the hidden rows went

### 5. Keep Sorting Unchanged In This Iteration

The filter will not also change card ordering.

Design rule:

- preserve the current list order
- do not introduce secondary sorting by activity score, VRAM, or running tasks in this change

Rationale:

- filtering and ranking are separate product decisions
- keeping ordering stable reduces regression risk and keeps the scope tight

## Testing

The implementation should cover these cases:

- default page state renders only active people once summary data is available
- switching to all restores the complete directory list
- a person with any one of the four activity signals is included in currently active
- a person with all four signals at zero is excluded from currently active
- when summary loading fails, the page shows the filter-specific empty state rather than the no-people empty state
- when there are no person records at all, the existing no-people empty state still appears

## Documentation

Update the user-facing people documentation with a short note that the directory supports an all versus currently active filter and that activity is based on running tasks, queued tasks, active servers, or current VRAM.

## Open Questions Resolved

- filter set: all plus currently active only
- default filter: currently active
- interaction style: header toggle rather than dropdown
- activity definition: any of running tasks, queued tasks, active servers, or current VRAM