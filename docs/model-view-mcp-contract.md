# Model, view and MCP implementation contract

This is the accepted #76 specification implemented by the current source-built
server. [Current usage](mcp-domain-tools.md) and [local acceptance](epic-75-acceptance.md)
describe deployment and measured evidence. See [ADR 0029](decisions/0029-model-view-and-mcp-contract.md). Structural
definitions and exact tool names live in
[`api/model-view-mcp.schema.yaml`](../api/model-view-mcp.schema.yaml) and
[`api/model-view-mcp.tools.yaml`](../api/model-view-mcp.tools.yaml). Checked
request/result and rejection examples live in
[`api/examples/model-view-mcp/cases.json`](../api/examples/model-view-mcp/cases.json).
The [complete sequence](../api/examples/model-view-mcp/README.md) demonstrates
creation, partial change, concurrency conflict, lost-response retry and atomic
removal of a node with its affected relationship.

## Identity and ownership

`projectId`, `runId`, `agentId`, `componentId` and `relationshipId` reuse their
existing OpenAPI formats. The actual component pattern allows two characters;
it is not the three-character project/run/agent slug pattern. Component IDs are
opaque identities; dotted names imply no containment. `parentComponentId` alone
defines the hierarchy. Rename changes `name`, never an ID. Relationship identity
survives relabeling and endpoint changes. Parallel edges and self-edges are
legal; each edge has its own ID and is never collapsed in storage.

Components, relationships and views are project-owned. Reusing their IDs in
another project is independent. The same IDs occur in different views and runs
without making copies. IDs of removed objects are reserved in that project:
`add` cannot resurrect an identity as a different object. Migration must reserve
IDs actually materialized by snapshots, applied changes or effective model
corrections, as well as the current projection. Planned-only IDs are not reserved
and can be added for the first time. Historical evidence
continues to reference the original identity. Runs are project-scoped; agents
and explicit work scopes are run-scoped. There is no cross-project reference.

A model read returns the native component/relationship descriptors plus
`modelRevision` and `projectPosition`. A saved view contains `viewId`, `name`,
`kind: architecture`, an explicit selection of model IDs (or `all`), orientation
and collapsed component IDs. It has its own `viewRevision`. It stores no copies
of names, technology or relationships. `all` selects the current complete graph;
an explicit selection selects exactly its component IDs and relationship IDs.
Selected relationships must have both endpoints in the selection. Ancestors of
selected components are included as structural context, not as inferred work.
Ancestors included only for context do not pull in siblings or additional edges.
Collapsed ancestors hide descendants and their edges using the existing native
projection/bundling rules; aggregate edges remain traceable to original IDs.

Model removal does not rewrite every saved view. View resolution omits missing
references and returns them as `missingReferences`; it must never resurrect a
removed model element. New/updated view definitions must reference existing
objects at the supplied model revision. Removing a view leaves model and work
history intact. Browser camera, selection, temporary drag positions and current
disclosure are local per view, not commands. Saved collapsed IDs are defaults;
switching views and live updates preserve each view's local state where valid.
If a selected relationship is retargeted outside the selected component set,
omit it and report its ID in `boundaryRelationshipIds`, even though all IDs still
exist. Never silently add its new endpoint to the view. The interactive canvas
and renderer use this same resolution rule. Collapsed defaults must be members
of the selected components or their included ancestors.

## Commands, revisions and replay

All new write inputs include `contractVersion: "2.0.0"`, project/run/agent IDs,
explicit nullable `parentAgentId`, `clientEventId` UUID and UTC `occurredAt`.
Model commands additionally require `expectedModelRevision`; view put/remove
requires `expectedViewRevision` (zero means create) and view put requires
`expectedModelRevision` to validate its references. A nonexistent view cannot be
removed and removed view IDs cannot be reused. Reads of an empty known project
return revision zero; unknown projects produce `project_not_found`.

`visualise_model_mutate` contains 1–100 operations, with each typed target ID
occurring at most once. The closed operations are `component.add`,
`component.update`, `component.remove`, `relationship.add`,
`relationship.update`, `relationship.remove`. Add takes a complete descriptor;
update takes a nonempty typed `set` object. Omitted fields remain unchanged;
arrays replace the complete array. Null clears optional metadata; only
`parentComponentId: null` means a root. Name, kind and edge endpoints cannot be
cleared. IDs are immutable and cannot appear in `set`. Remove takes only an ID.
There is no implicit upsert, whole-graph replacement or generic JSON path patch.

For a new request, under the project row lock:

1. Look up `(projectId, clientEventId)` across all write operations. For new
   contract commands compare the operation name and the entire validated input,
   including version, reporter, timestamp, expected revisions and ordered ops.
   Sort object keys recursively and ignore insignificant JSON whitespace; array
   order, omitted versus null fields and number token spelling remain meaningful,
   matching the existing Go canonicalizer. No server-generated values participate.
2. An exact retry returns the original receipt (`duplicate: true`) without
   checking today's revision or lifecycle. A changed request under that key
   yields `client_event_id_conflict`, even when only reporter or expected revision
   differs. A key accepted by the legacy path cannot be reused for a new command.
3. Validate the reporter/lifecycle, then compare expected revisions. Mismatch is
   `revision_conflict` with current revision values; nothing is written. The
   client reads, reconciles its intent and uses a new key for a revised command.
4. Apply the operations to a candidate model. Adds require a never-used ID;
   updates/removes require a currently existing ID. Validate the final graph,
   not each intermediate step: parents and endpoints exist, parent hierarchy is
   acyclic, all IDs are unique. Removing a component requires explicit removal
   or retargeting of all incident relationships and explicit removal/reparenting
   of children in the same batch. No cascade is inferred.
5. Append exactly one `model.mutation_applied` event containing the command,
   advance `modelRevision` once and `projectPosition` once, update all projections,
   reserve new IDs and save the original receipt in the same transaction. Even a
   valid update setting an existing value consumes one revision; there is no
   ambiguous successful no-op. Any failure rolls everything back, including IDs,
   receipts and both counters. Publish one SSE event only after commit.

The equivalent new REST envelope uses `schemaVersion: "2.0"`,
`type: model.mutation_applied`, normal existing envelope identity fields, and
`payload: { expectedModelRevision, operations }`. The MCP service translates its
input to this domain command, preserving every field. Its replay identity is the
canonical domain command (operation name is fixed by event type), so the same
command retried through REST or MCP resolves to the same receipt. The adapter-only
`contractVersion: "2.0.0"` selects that mapping and is recorded in command identity;
other versions are rejected before lookup. #77 adds this branch to the generated
OpenAPI union without changing legacy branches. The same mapping applies to
`view.saved`, `view.removed`, `work.scope_reported`, `context.opened` and
`work.reported` for their corresponding tool inputs; their payload is the
non-envelope command fields, all with event `schemaVersion: "2.0"`. The closed
`CommandEvent` schema supplies every concrete branch. Lifecycle/report projection
reuses existing domain services, not secondary events: each accepted command
occupies one log position. Existing 1.0 reports keep legacy retry comparison;
typed MCP reports use the stronger new-command comparison.

A receipt returns `clientEventId`, `serverEventId`, committed `projectPosition`,
resulting `modelRevision`, nullable resulting `viewRevision`, `receivedAt` and
`duplicate`, project/run/agent ownership and `affected` component/relationship
IDs. Affected IDs are sorted and unique: mutation targets including removals,
scope targets for a scope report, component IDs for step start/completion, and
empty arrays for context/view/other work reports.
A replay returns these original counter values, even after later
writes. They describe this command, not a fresh read of the current head.
Model-neutral events (including scope and view changes) do not advance the model
revision. A successful view put/remove advances that view's revision once and
the project position once; removed views retain tombstone revision metadata.

## Lifecycle and explicit work

Opening an MCP session authenticates/connects a client; it does not create a
project, run, agent, work step or status. `visualise_context_open` takes ordinary
project/run/agent/request IDs, role, display name and task. A root orchestrator
with null parent opens a run (and creates the project if needed); a subagent with
a parent joins an already opened run. The server applies `agent.started` domain
semantics internally. A fresh MCP client never needs to construct an event
envelope, event type or payload version.

`visualise_work_report` takes identity fields and a typed `report`: `step_start`
(step ID/title/explicit component IDs, which may be empty), `step_complete`
(step ID/summary), `status` (status/note), `progress` (percent/scope/basis and
optional note), `agent_finish` or `run_finish` (outcome/summary).
These map internally to existing explicit work/lifecycle semantics. Step IDs are
owned by the reporting agent within a run: completion requires that reporter's
started, not-yet-completed step; duplicate starts under new keys are rejected.
Step component IDs must exist when started; completion returns those originally
reported IDs, even if subsequently removed. They are not inferred from current
scope. Progress scope and basis use the existing explicit enums; the server does
not invent an estimate or derive a percentage from activity.
Changing scope is the separate explicit scope tool. Richer existing events such
as plans, feedback, diffs and corrections remain available over REST; MCP does
not expose a generic low-level event-ingestion escape hatch.

The root orchestrator's `agent.started` opens a run. A subagent must start itself
with a known parent in that run before reporting. Each run has one immutable
root, each agent one immutable parent; reject attempts to reparent/restart a
registered agent under a fresh key. Only that root may finish the run. Commands
require an open run and registered reporter; terminal agent outcomes do not
infer a terminal run. There is no timeout, stall detection, connection-based
status or fabricated progress. Existing post-run correction/retraction behavior
remains available; direct model/view/scope commands on closed runs fail.
Validate the effective event of a legacy correction against the same lifecycle,
ownership and graph invariants before projecting it. A corrected `agent.started`
cannot reparent an agent or replace the root, and a corrected `run.finished`
cannot authorize a non-root closer. Correction/retraction eligibility after run
closure is preserved, but it is not permission to reopen a run or bypass these
invariants. Previously accepted invalid corrections are not rewritten.

`visualise_work_scope_set` explicitly replaces the reporting agent's current
component/relationship scope with two bounded ID arrays. Empty arrays explicitly
clear it. Targets must exist when reported. Different agents may work on the
same IDs; scopes do not lock the graph. `visualise_context_read` reads the scopes
of the requested run only, together with explicitly reported agent status.
Scope IDs removed later remain reported references and are listed as missing in
context responses. Ending a run/agent does not invent a scope-cleared event:
retain the last scope with its reported lifecycle state. UI active highlighting
may suppress terminal scopes, while history retains them. A model mutation does
not create work scope, complete a work step or imply repository code changed.

## MCP operations and error surface

The catalogue defines all exact input/result schema references. Common errors
below apply to every tool; the final column calls out additional constraints.
Tools are advertised only when implemented and enabled. Discovery is a bounded
capability result, not the domain run lifecycle. MCP `tools/list` schemas and
`tools/call` arguments/results are derived from the catalogue.

| Tool | Input / successful result | Additional failures |
| --- | --- | --- |
| `visualise_discover` | Empty input → contract version, available tool names, limits, native view kinds | `unsupported_contract_version` on versioned calls |
| `visualise_projects_list` | limit/cursor → project ID summaries + next cursor | `stale_cursor` |
| `visualise_model_read` | project, optional expected revision, page → typed elements, missing references, counters | `revision_conflict`, `stale_cursor` |
| `visualise_element_get` | project, typed ID, optional revision → one model element + counters | `element_not_found` |
| `visualise_context_read` | project, explicit run, page → agents, reported scopes and counters | `run_not_found`, `stale_cursor` |
| `visualise_context_open` | Write identity + role/name/task → receipt; explicitly opens or joins domain run | Lifecycle/parent/root errors |
| `visualise_work_report` | Write identity + typed report action → receipt | Lifecycle errors, `work_step_not_started`, `work_step_already_started` |
| `visualise_work_scope_set` | Write identity + explicit ID arrays → receipt | `reference_invalid`, lifecycle errors |
| `visualise_model_mutate` | Write identity + expected model revision + operations → receipt | `revision_conflict`, `element_exists`, `element_not_found`, `reference_invalid` |
| `visualise_views_list` | project, page → view summaries + counters | `stale_cursor` |
| `visualise_view_get` | project, view ID → saved definition, revision, missing references | `view_not_found` |
| `visualise_view_put` | Write identity + expected model/view revisions + complete definition → receipt | `revision_conflict`, `reference_invalid`, `element_exists` for reserved ID |
| `visualise_view_remove` | Write identity + expected view revision + view ID → receipt | `revision_conflict`, `view_not_found` |
| `visualise_view_render` | project, view ID, exact model/view revisions, viewport/detail level → image + exact revision metadata | `revision_conflict`, `view_not_found`, `render_failed`, `render_timeout`, `cancelled`, `response_too_large` |

Tool domain errors use `isError: true` and structured `Error` data; the textual
content describes the same error. Successful structured output matches the
catalogue's output schema (also rendered as text for clients needing it). MCP
protocol errors such as malformed JSON-RPC, unknown tool or invalid protocol
arguments remain protocol errors; do not forge a domain receipt. Existing REST
uses RFC 9457 and the same domain `code`. All tools can return `invalid_input`,
`project_not_found`, `internal_error` and `response_too_large`. New writes can
return `client_event_id_conflict`, `run_not_started`, `run_already_finished`,
`unknown_agent`, `parent_agent_unknown`, `agent_already_started`,
`run_already_started` or `terminal_event_not_allowed`. Legacy report validation
also preserves `correction_target_unknown`. Error fields contain RFC 6901
pointers and a concrete message; errors never carry partially accepted results.

## Bounded, consistent reads and rendering

All collection tools use `limit` (default 50, range 1–200) and an opaque cursor
(maximum 2048 characters). Order project IDs lexically, model elements by
`(type, id)`, views by ID, and context agents by agent ID. Cursor binds project,
operation, filters, last key and snapshot counter(s). Read head and projections
in one database snapshot transaction. Model pages bind `modelRevision`; context
and view pages bind `projectPosition` as those resources can change without a
model mutation. If the bound counter changed, reject with `stale_cursor` rather
than silently mixing versions. A supplied expected revision mismatch produces
`revision_conflict`; a client may restart pagination after reconciliation.
Project enumeration binds a catalogue fingerprint and returns `stale_cursor`
if membership changes; it returns IDs only so unrelated project activity cannot
invalidate it. No arbitrary SQL, remote URLs, repository file access or raw-log
dump is exposed.

Requests are at most 1 MiB, structured responses at most 1 MiB, and render images
at most 4 MiB decoded. This supplements schema array/string bounds, including
legacy descriptor fields that were previously unbounded. Reject oversize writes
before starting a transaction. Page responses stop before the response budget
and return a continuation cursor; a single element exceeding the budget returns
`response_too_large` with its ID so the caller does not loop on an empty page.
Limits are advertised by discovery and may not be silently increased per tool.

Render input requires both exact revisions, width 320–3840, height 240–2160,
pixel ratio 1 or 2 and native detail level (`map`, `readable`, `standard`, `full`).
The chosen level controls native visibility rules; it does not add diagram semantics.
#81 uses a headless browser executing the same native
frontend graph projection, layout, styling and saved-view resolution as the
interactive canvas, after fonts/layout settle. It renders a server-provided,
immutable snapshot, not an unversioned fetch of the live canvas. If either
requested revision is unavailable, fail rather than substitute latest. The
minimal implementation need only render the current exact snapshot; historical
rendering is not promised. Later writes during rendering cannot change the
captured snapshot. The result includes project/view IDs, model/view revisions,
snapshot project position, `renderedAt`, viewport and missing-reference diagnostics.
It also returns detail level, boundary relationship IDs, explicit visible model
IDs and `clipped` (true if any selected visible content is outside the viewport
or if the visible-ID metadata exceeds 200 IDs per kind). Listed IDs identify the
elements actually painted, including the original IDs represented by bundles;
overflow lists contain the first 200 sorted IDs. A complete assertion about
coverage requires `clipped: false`. Render uses the native readable-entry camera
policy, so an oversized graph may be clipped rather than made illegible.
The PNG is an MCP image content block; structured result metadata contains its
MIME type and byte length, not an arbitrary download URL. One image block must
correspond to the one metadata result. Local user selection/camera is not
captured or changed. Unsupported view families return `invalid_input`.
Rendering has a 30-second server deadline from dispatch, a maximum of two
concurrent renders per backend and no unbounded queue. Reject excess capacity
with `render_failed`; report deadline expiry as `render_timeout`. MCP request
cancellation terminates the browser job and releases resources; a cancellation
before dispatch produces `cancelled`. A render never writes model/work/view
state or emits synthetic activity.

## Existing data and REST compatibility

Historical planning baseline: code inspection at `53f9a84` found the behavior
below. The required integrations are now implemented; this table preserves the
original comparison, not a list of outstanding work.

| Current behavior | Required integration / example |
| --- | --- |
| Store locks a project row, resolves retries before guard, appends and projects atomically | Reuse this transaction. Add counters, full new-command identity and receipt persistence; preserve the legacy comparator |
| Snapshot deletes and replaces components/relationships | A valid legacy snapshot still replaces the graph and advances revision once; subsequent MCP command expecting the old revision conflicts |
| Applied component removal does not delete incident relationships | Future legacy remove of a connected node fails `reference_invalid`; send a valid replacement snapshot or use an atomic batch removing edges explicitly |
| Legacy writes have no expected revision | Continue accepting valid writes, documenting their unconditional semantics. They serialize with MCP and advance model revision; they cannot detect stale legacy intent |
| Lifecycle checks do not validate graph references or immutable agent parentage | Shared command guards enforce these requirements for future REST and MCP writes; preserve old events, document newly rejected inputs |
| Corrections/retractions can run after closure and may affect model projection | If their effective projection modifies the graph, validate it and advance model revision exactly once; purely evidentiary correction does not advance it |
| Read head and projection use separate statements | #77 supplies snapshot-consistent reads before exposing revision guarantees |
| Frontend listens to a closed list of event types | Register new generated event schemas/types and targeted invalidation in #80; one mutation produces one coherent UI refresh |
| Migrations use `AutoMigrate`; no general log replay engine exists | Add an explicit, repeatable migration; do not claim replay support merely because the log exists |

Migration baseline: existing projects receive `modelRevision: 0`; new revision
tracking starts at activation, with the pre-existing graph as that revision's
snapshot. Preserve `projectPosition` unchanged. Record the activation position
per project so historical pre-migration events cannot be mistaken for revisioned
snapshots. Build identity reservations from current graph and historically
materialized model descriptors (not unapplied proposals); ambiguous historic
reuse is recorded as a diagnostic. A planned-only ID can be added for the first
time after migration. A retired ID cannot be revived by a new snapshot, legacy
full-descriptor upsert or effective correction; those writes fail `element_exists`.
An ID still live may appear in a replacement snapshot and retains its identity.
Repair requiring a retired object uses a fresh ID and explicit reference updates,
without rewriting historical references. Current retraction handling changes
proposal/evidence projections and does not revert the graph, so those retractions
do not advance model revision. Old data must
remain readable, including graph-integrity diagnostics. New model writes must
produce a valid complete final graph. Thus a legacy dangling edge is visible in
reads, a rename that leaves it dangling is rejected, and a batch deleting the
dangling edge and applying the rename succeeds. A valid complete replacement
snapshot is also a repair path. No silent cascade, guessed parent or automatic
identity remapping is allowed. #77 must test these migration examples against
PostgreSQL with `TEST_DATABASE_URL` set; skipped database tests are not evidence.

## Diagram coverage and delivery matrix

Additional diagram families below are exploration entries, **not promised
capabilities or an inferred implementation order**. Their priority is **OPEN**.

| Family | Native model today / gap | This epic | Priority beyond epic |
| --- | --- | --- | --- |
| Architecture component/dependency/data-flow views | Typed components, hierarchy and directed relationships | Shared model, multiple native filtered views; #82 | In scope |
| C4-style context/container/component perspectives | Existing hierarchy can support manually selected architecture views; no formal C4 semantics | Native selections only; do not label as C4 conformance | OPEN |
| UML class/object | No attributes, methods, multiplicity or object instances | Not implemented | OPEN |
| UML sequence/communication | No ordered messages, lifelines or time semantics | Not implemented | OPEN |
| UML state machine | No states, transition guards or entry/exit actions | Not implemented | OPEN |
| Activity/BPMN | No control-flow tokens, gateways, swimlanes or execution semantics | Not implemented | OPEN |
| Deployment | No deployment-node/runtime-instance/environment mapping | Not implemented | OPEN |
| Entity relationship/data schema | Datastore component exists; no entities, keys or cardinality | Not implemented | OPEN |
| Use case / requirements / traceability | No actors/use-case semantics or requirement graph | Not implemented | OPEN |

| Issue | Owns / acceptance evidence |
| --- | --- |
| #76 | This ADR, structural schemas, operation catalogue, validated examples and negative fixtures; no runtime claim |
| #77 | Shared command/store transaction, revisions, replay, reference guards, migration and consistent reads; database race/rollback/retry tests |
| #78 | Official Go MCP SDK, pinned versions, transport/auth/proxy/discovery lifecycle; protocol tests independently of domain runs |
| #79 | Catalogue adapters for discovery/read/model/work tools with common errors and bounded outputs; actual MCP client tests |
| #80 | Closed event registration, atomic live canvas updates, reported work scopes, localization and accessible stable interaction |
| #81 | Native frontend renderer and exact model/view revision image feedback; actual image/revision checks |
| #82 | Saved view persistence, shared references, local state per view and view tools; common view schema fixed here |
| #83 | Compose/proxy end-to-end flow including conflict/retry, concurrent scopes, SSE reconnect, views and render; integration docs |

Historical delivery sequencing (the integrated endpoint now uses persisted views
and advertises all 14 tools in source-built Compose):

#81 and #82 share the view schema and resolution rules above. #81 may test a
fixture view through the same resolver while #82 implements persistence; the
integrated render endpoint must accept only real persisted views. #78 can ship
an empty tool registry until #79; it must not advertise unimplemented tools.
