# 25. Spatial keyboard navigation as a roving architecture-graph composite

- **Status:** accepted
- **Date:** 2026-08-17
- **Context issue:** #60
- **Builds on:** [0018 — Accessible architecture nodes](./0018-accessible-architecture-nodes.md),
  [0023 — Graph orientation and directional handles](./0023-graph-orientation-and-directional-handles.md),
  [0024 — Readable semantic zoom levels](./0024-readable-semantic-zoom-levels.md)

## Decision

The visible component nodes form one composite keyboard surface. Exactly one
visible node has `tabindex="0"`; the other visible nodes use `tabindex="-1"`.
Rendered relationship elements stay programmatically focusable for their
existing activation behavior but are not additional Tab entries. Controls
inside a node remain native controls and are not intercepted by the graph
handler.

Arrow keys use the absolute rectangles of the current React Flow layout,
including accumulated parent positions. A candidate must lie in the requested
half-plane; distance on the requested axis, alignment on the other axis, the
orientation's reading axis, and finally the stable component id provide
deterministic tie-breaking. The focused node is selected/opened only by Enter
or Space. Moving focus pans the viewport when necessary through the existing
focus camera policy and preserves zoom; it never changes node positions.

When a relayout, collapse/expand, orientation change, live update or removal
invalidates the focused id, focus falls back to the nearest visible ancestor
or the first visible canonical node. The German and English graph instructions
describe the single Tab entry, spatial arrows, pan-without-zoom behavior and
independent node controls.

## Integration risk

The next free local ADR number is 0025. Unmerged PRs #67 and #68 may add ADR
or E2E files using the same sequence, so integration must reconcile filenames
and numbering after those branches are reviewed. Their changes are not part of
this decision or this branch.

## Consequences

The graph no longer exposes every node or relationship as a linear Tab walk;
keyboard users discover spatial neighbors instead. The interaction is stable
for both top-down and left-right layouts, but tests and future layout changes
must continue to use the actual laid-out rectangles rather than model order.
