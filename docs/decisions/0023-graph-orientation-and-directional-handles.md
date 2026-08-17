# 23. Top-down graph orientation with an explicit left-to-right alternative

- **Status:** accepted
- **Date:** 2026-08-17
- **Context issue:** #54
- **Builds on:** [0008 — Architecture canvas](./0008-architecture-canvas-layout-and-edge-bundling.md)

## Decision

The architecture graph uses one shared `GraphOrientation` value throughout the
URL, projection, React Flow handles, ELK ports and edge fallback geometry.
`top-down` is the default and maps to ELK `DOWN`; `left-right` is an explicit
alternative and maps to `RIGHT`. The workspace `layout` search parameter makes
either view shareable and reproducible (`?layout=left-right`).

Incoming handles and ELK ports are `NORTH` and outgoing handles are `SOUTH` in
the default orientation. The alternative retains `WEST`/`EAST`. Orthogonal
fallback routes and bundle fan-out use the same orientation so a dragged node
does not detach its relationships from the corresponding handles.

Changing orientation is an explicit camera action: temporary drag positions are
cleared, the graph is laid out in the new coordinate system, and one fit is
applied when that layout is ready. Selection, open containers and inspector
context remain URL/UI state and are not reset. Live model updates continue to
follow the existing camera policy and never move the camera on their own.

## Consequences

Wide architecture models use vertical layers by default, leaving more useful
horizontal room in the centre pane. Call chains and horizontal data flows can
still be read left-to-right and linked directly. Coordinates remain transient;
the backend contract and persisted model stay unchanged.
