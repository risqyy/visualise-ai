# 17. A readable entry picture: a floor under the automatic zoom and a hierarchy that opens on demand

> **Threshold note:** Issue #56 / [ADR 0024](./0024-readable-semantic-zoom-levels.md)
> supersedes this record's former 10 px-derived `0.77` floor with separate
> effective floors for primary (12 px) and secondary (10 px) text. The hierarchy
> disclosure and camera ownership decisions below remain in force.

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #34 (part of the v0 epic #1)
- **Builds on:** [0008 — Architecture canvas](./0008-architecture-canvas-layout-and-edge-bundling.md),
  [0010 — Live change overlays](./0010-live-change-overlays.md)

## Context

The architecture canvas is the product (ADR 0008), and until now it opened by
fitting the whole reported model into the centre pane. Measured in Chromium at
1920 × 1080, with the centre pane at 1035.7 × 932.5 CSS px:

| model | fitted zoom | leaf node | component name |
| --- | --- | --- | --- |
| `visualise-ai-self`, 28 components / 4 levels | **0.203** | 46.3 × 19.5 px | **2.6 px** |
| a synthetic model of 32 components / 4 levels | **0.282** | 64.3 × 27.1 px | **3.7 px** |

A 2.6 px glyph is not small type, it is not type. The most important surface of
the cockpit was unreadable at the moment it opened, and it got worse with every
component an agent reported — which is the direction a project only ever moves
in.

Two things were wrong, and they are independent:

1. **The camera had no floor.** `fitView` accepted any zoom down to the canvas
   minimum of 0.12 as long as everything fitted.
2. **Everything was on screen at once.** A reported architecture is a hierarchy;
   drawing all four levels of it in the entry picture spends the whole surface
   on detail nobody asked for yet.

Neither may be fixed by weakening what ADR 0008 and ADR 0010 secured: the layout
stays deterministic, and after the first picture the camera belongs to the user —
`data-fit-view-count` stays `1` for a whole simulator run.

## Decision

### The readable zoom is derived, not chosen

`MIN_READABLE_ZOOM` in `src/canvas/detailLevel.ts` is computed from two numbers
that already exist in the product:

- a node's identifying label is `text-[13px]` (`NODE_LABEL_FONT_SIZE_PX`),
- the smallest type the design system renders anywhere at zoom 1 is `text-[10px]`
  — kind badges, technology rows, tags, both legends
  (`MIN_LEGIBLE_FONT_SIZE_PX`).

The canvas draws its nodes inside a CSS transform, so every glyph is scaled by
the zoom. Requiring the component name to stay at or above the product's own
legibility floor gives

```
13 px × zoom ≥ 10 px   ⇒   zoom ≥ 10 / 13 ≈ 0.7692   ⇒   0.77
```

rounded **up**, so the floor is never undercut by the rounding. The constant is
a division of two constants, not a number picked because a screenshot looked
acceptable, and `detailLevel.test.ts` asserts the derivation rather than the
result. If the node label ever changes size, the floor moves with it.

At 0.77 a leaf node measures 175.6 × 73.9 CSS px and its name renders at 10.0 px.

The floor is not a function of the canvas width, and the derivation deliberately
does not mention one: it is a statement about glyphs, not about how much fits.
How much fits *is* a function of the actual surface, which is why the camera
reads the measured width rather than the 1036 px of the acceptance layout —
issue #41 moves the centre pane to 660 px at a 1280 px window, and nothing here
changes because of it.

### The floor applies to the automatic camera only

`viewportForBounds` in `cameraPolicy.ts` takes a `minZoom`. There are exactly two
callers:

- the **initial** fit — the one movement the user did not ask for — passes
  `MIN_READABLE_ZOOM`,
- an **explicit** "Gesamtes Modell einpassen" passes the canvas minimum and is
  free to go to 0.20 if that is what showing everything costs.

That difference is the whole rule. The user may always choose to see a model too
small to read; the cockpit may never choose it for them.

`viewportForBounds` also owns the second half of the camera: a model that does
not fit at the readable zoom is anchored at its **top-left** corner instead of
being centred. The default ELK layout now runs top-down with callers first
(ADR 0023); its explicit left-to-right alternative retains the caller-first
ordering described in ADR 0008. In either orientation, the beginning is where
an architecture is read from; centring an oversized model drops the reader in
the middle of a sentence. The inset is
derived from the existing `FIT_VIEW_PADDING`, so an anchored model sits exactly
as far from the edge as a centred one.

The camera policy itself is unchanged. `onLayoutReady` still returns a reason at
most once per project plus while the surface is settling, and **no new exception
was added**: the readable floor changes *where* the camera goes, never *whether*
it moves. A live event still returns `null`.

### The selected component is an input to the first picture

The floor and the anchoring together produced a defect worth naming, because it
is the exact failure mode this ADR otherwise argues against. A deep link into a
component four levels down opened the path to it and selected it — and then the
readable zoom put it 732 px past the right edge of a 1036 px surface: **0 %
visible**. The inspector described a component the architecture surface did not
show anywhere. Fitting the whole model, for all its illegibility, had at least
kept the linked node on screen.

`viewportForBounds` therefore takes an optional `focus` rectangle, and the
initial camera passes the box of the component the URL points at. It is brought
in by **panning only** — by the least amount that gets it inside — and never by
zooming out: the floor is not the price of following a link, and the two are not
in competition, since a leaf node is 176 × 74 px at the readable zoom and fits
any supported surface many times over. A focus that is already visible leaves
the camera untouched.

This is deliberately **not** a fourth `fitView` reason, and the alternative —
treating a deep link as an explicit user action, i.e. a second movement — was
rejected. There is only ever one automatic movement, and at the moment it
happens no user has taken the camera over; letting it read the URL as well as
the layout gives it one more input, not one more occasion. `data-fit-view-count`
is `1` for a deep link exactly as it is without one.

The boundary is where it has to be: `selectedComponentId` is in the dependency
list of the layout effect, so a **later** selection change re-runs the policy —
and the policy answers `null`. Choosing another component by clicking therefore
leaves zoom and pan byte-identical, even when the newly selected component is
off screen. From the first picture onwards the camera is the user's, and a
selection is not a request to move it. `ArchitectureZoom.test.tsx` asserts both
halves: the linked node lies inside the surface rectangle after the first
render, and a click afterwards changes nothing about the viewport transform.

"Systemebene" reproduces the entry picture and therefore honours the selection
the same way. "Gesamtes Modell einpassen" does not: it is a statement about the
model, not about one component of it.

### The hierarchy opens on the top two levels

`src/canvas/collapse.ts` reduces the projected graph to what a set of collapsed
containers leaves visible. A project opens with `initialCollapsedIds`: every
container deeper than `INITIAL_EXPANDED_DEPTH` (= 1), i.e. root components and
their direct children are drawn and everything below waits behind its container.

On `visualise-ai-self` that is 10 of 28 components; on the 32-component model, 8
of 32. The rule is a property of the reported hierarchy, not of the node count,
so a model with 300 components opens with the same handful of boxes.

**Why expand/collapse and not a zoom-driven semantic zoom.** Showing or hiding a
container's children changes the ELK input and therefore the layout. Bound to the
zoom, that would move every box under the camera while the user scrolls — the
exact motion ADR 0008 exists to prevent, and the reason the node box size is
already independent of the detail level. Expanding is an explicit act instead:
the camera stays where it is and the boxes rearrange, which is precisely what
ADR 0010 already established for an arriving proposal.

The existing detail levels are untouched and keep their job — *how much a drawn
node says*. This ADR adds the orthogonal question of *which nodes are drawn*.
`MIN_READABLE_ZOOM` (0.77) lands in the `standard` level, so a project now opens
showing names, kinds **and** technology, where it used to open in `overview`.

### Collapsing hides components, it never hides information

Three rules keep the closed picture honest, and each is a test:

- **A relationship is lifted, not dropped.** An edge whose endpoint is hidden is
  re-attached to the nearest visible ancestor and bundled there. Four leaves
  writing to the store become one `Service → Store` edge that still carries all
  four reported relationships; `resolveEdgeBundle` resolves it exactly as
  ADR 0008 requires of every bundle. A relationship whose two ends collapse into
  the same box is internal to it and is not drawn — a self loop on a container
  states nothing — and it returns the moment the container is opened.
- **A work state is rolled up.** A closed container carries the dominant state of
  everything behind it, through the same `dominantOverlay` precedence as
  everywhere else, with every contribution kept so the mark's `title` still lists
  them one by one. Hiding a component must not hide what an agent is *doing* to
  it; that is the one thing this cockpit exists to show. The **operation** is
  deliberately not rolled up — `geplant · entfernen` on a container would claim
  the container is being removed — and neither is the presence, so a proposal
  inside an applied container does not dim it.
- **The reported counts do not move.** `data-node-count` stays the number of
  applied components of the model, and the pane header still says "28
  Komponenten". `data-visible-node-count` and `data-hidden-node-count` are new
  attributes for what is drawn. Collapsing is a way of looking, never a claim
  about the model — the same distinction ADR 0008 draws for edge bundles and
  ADR 0003 for dragged positions.

`collapseGraph` returns its input arrays unchanged when nothing is collapsed, so
an open canvas is provably the graph `projectArchitecture` produced.

### Determinism survives, because the reduction is canonical

The collapsed set is normalised and sorted, the reduction preserves the
projection's canonical order (parents before children, siblings by id, edges by
id), and node sizes stay declared constants — a closed container shrinks to
`LEAF_NODE_SIZE`, which is a constant, not a measurement. ELK therefore still
sees canonically ordered input with declared sizes and a pinned seed, and the
determinism tests of ADR 0008 are untouched. `collapse.test.ts` asserts it
directly: the same model with re-shuffled input lists and a reversed collapsed
set produces an identical `projectionSignature`.

One detail is load-bearing enough to name: a collapsed container keeps its React
Flow **node type**. React Flow remounts a node whose type changed, and a
remounted node is measured from the DOM — which would put a rendered box back
into the layout path this canvas is built to keep out of it.

### A deep link opens the path to its component

A link into a component four levels down expands its ancestors. The alternative —
land on a canvas where the linked component is not drawn — would make the deep
link a broken promise, and there is no way to show a component without opening
what contains it.

It is resolved **with** the initial collapsed set, before the first layout, so a
deep link still costs exactly one ELK run and one camera movement:
`data-fit-view-count` is `1` on a deep link exactly as it is without one. Being
drawn is not the same as being on screen, though — see "The selected component
is an input to the first picture" above for the second half of this.

The reverse case is handled explicitly: closing a container that holds the
current selection moves the selection **up** to that container, so the URL never
points at something that is not on screen and the inspector never describes an
invisible component.

### The disclosure is transient, like the camera

`collapsedComponentIds` lives in `uiStore` next to the camera, the drag positions
and the selection, and like them it is **not** persisted. It describes a concrete
architecture snapshot; restoring it into a model whose hierarchy has meanwhile
changed would hide components the user never chose to hide. It is reset when the
project changes, and — like the camera — an arriving event never touches it.

`null` means "this project has not been disclosed yet" and is materialised into
an explicit list as soon as a layout exists, because a derived set cannot be
toggled: opening one container would have to know which others were closed.

## Consequences

Measured in Chromium at 1920 × 1080, centre pane 1035.7 × 932.5 px, with
`localStorage` cleared before each measurement:

| | before | after |
| --- | --- | --- |
| `visualise-ai-self` (28) — initial zoom | 0.203 | **0.770** |
| leaf node | 46.3 × 19.5 px | **175.6 × 73.9 px** |
| name × zoom | 2.6 px | **10.0 px** |
| detail level | `overview` | `standard` |
| components drawn | 28 | 10 (18 behind 2 containers) |
| 32 components / 4 levels — initial zoom | 0.282 | **1.000** |
| leaf node | 64.3 × 27.1 px | **228 × 96 px** |
| name × zoom | 3.7 px | **13.0 px** |

- **The entry picture no longer shows the whole model.** That is the trade, and
  it is the point. Everything stays reachable three ways — the chevron on a
  container, a deep link, and "Gesamtes Modell einpassen", which opens everything
  and fits it. "Systemebene" reproduces the entry picture on demand.
- **A large model is now partly off-screen at the readable zoom.** 28 components
  on their top level lay out to 1944 × 518, which is 69 % of a 1036 px surface at
  0.77. The minimap (ADR 0008), the anchored overflow and the focus on the
  selected component are what make that navigable rather than disorienting.
- **A selection that is off screen stays off screen.** Only the *first* picture
  pans to the selected component. Clicking a node the user can see cannot move
  the camera, and neither can a selection arriving from anywhere else. If it
  turns out that following a link from the inspector into an off-screen
  component needs the camera too, that is a new, explicit user action and it
  belongs in the toolbar next to "Einpassen" — not in the policy.
- **Two canvas test files start from the open model.** `ArchitectureCanvas.test`
  and `ChangeOverlays.test` assert bundling, overlays and selection on components
  three and four levels down; they now pass `expandAllComponents` to `renderApp`,
  which is the state the "Gesamtes Modell einpassen" button produces. Every
  assertion in them is unchanged. The acceptance suite does the same through the
  button itself (`e2e/src/canvas.ts`), so the end-to-end run exercises the real
  control rather than a test seam.
- **The toolbar grew a button** and now wraps instead of overflowing, because the
  centre pane can be resized down to a few hundred pixels and a toolbar running
  past its own edge takes its controls out of reach.
- **A collapsed container is one more thing that will need an accessible name.**
  Its disclosure control has one; the node itself does not, and neither did it
  before — that is #35, which builds on this. A hidden node must not be a tab
  stop either, which is a property #35 gets for free because a hidden node is not
  rendered at all.
- `INITIAL_EXPANDED_DEPTH` is a product decision disguised as a constant, like
  `RECENT_APPLIED_LIMIT` in ADR 0010. One level below the roots is right for a
  reported architecture, where depth 0 is the system and depth 1 its parts. A
  model that puts everything interesting at depth 3 would open on a page of
  containers; the fix would be to disclose by subtree size rather than by depth,
  and it belongs in `initialCollapsedIds` alone.
