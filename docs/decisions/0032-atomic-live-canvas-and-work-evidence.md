# 0032 — Atomic live Canvas and explicit work evidence

Status: accepted for local implementation of #80; follows 0029–0031.

The existing SSE/query/ledger path handles MCP changes. One mutation event folds
every operation before advancing its deduplication position. No planning or
approval state is introduced. Model changes remain distinct from explicit work
steps and scopes, and are never evidence that repository code changed.

The current architecture GET remains authoritative. A direct-change overlay
waits until that snapshot covers its event position. During replay, an old
applied add/update cannot resurrect an identity absent from a newer snapshot.
The ledger captures descriptors only from an observed preceding snapshot or
accepted events. Partial updates preserve known fields and clear explicit nulls;
an ID-only removal with no observed descriptor remains Inspector evidence and
does not borrow a pending proposal's descriptor to invent a ghost.

ELK owns geometry, not model inventory. While an asynchronous solve is pending
or fails, the displayed graph uses the complete current projection, with prior
positions for unchanged parentage and deterministic provisional positions for
new/reparented nodes. Removed nodes disappear immediately unless actual removal
evidence draws a ghost. Current edges always have current endpoint nodes; old
routes are disabled until the new solve lands. Local drag positions, disclosure,
selection and camera stay in their existing UI stores. This pure reconciliation
boundary remains reusable by the native headless renderer.

Work scopes are keyed by (run, agent), work steps by (run, step). The existing
run-agents and run queries hydrate scope and lifecycle state after reload. A
newer live report wins over stale hydration. Finishing an agent/run or reporting
status done suppresses active highlighting but preserves the last report and
does not invent step completion. A later valid working status can reactivate
the uncompleted step/scope. Only explicit step completion removes an open step.
Missing scope IDs stay inspectable without inventing graph elements. Model
changes invalidate per-run hydration across the project; scope reports also
invalidate component context/history.

The Inspector lists separate model/work contributions with run and agent IDs,
including overlaps and terminal scope evidence. Existing history remains the
durable source. Recent overlays cover the newest eight applied event positions;
the local history retains at most 200 operations, dropping whole older events.
A fresh connection starts at the live tail, so a reload does not claim to have
observed past recent changes. Reconnect replays the gap idempotently. No timer
changes work state or recent overlays.

Validation includes maximum-size batches, unknown descriptors, stale snapshot
replay, repeated step IDs across runs, scope overlaps/clear/terminal/resumed
status, prototype-named IDs, and delayed/rejected ELK solves. Browser acceptance
uses the official MCP TypeScript SDK (pinned 1.30.0) against built Compose/Nginx,
with real Chromium selection, camera movement, offline replay, reload hydration,
selected removal and history fallback. Existing REST acceptance remains intact.
