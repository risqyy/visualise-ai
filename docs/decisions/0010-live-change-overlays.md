# 10. Live change overlays: a picture of the work, drawn beside the model

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #10 (part of the v0 epic #1)
- **Builds on:** [0003 — Frontend state split and live updates](./0003-frontend-state-split-and-live-updates.md),
  [0005 — Read API shape and run scoping](./0005-read-api-shape-and-run-scoping.md),
  [0006 — SSE replay and in-process broker](./0006-sse-replay-and-in-process-broker.md),
  [0008 — Architecture canvas](./0008-architecture-canvas-layout-and-edge-bundling.md),
  [0009 — Generated frontend contract types](./0009-generated-frontend-contract-types.md)

## Context

The canvas (#9) draws what the agent *reported as the architecture*. This work
package draws what the agents *are doing to it* — and the two must never be
confused, because the whole product rests on the user being able to tell an
announcement from a fact.

Four things make that hard, and each of them is a decision below:

1. A planned change is not part of the model, but it has to appear *somewhere on
   the model* to be understandable at all.
2. Several agents work at the same time, on the same components. The picture has
   to merge them without any of them disappearing.
3. Colour is the obvious encoding for four states and the worst one to rely on.
4. Everything arrives while the user is reading something else.

The read API gives one half of the answer and cannot give the other. It returns
the applied model plus `activeChanges`, and `activeChanges` is filtered to
`state = planned` server side (`readapi/projects.go`). It therefore has, by
contract, no way to express

- a work step that is **started and not completed** — the `active` state,
- a change that was **just applied** — the `recently_applied` state, or
- an element an applied change **removed** — the `removed` state, because a
  removed component is precisely the one no longer in the response.

## Decision

### Proposals are drawn beside the model, never inside it

`components`/`relationships` and `activeChanges` are two different statements,
and `src/canvas/changeOverlays.ts` keeps them two. A proposal becomes its **own**
node or edge with `applied: false`, built from `ActiveChange.snapshot` — the
reported descriptor the contract carries verbatim exactly so the canvas can draw
a proposal without a second lookup (ADR 0009). Proposal edges even live in their
own id space (`overlay:src~>tgt` rather than `rel:src~>tgt`), so an announced
edge and an applied edge between the same two components stay two lines: folding
them into one would claim the proposal had already happened.

The separation is visible from outside the component, which is what makes it
testable: the canvas reports `data-node-count` (the applied model) and
`data-overlay-node-count` (proposals and ghosts) as two different numbers. A
`component.change_planned` moves the second and must leave the first untouched.

The counterpart of a proposal is a **ghost**. When an applied change removes a
component, the read model stops returning it — and a component that simply
vanishes from the picture is the one case where the cockpit would be *less*
informative than the log it is showing. The removed element therefore stays on
the canvas, drawn from the descriptor the removing event carried, marked
`presence: ghost` and dimmed. It is evidence of what disappeared, not a claim
that it still exists.

### A client-side change ledger for what the read API cannot say

`src/state/changeLedger.ts` folds the SSE stream into the three facts listed
above. It is not server state and deliberately not a query (ADR 0003): it must
survive a refetch rather than be invalidated by one.

Its scope is deliberate and worth stating, because it is the one place where
this work package is *less* than it could be. A stream opened without a cursor
starts at the live tail instead of replaying the project — `liveOnly` in
`backend/internal/sse/connection.go`, an explicit decision of ADR 0006. The
ledger therefore describes **what the cockpit watched happen**: opening it
mid-run shows the applied model and the pending proposals from the read model,
and every further state as its event arrives. That is exactly what "kürzlich
angewandt" claims and no more. Asking for a full replay (`?lastEventPosition=0`)
on every page load was rejected: it would fire an invalidation per historical
event on every open, and it would change the streaming behaviour of every pane,
not just this one. Replayed events after a *reconnect* are folded in
idempotently — anything at or below `lastPosition` is ignored.

Three rules hold inside it:

- **Nothing is overwritten.** Every change event is appended. A retraction
  *marks* its entry `retracted`, a correction *marks* its entry `superseded` and
  appends the corrected content — the same append-only discipline the event log
  itself follows (ADR 0002). A withdrawn proposal disappears from the overlay
  and stays in the history.
- **"Recent" is counted, not timed.** Only the newest `RECENT_APPLIED_LIMIT`
  (8) applied changes contribute an overlay. A clock-based window was rejected
  outright: it would make the picture change *without an event having arrived*,
  which is the restless behaviour this cockpit exists to avoid, and it would
  make the overlays depend on when the page happened to be opened.
- **A replacing snapshot resets it.** `architecture.snapshot_published` replaces
  the applied model entirely, so every earlier applied/removed statement
  describes a model that no longer exists. Keeping them would draw a ghost of
  something the new snapshot contains. Open work steps survive the reset,
  because a work step is a statement about an agent, not about the model.

The ledger is fed from `applyLiveEvent` — the one function every live event
already passes through — so there is a single apply path and no second stream.

### Concurrent agents are merged by keeping all of them

An overlay is not "the last thing somebody said". `buildChangeOverlays` collects
**every** contribution for a target — every pending proposal, every recent
applied change, every open work step — into `contributions`, each with the agent
that reported it. What gets condensed is only the single work state on the
element, and that condensation is delegated to `resolveWorkState` in
`src/state/workStates.ts`, the module that already owns the four states, so the
canvas cannot invent a fifth or order them differently from the agent tree (#11)
and the inspector (#12).

Alternatives considered and rejected:

- *Last writer wins.* One agent's proposal would silently vanish because another
  agent touched the same component later. That is exactly the "silently
  overwrite" failure the issue names.
- *One overlay per agent, stacked.* Two boxes on one node, three on the next.
  The picture stops being a graph long before an interesting run is over.

What is drawn instead: one mark per element, carrying the dominant state, plus
the **number of contributing agents** next to it whenever it is greater than one,
plus every single contribution listed line by line in the mark's `title`. The
count is the signal that there is more than one story here; the list is the
story. A `data-agent-count` attribute makes both assertable.

A bundle of parallel relationships resolves the same way, through
`dominantOverlay`, which uses the same precedence as `resolveWorkState` — so a
bundle can never announce a weaker phase than one of its members.

### Colour is never the only channel, and the tests never look at colour

Every state carries four channels: the colour, a **text label**, an **icon** and
a **line style** (border style on a box, dash pattern on a line). They come from
`WORK_STATES`, which already declared all four (ADR 0003); this work package
renders them rather than adding new ones.

The label is not just the state, it is the state **plus the operation** —
`geplant · hinzufügen` versus `geplant · entfernen`. Those two are the same
colour and the same border style on purpose: they are the same *phase*. What
tells them apart is a word, and `changeOverlays.test.ts` asserts precisely that
by comparing the two while checking that their state and border style are equal.

The canvas-level test does the same job at the DOM level and reads only
`data-work-state-label`, `data-border-style`, `data-operation` and the visible
text. No assertion in the overlay tests reads a hue — a test that checked a
colour would be proving the opposite of the requirement.

Edges are the one place where two encodings compete for a channel: ADR 0008
already spends the dash pattern on the *relationship kind*. An edge with a state
therefore keeps its kind pattern on the line itself and gets a second, wider
path underneath drawn in the **state's** dash pattern, plus the state mark next
to the kind badge. Kind and phase each keep a channel of their own instead of
fighting over one.

### Status is a phase of work, never a verdict

`WORK_STATE_DISCLAIMER` says it and the legend shows it; this package had to keep
it true in the new strings. Red means "wird entfernt", green means "angewandt".
`CHANGE_OPERATION_LABELS` are the three contract operations in plain German and
nothing else, and a test asserts that the overlay text contains no word from a
list of verdicts (`Fehler`, `falsch`, `schlecht`, `Risiko`, …). The cockpit
performs no drift evaluation — the human reviewer judges (epic #1).

One consequence is worth stating because it looks like an omission: a **planned
removal is yellow, not red.** The four states are exclusive and
`resolveWorkState` resolves them by phase; a removal that has only been announced
is still a proposal, and colouring it like an accomplished removal would claim
the component is already gone. That it is a removal is carried by the word
`entfernen` in the label, by the operation glyph and by `data-operation` — the
same three non-colour channels that carry everything else.

### The camera still belongs to the user

Nothing here calls `fitView`. A proposal arriving adds a node, ELK re-runs and
the *model* moves under a camera that does not — that is `cameraPolicy.ts`
unchanged from ADR 0008, and the overlay tests assert it again with the stricter
case: a proposal component *and* a proposed relationship arrive at once,
`data-fit-view-count` stays `1`, the rendered viewport transform is byte-identical
and the selected component is still selected.

A state change that does **not** change the structure must not re-run ELK at all.
`projectionSignature` covers ids, nesting and sizes only, so a proposal turning
into an applied change leaves the layout alone. That created a real defect —
the laid-out nodes carried stale `data` — which `withCurrentData` in
`useArchitectureGraph` fixes by putting the current data on the previous
positions. States therefore update without a single node moving.

Transitions are 150 ms on colour, border colour and opacity. There is no
keyframe animation anywhere in the overlays, the counter or the marks, and a
test asserts that the counter's markup contains no `animate-` class. The counter
carries no `aria-live`: a screen reader announcing every incoming event is the
auditory version of a camera that jumps. Its row keeps all four states with a
count of zero rather than reflowing when one appears.

## Consequences

- The frontend now maintains a projection of the event log. It is bounded
  (`HISTORY_LIMIT` 200, `RECENT_APPLIED_LIMIT` 8) and reset per project, but it
  is a second place where event semantics live. Adding a change-carrying event
  type means teaching `ingestEvent` about it as well as `affectedQueryKeys`.
- `RECENT_APPLIED_LIMIT` is a product decision disguised as a constant. Eight is
  enough to see a work package's worth of applied changes at once and small
  enough that the canvas is not green everywhere after a long run.
- `ComponentNodeData.component` widened to `AppliedComponent | Component`,
  because an overlay-only node has no provenance — it was never applied. Code
  that needs `appliedAt`/`position` must check `data.applied` first.
- Proposals take part in the ELK layout. That is deliberate — a proposal drawn
  outside the graph would not say *where* the component goes — but it means an
  incoming proposal re-lays out the graph exactly like a real structural change
  does. The camera stays put; the boxes move.
- Ghosts accumulate until a replacing snapshot or the recency bound drops them.
  A run that removes more than eight elements will stop showing the earliest
  ones, which is the same bound as for applied changes and is why it is one
  constant rather than two.
- The overlay states `active` and `recently_applied` are only as good as the
  stream. Against a backend that never delivers `work.step_started` the canvas
  shows planned proposals and nothing else — correct, and visibly less, rather
  than wrong. The same applies to a reload: the applied model and the pending
  proposals come back, the three live states start empty again. Should that turn
  out to be the wrong trade for a real reviewer, the fix is a bounded replay on
  connect, and it belongs in the streaming layer rather than here.
