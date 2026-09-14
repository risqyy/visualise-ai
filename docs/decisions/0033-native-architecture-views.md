# 0033 — Native architecture views over one shared model

Status: accepted for local implementation of #82; follows 0029–0032.

A saved architecture view stores a selection and presentation defaults, never
copies of model descriptors. Its opaque `viewId` belongs to one project. The
implicit complete overview remains the workspace default and has no persisted
view revision. Additional diagram families are outside this decision.

View writes use the existing ingest command transaction, identity/retry rules,
run and agent lifecycle, event projector and post-commit publication. Saving
checks both model and view revisions; removing checks only the view revision.
The model revision does not advance for either operation. Removed IDs remain
reserved permanently. Exact integer JSON spellings are accepted using the same
bounded parser as model mutations, while original payload spelling remains part
of command identity. Failed validation/CAS never reserves an ID or emits an event.

Reads capture model, view and project positions in a repeatable-read transaction.
`CaptureViewSnapshot` checks both requested revisions in that same transaction
and returns detached descriptors for native rendering. Backend and frontend
resolution share fixtures: explicit relationships need explicitly selected
endpoints; ancestors provide structural context only. Missing references and
retargeted edges outside the boundary are diagnosed without inventing elements.
Cycles terminate deterministically. Generic frontend resolution preserves the
original descriptor objects, including only provenance actually present.

The saved view getter uses a fixed `/projects/{projectId}/view?viewId=...` route.
An opaque ID can contain slashes, percent signs or dot segments; browser path
normalization makes a path-only getter insufficient. List cursors encode the
last view ID independently and bind pagination to the captured project position.
REST and MCP use the same store/service semantics and generated wire contract.

The existing React Flow/ELK canvas consumes the resolved native model. Drawable
proposals and ghosts obey the same selection boundary; shared Inspector,
history and work evidence remain attached to global project element IDs.
Relationship presentation/actions use an explicit context, allowing the native
renderer to supply inert selection/expansion without importing workspace state.

Local camera, drag positions, disclosure, expanded bundles, remembered selection
and orientation overrides are keyed by `(projectId, implicit | saved viewId)`,
not view revision. They survive view switches and temporary empty scopes within
the loaded app. Explicit URL selection/orientation takes precedence even when
only the project/view identity changes. Saved defaults apply when no local
override exists. A page reload keeps the URL context and reapplies saved defaults;
transient cameras and manual geometry are not persisted. Late callbacks from an
unmounted canvas cannot overwrite the next view's camera. Missing/removed views
show an unavailable state and let the user choose the implicit overview without
claiming a persisted fallback revision.

Validation covers actual PostgreSQL CAS, retry, rollback, tombstones and snapshot
concurrency; shared resolver fixtures; routed local-state and live empty-scope
regressions; locale/accessibility suites; and the official MCP SDK with Chromium
against freshly built Compose/Nginx, including opaque ID reloads and shared
identity/history across two native views.
