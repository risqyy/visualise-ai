# 8. Architecture canvas: ELK layered layout, resolvable edge bundling and a camera that stays put

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #9 (part of the v0 epic #1)
- **Builds on:** [0003 — Frontend state split and live updates](./0003-frontend-state-split-and-live-updates.md),
  [0005 — Read API shape and run scoping](./0005-read-api-shape-and-run-scoping.md)

The orientation choice recorded here was superseded by [0023 — Top-down graph
orientation](./0023-graph-orientation-and-directional-handles.md): top-down is
now the default and the original left-to-right layout remains an explicit
alternative. The bundling, routing and camera invariants below still apply.

## Context

The architecture canvas is the product. It is the dominant surface at
1920 × 1080, it is what the user is looking at while agents work, and it is the
entry point for the overlays (#10) and the inspector (#12).

Four properties make it either usable or useless, and none of them is a matter
of taste:

- The picture of one model must not change between two viewings of it.
- Parallel relationships — three NATS topics between the same two components —
  must be readable at a glance *and* individually identifiable.
- The camera belongs to the user, not to the data.
- Nothing the user does to the picture may look like a change to the model.

The read API delivers a flat list of components with `parentComponentId`, a flat
list of typed relationships, and orders both by id (ADR 0005). It has no notion
of coordinates, and it must not gain one: v0 is read-only observation, and the
agent reports an architecture, not a diagram.

## Decision

### A pure projection adapter between the domain model and React Flow

`src/canvas/graphProjection.ts` is the single translation from
`Component[]`/`Relationship[]` to React Flow `Node[]`/`Edge[]`. It contains no
React and no React Flow runtime code — the only import from `@xyflow/react` is a
type import, which the compiler erases — so the hierarchy rules, the bundling
rule and the robustness rules can be tested without rendering anything.

It is **total**. A snapshot is agent-reported data, and agent-reported data can
be wrong:

| Input | Behaviour | Diagnostic |
| --- | --- | --- |
| `parentComponentId` not in the snapshot | component becomes a root | `orphanedParents` |
| cycle in the hierarchy | alphabetically first member is cut loose | `hierarchyCycles` |
| relationship endpoint not in the snapshot | relationship is not drawn | `danglingRelationships` |
| duplicate id | first occurrence wins | `duplicate*Ids` |

Nothing is dropped silently: everything the adapter had to repair is counted and
surfaced on the canvas. Cutting the *alphabetically first* member of a cycle
rather than the first one encountered is what makes the repair independent of
the order the rows arrived in.

### ELK `layered`, and determinism as a tested property

An architecture model is a directed, mostly acyclic graph: callers precede
callees, one layer per hop. That is exactly what a Sugiyama-style algorithm
draws, so `elk.algorithm: layered` with `elk.direction: DOWN` by default;
`RIGHT` remains the explicit left-to-right alternative (ADR 0023).
Force-directed layouts were rejected because they produce a different picture
every run, and tree layouts because they cannot express the cross-links an
architecture is full of.

`elk.hierarchyHandling: INCLUDE_CHILDREN` lets one layout pass place the nested
compound containers and route edges across container boundaries;
`elk.edgeRouting: ORTHOGONAL` is not cosmetic, because the layered algorithm
sizes the gap between two layers according to the routing style.

**Determinism is secured on three levels, and each is covered by a test:**

1. **Canonical input.** The projection emits nodes and edges sorted by id
   (parents before children, as React Flow requires), and the layout sorts again
   before handing the graph to ELK. The order the read API serialised its rows
   in therefore cannot reach the solver.
2. **Pinned randomness.** `elk.randomSeed` is fixed and the order-driven
   heuristics are selected explicitly (`LAYER_SWEEP`,
   `considerModelOrder.strategy: NODES_AND_EDGES`, `BRANDES_KOEPF`).
3. **Fixed sizes.** Node sizes are constants, never measured from the DOM and
   never dependent on the zoom-driven detail level. A layout that depended on a
   rendered box would differ between a browser and a test, and between the first
   and the second frame.

The results are rounded to hundredths of a pixel, which turns "the same model
lays out identically" into a statement that can be asserted bit for bit.
`elkLayout.test.ts` lays the same model out twice, lays out a version with
re-shuffled input lists, and compares positions and edge routes.

ELK is loaded through a dynamic `import()`. Its bundled build is ~1.4 MB and has
no business in the entry chunk of a cockpit that may never open a project; it
now forms its own chunk, which is the code splitting ADR 0003 anticipated.

**Handles are declared, not measured.** Every node carries directional handles
(incoming north/outgoing south by default, west/east in the left-to-right
alternative) on the node object, and ELK gets fixed ports at exactly those
coordinates (`elk.portConstraints: FIXED_POS`). The polyline ELK returns
therefore starts and ends *on* the handle. Edge geometry becomes a pure
function of the layout instead of a function of a rendered DOM.

### Relationship kinds are encoded without colour at all

`src/index.css` reserves the accent hues for the four work states, because in
this product colour means "phase of work" (ADR 0003). Spending six more hues on
relationship kinds would either collide with that or force the reader to learn
two unrelated colour languages at once.

So relationship kinds use **no colour whatsoever**. Every edge is drawn in the
same graphite, and the kind is carried by three channels that survive greyscale:
a stroke pattern that is unique per kind, an arrow head (filled or open) and a
text badge with the kind's abbreviation. A greyscale screenshot of the canvas
loses no information about what kind an edge is, and the legend shows exactly
those three channels.

### Bundling is a rendering, and it must be reversible

Every NATS topic is its own relationship; the server never merges them
(ADR 0005), and neither does the adapter. But three parallel lines between the
same two boxes are unreadable at overview zoom, so the canvas draws one edge per
ordered node pair.

That edge **carries the complete, individually addressable list**. Whether it is
drawn as one line or as several is a rendering decision:

- folded (default, low zoom): one line, one badge with the count and the kind
  (`3 × NATS`),
- unfolded (zoom ≥ 1.15, or one click on the badge): one line per relationship,
  each labelled with what identifies it — `channel` for a topic, `operation` for
  a call.

Bundling by the **ordered** pair, not the unordered one, keeps the direction of
an edge meaningful; `A → B` and `B → A` stay two edges.

The reason the reversibility is a decision and not a detail: a bundle that could
not be opened would be an aggregation, and an aggregation is exactly what the
contract forbids for topics. If the user cannot get from the picture back to the
individual reported topic, the canvas has silently lost data the agent sent.
`resolveEdgeBundle` is the function that guarantees the way back, and a test
asserts it by reading the `channel` and `operation` of each individual
relationship of a folded bundle.

The layout always runs on the folded graph — one ELK edge per pair — so
unfolding a bundle never moves a node.

### Progressive detail, without touching the layout

Three levels: `overview` (name + kind), `standard` (+ technology), `full`
(+ tags, bundles unfolded). The **node box size is the same at all three**. If
the box grew with the detail level, zooming in would re-layout the graph and
move everything under the camera — the exact motion this canvas exists to avoid.
Only the content inside the fixed box changes.

The levels are a shortcut, never a gate: everything hidden at `overview` stays
reachable by interaction at that zoom level.

### Temporary positions stay local

Dragging a node is allowed, and it writes into `uiStore.nodePositions` — local,
transient, not persisted, and never into the query cache or the domain model
(ADR 0003). Two reasons, and the second is the important one:

- v0 is read-only observation. The architecture is what the agent reported; it
  is not the user's to edit.
- If a drag reached the model, a refetch could not tell a user's gesture from a
  reported change. The read API would then have to carry coordinates, and the
  cockpit would start owning a diagram instead of showing an architecture.

`applyTemporaryPositions` is the boundary: server-derived nodes in, local
positions in, a render-only result out. Nothing writes back. Edges whose
endpoint was dragged lose their ELK route and fall back to a plain orthogonal
connection, so a moved node never drags a stale polyline behind it. The toolbar
offers "Positionen zurücksetzen", which is a no-op on the model by construction.

### The camera moves by itself only while the surface is still settling

`fitView` runs in exactly three situations: the first laid-out model of a
project, a change of the *surface size* before the user has touched the camera,
and an explicit user action. **An incoming live event is none of them** — not a
new component, not a removed relationship, not a replacing snapshot.

The resize case is not a loophole, it is the fix for a real defect: the three
panes measure themselves asynchronously, so the first layout can arrive while
the centre pane is still a few hundred pixels wide. Fitting against that leaves
the model pinned at minimum zoom with no indication why. The policy therefore
waits for a surface of at least 240 × 240 and re-fits if the surface changes
size *before* the first real pan or zoom. React Flow reports `null` as the event
of a programmatic move and the input event of a user one, which is exactly the
distinction needed to tell "still settling" from "the user is driving".

The rule lives in `cameraPolicy.ts` as a pure function rather than inside the
canvas component, so it can be asserted directly: five consecutive model updates
must all return "do not move", and so must a resize after the user took over.
The integration test additionally replaces the whole architecture through the
real SSE code path and checks that the rendered viewport transform, the
selection and the number of `fitView` calls are unchanged afterwards.

`instance.fitView()` itself is not used. It schedules itself through React
Flow's node-change queue, which a fully controlled graph without `onNodesChange`
never drains — the call is silently dropped. The canvas computes the viewport
from the layout bounds and applies it with `setViewport`, which also makes the
resulting camera a pure function of the ELK layout.

Selection is not canvas state either. A click writes the `component` search
param through the typed route (#7); the canvas reads it back. A deep link and a
click therefore produce the same state, and a live update cannot disturb either.

### The minimap stays

At 1920 × 1080 the centre pane is ~1037 px wide and ~880 px tall. The minimap is
168 × 112 px in the top-right corner — about 2 % of the canvas area, and it sits
over empty space rather than over the graph, because the layout grows to the
right and downwards from the origin. That is a fair price for orientation in a
model that no longer fits on screen, which is the normal case above ~20
components. It is switchable, and the toggle is persisted with the other
layout-ish UI state.

## Consequences

- The read API stays free of coordinates, and it must stay that way: the moment
  a position is reported, the determinism argument above becomes the server's
  problem instead of the client's.
- A new relationship kind needs a new entry in `relationshipKinds.ts` with a
  stroke pattern that is not already taken. Six kinds are comfortable; beyond
  roughly eight, stroke patterns stop being distinguishable and the encoding
  would have to change — probably to a badge-only scheme.
- ELK is a real solver and the layout is asynchronous. The canvas keeps the
  previous graph on screen while it runs and shows a quiet indicator, so a
  re-layout never blanks the surface. A layout that fails leaves the last good
  picture visible.
- The layout is skipped entirely when the structural fingerprint of a refetch is
  unchanged, which is the common case: TanStack Query's structural sharing keeps
  the array identity, and a `projectionSignature` catches the rest.
- The overlays in #10 attach to this structure without changing it: a work state
  becomes a border style and an icon on an existing node, and a stroke colour on
  an existing edge. Neither changes a node's box size, so neither can move the
  layout.
- The initial bundle grew by React Flow; ELK is lazy. The 500 kB warning of
  ADR 0003 still applies to the entry chunk and is still acceptable for a
  desktop cockpit on a local network.
