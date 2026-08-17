# 25. Screen-space hit areas for canvas interactions

- **Status:** accepted
- **Date:** 2026-08-17
- **Context issue:** #59
- **Builds on:** [0008 — Architecture canvas](./0008-architecture-canvas-layout-and-edge-bundling.md),
  [0017 — Readable entry zoom and progressive disclosure](./0017-readable-entry-zoom-and-progressive-disclosure.md),
  [0018 — Accessible architecture nodes](./0018-accessible-architecture-nodes.md),
  [0024 — Readable semantic zoom levels](./0024-readable-semantic-zoom-levels.md)

## Decision

Primary canvas actions use a minimum effective target of **32 × 32 CSS px** for
fine pointers and **44 × 44 CSS px** for coarse pointers. This applies to
container disclosure, relationship actions, the minimap toggle and toolbar and
zoom controls. Independent targets keep at least 8 px of spacing where their
layout allows it. Fanned relationship bundles use 48 model px between labels
so the 32/44 px screen-space targets do not collide at the readable zoom floor.
Independent edges that share a source or target use deterministic route-relative
label lanes between 35% and 65%; this separates wide relationship pills without
changing the ELK route or either endpoint.

Nodes and edge labels are rendered below React Flow's camera transform. Their
outer hit-area element therefore uses the reciprocal live zoom so its browser
bounding box remains in screen pixels. A nested visual wrapper scales back by
the live zoom; icons, labels and fixed ELK node dimensions do not grow, and
hover, pressed, focus and disabled states do not change layout bounds.

The disclosure and relationship controls keep `nodrag`/`nopan` semantics and
stop pointer propagation. Their hit areas are separate from the visible glyph
or badge, so clicking a generous target cannot start a node drag or canvas pan.
The transparent edge interaction path uses the same screen-space stroke width
when a relationship label is hidden at map zoom.

The visual language remains the existing graphite/dark theme. State changes add
contrast through background, border, shadow and opacity, while the semantic
focus ring remains visible at every zoom. Browser acceptance checks measure
bounding boxes at map, readable and full zoom and in fine/coarse pointer
contexts; relationship action boxes must not overlap one another.

## Consequences

- Enlarging the interaction area does not alter ELK input dimensions or move
  nodes under the camera.
- At very low whole-model map zoom the target occupies more model space, but
  its effective screen size stays bounded and the map remains operable.
- A future canvas action must use the same screen-space helper and must be
  included in the multi-zoom, pointer-mode bounding-box check.
