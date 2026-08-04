# 5. Read API shape, run scoping and cursor pagination

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #8 (part of the v0 epic #1)
- **Builds on:** [0002 — Event log with synchronous projections](./0002-event-log-with-synchronous-projections.md),
  [0003 — Frontend state split](./0003-frontend-state-split-and-live-updates.md)

## Context

The UI must be able to build the complete v0 state without ever querying the
event log, and it must be able to reconcile an HTTP snapshot against a live SSE
stream that keeps moving underneath it. Histories grow without bound, and a
single component can accumulate many diffs.

## Decision

**Every response carries `projectPosition`.** It is `projects.last_position` at
the time of the answer. The UI compares it against the SSE cursor and knows
exactly whether a snapshot is behind, level with, or ahead of the stream. This
is what makes the two transports reconcilable instead of merely coexisting.

**Read models only.** Every endpoint reads projections. The one exception is
component history, which reads the purpose-built `event_components` join table
rather than scanning `events` payloads — that table exists precisely so the
history is an index lookup.

**Current run and history are different endpoints, not a flag.** `runs/current`
resolves via `projects.current_run_id`. The component inspector answers for
exactly one run and never mixes evidence from another; the separate `/history`
endpoint is the cross-run view, ordered by descending project position with the
`runId` on every entry. Conflating them would make it impossible to tell whether
a diff belongs to what the agent is doing now or to something it did yesterday.

**`activeChanges` means planned, not "everything in flight".** A change that has
been applied is visible in the applied model itself; leaving it in the active
list too would double-count it. Planned changes never appear in `components` or
`relationships` — that separation is what the live overlays in #10 depend on.

**Cursors are opaque and versioned.** Base64url over a `v1|…` sort key. History
and diffs encode the project position. Runs order by `startedAt`, which is not
unique, so their cursor encodes the pair `(startedAt, runId)` and is compared
with a row-value predicate. Two runs starting in the same millisecond therefore
still page without a gap or a duplicate.

**Diffs paginate; the other collections do not.** Diffs are the one component
scoped collection that can grow without bound, so the inspector exposes
`diffLimit`/`diffCursor` and returns `nextDiffCursor`. Feedback, risks, problems
and active changes are bounded per component and run and come complete. A
separate diff endpoint was rejected because it would split the normal inspector
open into two round trips.

**Query count is fixed per request**, not proportional to the result: inspector
≤ 10, plans 5, architecture 4, runs 2. Component-scoped collections are loaded
through their join tables as subqueries, one statement per collection.

## Consequences

- Adding a projection means adding an endpoint or a field; the UI never gets to
  fall back on the event log, which keeps the log free to stay an audit source
  rather than a query surface.
- A run literally named `current` is unreachable through the alias. Accepted:
  run ids are agent-generated and the alias is worth more than that edge.
- Relationship proposals appear on the architecture endpoint but not in the
  component inspector, because filtering them per component would require
  searching the JSONB snapshot — exactly what the join tables exist to avoid.
- Timestamps are normalised to UTC in the API layer. Without it the rendered
  time zone depended on the server's, which is invisible until it is wrong.
- The contract gained `run_already_started` as the documented counterpart of
  `run_not_started`, so the ingestion layer's 422 vocabulary and the published
  contract agree.
