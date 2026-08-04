# 18. Accessible architecture nodes: a name, a state and a focus ring that survives the zoom

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #35 (part of the v0 epic #1)
- **Builds on:** [0003 — Frontend state split and live updates](./0003-frontend-state-split-and-live-updates.md),
  [0008 — Architecture canvas](./0008-architecture-canvas-layout-and-edge-bundling.md),
  [0010 — Live change overlays](./0010-live-change-overlays.md),
  [0012 — Component inspector](./0012-component-inspector-and-markdown-safety.md),
  [0014 — Localisation architecture and translation contract](./0014-localisation-architecture-and-translation-contract.md),
  [0017 — Readable entry zoom and progressive disclosure](./0017-readable-entry-zoom-and-progressive-disclosure.md),
  [0019 — Locale-aware formatting and the UTC rule](./0019-locale-aware-formatting-and-the-utc-rule.md)

## Context

The architecture canvas is the product (ADR 0008). React Flow makes every node
and every edge a tab stop, which reads like accessibility and is not: measured
against the running cockpit (`visualise-ai-self`, 28 components over four
levels, one open proposal), the accessibility tree contained

- **29 focusable nodes, 0 of them named** — each one a `group` with the
  roledescription `node` and no `aria-label` at all,
- **34 focusable edges**, named `Edge from <componentId> to <componentId>` in
  English and built from ids rather than from the reported names,
- **no focus indicator anywhere**: React Flow's own stylesheet sets
  `outline: none` on `.react-flow__node.selectable:focus-visible` and on
  `.react-flow__edge:focus-visible`, so the ring the design system defines never
  applied,
- **a node description that offered actions the cockpit does not have** —
  "Press delete to remove it" and "use the arrow keys to move the node around",
  in a read-only observation tool with `deleteKeyCode={null}`,
- **Enter and Space that did nothing.** React Flow's built-in handler sets its
  *internal* selection; the graph here is fully controlled and has no
  `onNodesChange`, so the change was dropped. Selection was mouse-only.

(Those counts are the model fully expanded — the picture before ADR 0017 landed.
With the progressive disclosure a project now opens on 10 drawn nodes and 24
drawn edges, and every one of the defects above applied to each of them.)

Component name, kind, change state and selection — everything the box shows —
were unavailable to a screen reader. Two further properties made a naive fix
insufficient: the canvas draws inside a CSS transform, so any ring is multiplied
by the zoom, and the camera belongs to the user (ADR 0008), so nothing about
focus may move it.

## Decision

### One module owns everything the canvas says

`src/canvas/canvasAccessibility.ts` builds every accessible name, role and
description; `ArchitectureCanvas` only wires it up. The module reads the same
sources the drawing code reads — `componentKinds` for the kind label,
`overlayLabel` for the work state, `DISCLOSURE_LABELS` for the disclosure verbs
— so a state cannot be worded one way on the box and another way in the
accessibility tree. It never invents a second vocabulary and never adds a
judgement: the four states of `src/state/workStates.ts` describe a *phase of
work*, and `entfernt` means "is being removed", not "bad" (ADR 0003).

Every German string it speaks sits in one exported object, `CANVAS_A11Y_TEXT`,
so the i18n migration (#42) has a single place to pull from.

**Counted nouns are the one exception, and they are passed in.** "10 Komponenten"
is already localised (ADR 0019), and this module is pure and free of React by
design — the same discipline `graphProjection.ts` follows, and the reason its
rules can be tested without rendering anything. It therefore cannot hold a `t`
of its own, and it must not build one: a module-local plural table would be a
second one next to the catalogues, which is exactly what #40 removed. So the
module takes a `CountText` — `(noun, count) => string` over the three nouns it
speaks — and `useCanvasCountText` is the single seam that resolves it against
`common:count.*` for the two React callers. `count.relationship` was added to
both catalogues for it; #40 had left it out for want of a caller.

The consequence is worth stating plainly: until #42 migrates the `canvas`
namespace, an English reader hears a **German frame around an English count** —
`Container mit 10 components`. That is the same half-migrated state the visible
canvas is already in (`10 components eingeklappt` on a closed box, from #34),
and it is the correct intermediate: the count was the part that was actually
*wrong* before, because a German plural table cannot say "1 component".

### A node stays a `group` — what was missing was never the role

React Flow already gives a focusable node `role="group"`. The obvious fix was to
make it `role="button"` with `aria-pressed`, and that would have been wrong:
a container renders a real disclosure `<button>` inside itself (ADR 0017), and
`button` is one of the roles whose children are **presentational**. A node
marked up as a button takes that toggle out of the accessibility tree — trading
one unreachable thing for another. What was missing was never the role. It was
the name.

So the role stays `group`, and the two things a group cannot say are said
otherwise:

- **Selection travels as `aria-current`.** It is a *global* ARIA state, valid on
  any role, and it means exactly what a canvas selection is: the current item
  among a set of related ones. It is set only on the selected node —
  `aria-current="false"` on the other 27 boxes is noise, not information.
- **Container against leaf travels as `aria-roledescription`** —
  `Architekturcontainer` against `Architekturkomponente` — plus the child count
  in the name. The two are told apart by words rather than by the size of a box.

**`aria-expanded` stays on the disclosure control, not on the node.** It belongs
to the element that performs the disclosure, it is already there (ADR 0017), and
`group` does not support it — duplicating it onto the node would be invalid ARIA
that `aria-allowed-attr` flags. What the node carries instead is the *state* in
words: a closed container announces that it is closed and how many components
are behind it, the same number the closed box prints.

The name is built as *identity* + *disclosure* + *state*:

```
Router, Modul, in HTTP Layer, geplant · hinzufügen
└─ reported name  └─ kind   └─ container path   └─ work state, from overlayLabel
```

**Identity is qualified only as far as it has to be.** An agent may report the
same name twice — a `Router` in the HTTP layer and a `Router` in the gRPC layer
are two components with two ids. The name therefore starts as "name, kind",
gains one container level at a time while it still collides with another, and
falls back to the reported component id when even the full path is ambiguous
(two identically named siblings of the same kind). A component whose name is
already unambiguous does not drag its hierarchy along.

The **work state and the disclosure are deliberately not part of the identity**.
Both change while the user watches; an identity that moved with them would not
be an identity. They are appended afterwards, and when nothing was reported the
name says so explicitly — `kein Änderungsstatus gemeldet`. A screen reader must
be able to tell "no state" from "state not conveyed", which is exactly the
distinction the drawn box makes by carrying no mark.

Two things the closed containers of ADR 0017 add to that:

- a closed container says `eingeklappt, 3 Komponenten verborgen`, the same
  number its box prints, so the picture and the announcement agree on what is
  missing;
- when the state on a closed container was rolled up from something *inside* it
  (`rollUpOverlay`), the name says so. Without that the announcement would claim
  the container is the element an agent is working on — which is the same class
  of error the roll-up itself already avoids by dropping the operation.

Edges are named from the same reported data the line is drawn from: the two
endpoint names, every relationship the edge carries with its discriminator, and
the count when it is a bundle. A bundle stays a rendering and never a merge
(ADR 0008), so all three NATS topics are named individually in one label. Past
six relationships — which a closed container can produce, because `collapse.ts`
lifts hidden endpoints onto their nearest visible ancestor — the name switches
to a count. That is a limit on the *name*, not on the data: unfolding the bundle
still gives every single relationship its own label.

The endpoint names come from `graph.nodes`, the nodes that are actually drawn.
Because a lifted edge always ends on a *visible* ancestor, every endpoint of
every drawn edge has a name and none can fall back to an id.

### The focus ring is divided by the live zoom

The canvas publishes its zoom as a CSS custom property on the drawing surface
(`--vai-canvas-zoom`), written imperatively on every camera move — the wrapper
carries no `style` prop, so React never overwrites it, and publishing costs no
render. The stylesheet then declares

```css
outline-width: calc(var(--vai-focus-ring-width) / var(--vai-canvas-zoom));
```

which makes the **rendered** ring a constant number of CSS pixels instead of a
constant number of model units. Measured in Chromium at 1920 × 1080 against
`visualise-ai-self`:

| zoom | declared `outline-width` | rendered ring |
| --- | --- | --- |
| 0.124 (canvas minimum) | 24 px | **2.99 px** |
| 0.309 | 9 px | **2.79 px** |
| 0.770 (entry zoom, ADR 0017) | 3 px | **2.31 px** |
| 1.109 | 2 px | **2.22 px** |
| 2.500 (canvas maximum) | 1 px | **2.50 px** |

Before, at every one of those zoom levels: no outline at all. The remaining
spread comes from Chromium snapping `outline-width` down to whole device pixels;
it never approaches invisibility.

The rules sit **outside every cascade layer** and carry one class more than
React Flow's. Tailwind v4 uses real `@layer`, and unlayered CSS beats layered
CSS regardless of specificity — a ring written inside `@layer components` would
have lost to React Flow's unlayered `outline: none` no matter how specific it
was, and no matter which stylesheet the bundler emitted first.

### Keyboard activation is intercepted above React Flow

One `onKeyDownCapture` on the canvas surface handles Enter, Space, Escape and
the arrow keys for the focused node or edge. The capture phase is the only place
that runs *before* React Flow's own handlers, and stopping the event there is
the point:

- **Enter and Space** write the `component` search parameter — the same path a
  click takes, so URL, selection and inspector cannot drift apart (ADR 0008).
  React Flow's internal, dropped selection never runs.
- **Escape** clears the selection and, unlike React Flow's handler, does not
  blur the node: a keyboard user must not lose their place.
- **Arrow keys are swallowed.** React Flow would announce "Moved selected node
  right. New position, x: …, y: …" over its aria-live region while nothing
  moves, because the controlled graph drops the position change. Announcing a
  change that did not happen is the same defect as not announcing one that did.
- **A real control inside a node is left alone.** When the key comes from the
  disclosure `<button>` of a container, the handler returns immediately: opening
  a container and selecting one are two different intents (ADR 0017), and the
  button is its own tab stop with its own action.

Activating an edge unfolds a bundle or selects the single relationship — the two
actions its badges already offer to the mouse, so a tab stop stops being a
dead end.

### The camera: one deliberate exception, and it is not a fit

`autoPanOnNodeFocus` stays **on**, and is now written out explicitly rather than
inherited as a default. Focusing a node that lies outside the viewport brings it
into view at the same zoom.

This is a decision, not an oversight. It is requested by the user's own Tab
press, not by arriving data; it is the difference between a visible focus
indicator and an invisible one (WCAG 2.4.7 and 2.4.11 are unsatisfiable
otherwise); and it is **not a `fitView`**. The camera policy of ADR 0008 is
untouched and no new automatic movement was added.

**It became visible only after ADR 0017.** At the old entry zoom of 0.20 the
whole model was inside the viewport, so the pan never fired and the viewport
transform stayed byte-identical through a full keyboard walk. At the readable
entry zoom of 0.77 a large model no longer fits, and tabbing to a node outside
the viewport now really pans — measured against `visualise-ai-self`:
`translate(27.8409px, 213.362px) scale(0.77)` →
`translate(410.97px, 15.665px) scale(0.77)`.

So the guarantee has to be stated precisely, and it is the one the tests assert:

| | keyboard focus / selection |
| --- | --- |
| `data-fit-view-count` | never moves |
| zoom | never changes |
| pan | follows the focus, and only the focus |

The alternative — switching `autoPanOnNodeFocus` off — would put the focus ring
on a node nobody can see, which is a worse answer to the same question this ADR
exists for.

### Automated coverage, and where it stops

`axe-core` runs over the architecture pane and the inspector pane after a
keyboard selection, so the graph, the selection and the hand-over to the
inspector are audited in one pass. Two boundaries are explicit:

- **Colour rules are disabled**, because jsdom has neither layout nor rendering
  and `color-contrast` would be undecidable rather than passing. That colour is
  never the only channel is asserted where it is decided — `workStates.test.ts`
  requires a label, an icon and a line style next to every hue.
- **The audit is scoped to the two panes.** Over the whole page axe additionally
  reports the two resize handles of the workspace layout under `region` ("all
  page content should be contained by landmarks"): they sit *between* the panes
  and therefore inside none of them. That is a best-practice finding about the
  workspace shell (#7, touched again by #41), not about the architecture graph,
  and disabling the rule globally here would have hidden it for the panes too.

## Consequences

- The node label is the only place a component's identity is spelled out for
  assistive technology. A future change to what a node *shows* has to change
  what it *says* in the same commit; `ArchitectureAccessibility.test.tsx`
  compares the two channels node by node and fails when they diverge.
- Names get longer in deep hierarchies with repeated component names. That is
  the price of uniqueness, and it is paid only where a collision exists.
- Only what is **drawn** is named. `graph.nodes` is already the collapsed graph
  (ADR 0017), so a component behind a closed container is neither a tab stop nor
  an accessible name — the accessibility tree and the picture contain the same
  set of things. Tests that need every component say so with
  `renderApp(path, { expandAllComponents: true })`.
- The disclosure control's accessible name is built here
  (`nodeDisclosureLabel`) from the verbs `DISCLOSURE_LABELS` already owns, so the
  button, its tooltip and its accessible name cannot drift into three different
  words — at the cost of a dependency from `ComponentNode` onto this module.
- `axe-core` is a new dev dependency. It does not enter the bundle.
- The German strings stay hard-coded, in `CANVAS_A11Y_TEXT` and
  `DISCLOSURE_LABELS`. ADR 0014 puts accessible names squarely in the
  *translated* half of the contract; migrating the `canvas` namespace is #42,
  and both collections exist so that migration is a move, not a hunt.
- A name is now built from two sources with different lifetimes — the German
  scaffolding here and the counted nouns in the catalogues. Adding a counted
  noun means adding it to `de` and `en`; `check:locales` fails otherwise, which
  is the intended way to find out.
- The React Flow strings that are *not* replaced (`aria-roledescription="node"`
  is overridden per element, the aria-live message is unreachable) remain
  English in the library. If a future version starts using them, the config in
  `CANVAS_ARIA_LABEL_CONFIG` is where they get German text.
