# 11. Run and agent hierarchy: estimates that cannot be mistaken for measurements

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #11 (part of the v0 epic #1)
- **Builds on:** [0003 — Frontend state split and live updates](./0003-frontend-state-split-and-live-updates.md),
  [0005 — Read API shape and run scoping](./0005-read-api-shape-and-run-scoping.md),
  [0009 — Generated frontend contract types](./0009-generated-frontend-contract-types.md)

## Context

The left pane answers one question: *what are the agents doing right now, and
what did they say about it?* Everything it shows is a report — an agent's own
account of its work — and the pane has no independent way to check any of it.
That is the product boundary of v0: the cockpit observes and the human judges
(#1).

Four things make that boundary easy to violate by accident:

- The contract carries two unrelated percentages under the same field name.
  A subagent reporting `70 %` about its own extraction task and an orchestrator
  reporting `20 %` about the whole run are different kinds of sentence, and the
  obvious rendering — two progress bars under each other — silently claims they
  are comparable.
- `agent.progress_reported` distinguishes `basis: reported_estimate` from
  `basis: completed_steps`. A guess and a count look identical once both are a
  filled bar.
- The agent list arrives flat, with the hierarchy in `parentAgentId`. Whoever
  builds the tree owns what happens when that field does not describe a tree.
- Silence is the normal state of an agent between two events. Any code that
  reacts to it invents a fact.

## Decision

### Estimates and counted facts get different shapes, not different colours

The pane has exactly two renderings for a number, and they share no geometry:

| | Counted fact | Reported claim |
| --- | --- | --- |
| Shape | a row of discrete segments, filled from the left | no track, no fill at all |
| Semantics | `role="progressbar"` with `aria-valuenow`/`aria-valuemax` | plain text, no ARIA value |
| Marker | — | a leading `≈` that is part of the value |
| Attribution | — | "Gemeldete Selbsteinschätzung von *Agent*" |
| Used for | `scope: own_task` **and** `basis: completed_steps`; completed plan steps of one revision | everything else |

The segments are the point. A counted quantity is drawn as something the reader
can literally count — ten segments for a percentage, one segment per step for a
plan revision — because the underlying thing *is* countable. A claim gets no
track, because there is nothing to measure it against; drawing an empty
remainder next to it would invent a scale that nobody reported.

Colour is not the carrier. The two forms differ in geometry, in ARIA role and in
wording, so the distinction survives greyscale, a colour vision deficiency and a
screenshot — the same rule `src/state/workStates.ts` already follows (ADR 0003).
The tests assert the separation structurally: segment counts, the absence of a
`progressbar` role on a claim, and the fact that neither element contains the
other.

**An orchestrator's overall estimate is always a claim, whatever basis it
names.** Even `scope: overall_estimate` with `basis: completed_steps` renders as
a claim, because nothing in v0 can count the steps of a whole run: the plans of a
run are themselves reports, subagents can be spawned at any moment, and no agent
knows what the others will still do. The `basis` field says how *that agent*
arrived at its number, not that the number is checkable. `scope: null` and
`basis: null` land in the claim form for the same reason — an unqualified
percentage is not a measurement.

The alternative — one bar, with the estimate drawn in a lighter shade — was
rejected. It reads as "the same quantity, less certain", which is precisely the
sentence the contract's two scopes exist to prevent. Aggregating the subagent
percentages into a run-level number was rejected for the same reason and one
more: it would be the cockpit's own progress claim, and the cockpit does not make
claims about agent work.

### There is no stall detection, and no clock is consulted

`lastEventAt` is rendered as a timestamp and compared against nothing. There is
no timeout, no "no events for n minutes", no inferred `blocked`, and no visual
decay of an old row. A run without `run.finished` is described as *"offen — kein
Terminalereignis gemeldet"*, which is a statement about the log, not about the
agent.

This is not caution, it is correctness. A long silence is indistinguishable from
deep work, from a slow tool call, from a paused sandbox and from a crash, and the
cockpit sees none of the four. A heuristic would therefore produce a verdict the
data does not support — and it would produce it exactly when the user is trying
to decide whether to intervene, which is the moment a wrong signal costs the
most. Judging whether work has run off the rails is the user's job by product
definition (#1).

Concretely, `src/components/workspace/runAgents/reporting.ts` contains no time
arithmetic at all, every "nothing was reported" case has its own explicit label
("kein Status gemeldet", "kein Abschluss gemeldet", "kein Ende gemeldet"), and a
test asserts that the rendered pane contains none of the derived-verdict
vocabulary.

### The tree is built on the client, and malformed edges are shown, not hidden

`GET /runs/{runId}/agents` answers flat and expresses the hierarchy only through
`parentAgentId`, so that the server never has to commit to a maximum spawn depth
(ADR 0005). `buildAgentTree` turns that into a tree in a single pass and is a
pure module with no React in it, so its rules are testable without rendering.

Because every agent has at most one parent, the relation is a functional graph:
each connected component contains at most one cycle. Walking upwards with an
explicit "currently on this path" mark therefore finds every cycle once, in
linear time, and the node the walk re-enters is the one whose upward edge is cut.
Three malformed shapes have a defined result:

| Input | Result |
| --- | --- |
| `parentAgentId` names an agent outside the run | the agent becomes a root, flagged `orphaned`, with a note naming the missing parent |
| the parent chain closes a cycle, self-parenting included | exactly one member is promoted to a root, flagged `cycle_broken`, with a note that the edge was cut |
| the same `agentId` appears twice | the first occurrence wins; the rest are reported in `duplicateAgentIds` |

No agent is ever dropped. Only the *edge* the data could not support disappears,
and the row says so — hiding a malformed node would hide the fact that the report
was malformed, which is information about the agent the user is watching. The
depth pass is iterative and guarded by a seen-set rather than recursive, so even
a wrong cycle analysis could not produce a stack overflow or an endless walk.

Rows are rendered as one flat list with an indent per level instead of nested
lists. A run with many spawns then scrolls as a single column rather than
drifting off the right edge of a 346 px pane, and collapsing a branch changes
which rows are produced rather than the DOM around them. Collapse state is keyed
by agent id in the persisted UI store, so a new subagent arriving live cannot
fold something the user had opened.

### Plan revisions are shown in full, never replaced

Every revision of every plan is rendered, ascending, with all of its steps.
Revisions are append-only by contract — a `plan.step_updated` only reaches the
revision that was current when it was reported — so an earlier revision keeps
exactly the states it was last seen with. Showing only `currentRevision` would
make a re-plan invisible, and a re-plan is one of the few moments where an agent
visibly changes its mind. Older revisions are receded but never collapsed away:
what changed between revision 1 and revision 2 has to be readable without an
interaction.

### A historical run is a different URL, announced before anything else

The current run is resolved through `/runs/current` rather than by scanning the
paged run list for `isCurrent`: the list is cursor-paged, so that scan would
silently stop working once the current run is not on the first page. The
contract's `404 current_run_not_found` is a state, not a failure, and resolves to
`null` and an empty state.

Selecting a historical run navigates to its own route. The pane then shows a
banner naming the current run and carrying the link back, and the "Aktueller
Run" marker disappears. Nothing merges: the agent tree, the plans and the run
state all come from the run in the URL, and a test asserts that no agent of the
current run appears while a historical one is open.

### Live events reach one node, and selection is not in the cache

The three queries of the pane are keyed per run through the central factory, so
`agent.progress_reported` invalidates `agents(project, run)` and nothing else —
the architecture and the plans are provably not refetched (asserted by counting
requests per path). Selection lives in component state and collapse state in the
UI store; neither is in the query cache, so a refetch cannot move either.

The one addition to the key factory is `currentRun(projectId)`, nested **below**
`runs(projectId)`. `run.finished` already invalidates that prefix, so closing a
run refreshes the current-run pointer without a new entry in the event →
query-key map — the map stays exactly as ADR 0003 defined it.

## Consequences

- A future "overall run progress" feature cannot be added by aggregating agent
  percentages without re-opening this decision. That is intended.
- `ProgressForm` is decided by `scope` **and** `basis` together, so an agent
  cannot obtain a meter by claiming `completed_steps` for the whole run. An agent
  that wants a meter has to scope its report to its own task, which is the honest
  claim.
- The pane will never tell a user that an agent is stuck. Users watching a run
  that genuinely died will see a timestamp that stops advancing and have to draw
  the conclusion themselves. This is the accepted cost of not producing false
  verdicts, and it is why the last reported timestamp is shown on every row
  rather than only on hover.
- `buildAgentTree` accepts input the API should never produce. That code is
  reachable only through a backend bug, and it exists because the alternative to
  a defined result is a hung tab in the one tool the user opened to find out what
  went wrong.
- Test data for the pane lives in `src/test/runFixtures.ts` and mirrors the
  simulator's `full` scenario — five agents three levels deep, both progress
  scopes, two plan revisions, no terminal event. Divergence between the two would
  make the test suite and the visual acceptance disagree.
