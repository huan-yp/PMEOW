# GPU Allocation Owner Color Design

## Summary

Update the GPU VRAM allocation bars in both the Web node detail view and the mobile node detail view so that different owners shown on the same page do not reuse the same color. At the same time, preserve the distinction between managed and unmanaged usage for the same owner.

The design is intentionally scoped to the current node detail page only:

- Different owners visible on the current page must receive different owner colors.
- The same owner does not need to keep the same color across different pages or sessions.
- Managed and unmanaged usage for the same owner must still be distinguishable.
- The implementation should minimize churn in the existing Web and mobile codepaths.

The resulting visual language is:

- Real owner: unique page-local base color
- Managed usage: owner base color with stripe texture
- Unmanaged usage: owner base color as a solid fill
- Unknown usage: fixed warning color
- Free VRAM: fixed neutral color
- Historical or unresolved managed fallback: fixed neutral color with managed stripe texture

## Current State

### Shared behavior problem

The current Web and mobile implementations both derive owner colors from a fixed 16-color palette plus `djb2Hash(ownerKey) % OWNER_PALETTE.length`.

That logic exists in:

- [`apps/web/src/utils/ownerColor.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/utils/ownerColor.ts)
- [`apps/mobile/src/app/gpuAllocation.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/gpuAllocation.ts)

This guarantees collisions once the number of visible owners on a page exceeds the palette size, and collisions can happen earlier because different owner keys can hash to the same index.

### Web rendering

The Web node detail page already distinguishes managed and unmanaged usage visually in [`apps/web/src/components/GpuBar.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/components/GpuBar.tsx):

- Managed reserved usage uses a stripe background
- Unmanaged usage uses a solid fill

However, owner colors are still assigned through the fixed hashed palette, so different owners can still appear with the same base color on the same page.

The Web legend in [`apps/web/src/pages/NodeDetail/components/GpuAllocationLegend.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/NodeDetail/components/GpuAllocationLegend.tsx) currently shows one plain swatch per owner and does not explain the managed versus unmanaged texture rule.

### Mobile rendering

The mobile node detail page builds VRAM owner groups in [`apps/mobile/src/app/gpuAllocation.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/gpuAllocation.ts) and renders bars in [`apps/mobile/src/components/monitoring.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/monitoring.tsx).

Today the mobile VRAM distribution section:

- uses the same hashed fixed palette as Web
- renders allocation segments as flat color blocks
- does not render a dedicated managed stripe texture
- shows a simple legend swatch per owner

As a result, mobile currently loses the managed versus unmanaged distinction in the bar itself and still suffers from owner color collisions.

## Goals

- Ensure that different real owners visible on the same node detail page do not share the same owner color.
- Keep the same owner color shared across that owner's managed and unmanaged usage on the page.
- Represent managed usage with stripe texture.
- Represent unmanaged usage as a solid fill.
- Keep fixed semantic colors for unknown and free VRAM.
- Apply the same semantic rules to both Web and mobile.
- Minimize architectural and file-structure churn.

## Non-Goals

- Do not guarantee global cross-page owner color stability.
- Do not change backend contracts, APIs, or ingestion behavior.
- Do not redesign the node detail layout.
- Do not replace the existing Web HTML/CSS bar renderer with a shared renderer.
- Do not refactor the entire GPU allocation data model into a large shared package in this iteration.

## Confirmed Decisions

- Scope: update both mobile and Web.
- Color uniqueness: only within the current node detail page.
- Managed and unmanaged usage must remain distinguishable for the same owner.
- Managed usage uses texture.
- Unmanaged usage stays as a solid block.
- Keep implementation changes as small as practical.

## Proposed Approach

Preserve the current split between:

- allocation calculation helpers
- platform-specific rendering
- platform-specific legend UI

Then replace only the owner color assignment and segment/legend derivation rules.

The implementation should continue to use the existing helper entry points:

- Web:
  - [`apps/web/src/utils/gpuAllocation.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/utils/gpuAllocation.ts)
  - [`apps/web/src/utils/ownerColor.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/utils/ownerColor.ts)
- Mobile:
  - [`apps/mobile/src/app/gpuAllocation.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/gpuAllocation.ts)

The renderers should remain platform-specific:

- Web continues to render bars with HTML/CSS in [`apps/web/src/components/GpuBar.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/components/GpuBar.tsx)
- Mobile continues to render bars inside [`apps/mobile/src/components/monitoring.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/monitoring.tsx), adding texture support there instead of introducing a new navigation or charting layer

## Color Assignment Model

### Semantic classes

These classes keep fixed colors and do not participate in unique owner-color allocation:

- `unknown`
- `free`
- `managed:unresolved`
- `managed:historical`

This preserves the existing semantic meaning for system-origin segments.

### Real owner color pool

Only real owners participate in page-local unique color allocation.

A real owner is any group derived from:

- managed task ownership resolved to a real user
- unmanaged process ownership resolved to a real user

Page-local owner colors should be assigned from the current page's visible owner set, not from hashing.

### Ordering for deterministic page-local assignment

To keep colors stable during rerenders on the same page, owner assignment should use a deterministic ordering:

1. Sort owners by total displayed VRAM on the page, descending
2. Break ties by owner label, ascending

This avoids order drift from map iteration or GPU traversal order.

### Color generation

Replace the fixed 16-color palette for real owners with a generated page-local palette.

Recommended rule:

- Generate `N` distinct base colors for `N` real owners on the page
- Use evenly distributed hue steps with fixed saturation and lightness
- Guarantee no direct color reuse within the page

This design does not require the palette to remain stable across different pages. It only needs to be deterministic for the currently visible owner set.

## Segment Semantics

### Segment types

Each GPU bar should be rendered from source-aware segments instead of a single blended owner block.

For a real owner:

- managed segment: owner color plus stripe texture
- unmanaged segment: owner color solid fill

For semantic system segments:

- unknown segment: fixed warning solid fill
- free segment: fixed neutral solid fill
- unresolved or historical managed fallback: fixed neutral fill plus managed stripe texture

### Segment ordering

Owner ordering should still follow total displayed VRAM descending, then owner label ascending.

Within each owner:

1. managed segment
2. unmanaged segment

This keeps same-owner segments adjacent while preserving the managed-first semantics already used by the current Web implementation.

After all owners:

1. unknown
2. free

This makes the user-resolved sections visually primary and keeps free VRAM at the tail of the bar.

## Texture Rules

### Managed texture

Managed usage should be represented by a stripe texture over the owner base color.

Recommended texture:

- diagonal stripe
- brighter stripe color derived from the same owner base color
- fixed line width and spacing across Web and mobile

This keeps the visual system simple:

- same base color means same owner
- stripe means managed
- no stripe means unmanaged

### Unmanaged texture

Unmanaged usage remains a solid fill with no texture.

This is intentional and should not be replaced with a second pattern. The user explicitly prefers the simpler rule: managed has texture, unmanaged is solid.

## Legend Design

### Owner entries

Each owner should continue to appear once in the legend, but the swatch should explain both source states.

Recommended legend item:

- owner label
- total displayed VRAM
- combined owner swatch:
  - one managed-textured portion
  - one unmanaged-solid portion

This keeps the legend compact while explaining the visual rule directly.

### System entries

Keep separate legend entries for:

- unknown usage
- free VRAM

Show unresolved or historical managed fallback only when present, using the neutral managed texture style.

### Why not split each owner into two legend rows

That would create unnecessary legend bloat, especially on pages with many owners. A single owner row with a combined swatch communicates the same rule with less UI churn.

## Platform-Specific Implementation

### Web

Keep the current HTML/CSS bar structure in [`apps/web/src/components/GpuBar.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/components/GpuBar.tsx).

Changes:

- replace hashed owner color assignment with page-local unique assignment
- keep managed stripe texture
- keep unmanaged solid fill
- update legend swatch rendering in [`apps/web/src/pages/NodeDetail/components/GpuAllocationLegend.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/NodeDetail/components/GpuAllocationLegend.tsx) to show combined managed and unmanaged semantics

The current CSS gradient approach for managed texture is sufficient and should be reused rather than replaced.

### Mobile

Keep the existing VRAM distribution layout in [`apps/mobile/src/components/monitoring.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/monitoring.tsx).

Changes:

- replace hashed owner color assignment with page-local unique assignment
- render managed segments with stripe texture
- keep unmanaged segments as solid fills
- update the legend rows to show the combined owner swatch semantics

To minimize churn, the mobile change should stay local to the current VRAM distribution section. It should not introduce a new global chart system or replace the surrounding section layout.

Managed texture on mobile should be implemented with a small `react-native-svg` pattern overlay that stays contained to the allocation segment renderer.

## File-Level Change Scope

### Web

- [`apps/web/src/utils/ownerColor.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/utils/ownerColor.ts)
  - replace or extend owner color assignment for page-local unique colors
- [`apps/web/src/utils/gpuAllocation.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/utils/gpuAllocation.ts)
  - derive source-aware segments and page-local owner ordering
- [`apps/web/src/components/GpuBar.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/components/GpuBar.tsx)
  - consume the updated segment semantics
- [`apps/web/src/pages/NodeDetail/utils/gpu.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/NodeDetail/utils/gpu.ts)
  - update the legend model to expose the combined managed and unmanaged owner swatch data
- [`apps/web/src/pages/NodeDetail/components/GpuAllocationLegend.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/web/src/pages/NodeDetail/components/GpuAllocationLegend.tsx)
  - update legend rendering

### Mobile

- [`apps/mobile/src/app/gpuAllocation.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/gpuAllocation.ts)
  - derive page-local unique owner colors and source-aware segments
- [`apps/mobile/src/components/monitoring.tsx`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/components/monitoring.tsx)
  - render managed texture and updated legend semantics
- [`apps/mobile/src/app/styles.ts`](/e:/Projects/PMEOW/PMEOW/PMEOW/apps/mobile/src/app/styles.ts)
  - add only the minimal style support required by the updated legend or segment wrapper

## Testing Strategy

### Pure-function tests

Add targeted tests around allocation derivation and owner color assignment.

Coverage should include:

- different owners on the same page receive different colors
- the same owner's managed and unmanaged segments share the same base color
- managed fallback groups keep neutral managed styling
- unknown and free keep fixed semantic colors
- owner ordering is deterministic
- segment ordering is `managed -> unmanaged -> unknown -> free`

### UI-level verification

Manual verification is required for both Web and mobile node detail pages.

Check these scenarios:

- owner with only managed usage
- owner with only unmanaged usage
- owner with both managed and unmanaged usage
- multiple owners on one page with more owners than the old 16-color palette handled comfortably
- unresolved historical fallback segments when present

Expected outcome:

- no real-owner color collisions on the page
- managed is always textured
- unmanaged is always solid
- same owner remains visually linked by base color

## Risks

### Mobile texture rendering complexity

Managed texture is the main new rendering concern on mobile. The design limits this risk by containing the change to the existing VRAM distribution renderer instead of introducing a new general-purpose graphics layer.

### Page-local color reassignment

Because colors are page-local rather than global, the same owner can look different on another page or after the owner set changes substantially. This is an accepted tradeoff because the requirement explicitly prioritizes current-page uniqueness over cross-page stability.

### Duplicate business logic across Web and mobile

The current repository already duplicates part of the allocation logic across the two frontends. This design accepts that duplication for now to keep changes small and local. A later cleanup can consolidate shared logic if the team decides the rule has stabilized.

## Rollout Notes

This is a frontend-only design:

- no backend contract changes
- no task queue changes
- no agent changes
- no documentation updates required outside the design and implementation artifacts

The implementation should remain tightly scoped to the current node detail VRAM allocation views for Web and mobile.
