# 0035 — Project-scoped live sessions

Status: accepted for #94; extends 0006, 0010 and 0032.

SSE positions belong to a project. Keep each project's last processed position,
reception counters and change ledger in memory for the lifetime of the page.
Switching A → B → A opens B at the live tail on its first visit and resumes A
from A's own position. A's previously observed work and removal/change evidence
survives, then the gap replay extends it. Discarding the ledger while retaining
its cursor would silently lose evidence that replay can no longer reconstruct.

The connection badge describes only the active project. A run or saved-view
change within that project does not restart the stream. Departed or replaced
EventSources cannot publish queued callbacks; foreign project frames and already
processed positions do not change evidence, counters or query invalidations.
The ordered SSE stream is the source of event ordering, not cross-project maxima.

When a stream opens with no observed cursor, invalidate that project's read
queries after subscribing. This closes the GET-before-subscription gap and
refreshes a still-fresh cache on return to a project that never emitted a frame.
Read reconciliation does not fabricate event evidence or a replay position.

These stores are not persisted. Reload starts a fresh observation session at the
live tail and uses read models for explicit scope hydration. No historical events
are relabeled as newly observed on first visit. Keeping visited projects costs
memory proportional to the projects watched in one page session; existing
per-project history limits remain in place. Any future eviction must evict cursor
and ledger together and explicitly choose fresh observation semantics.

The query cache, camera, selection and other UI state retain their existing
ownership and are not reset by connection transitions. No API contract changes.
