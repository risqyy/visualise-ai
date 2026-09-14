# MCP domain tools

The `/mcp` Streamable HTTP endpoint exposes 14 implemented tools in source-built Compose from contract
2.0.0. The official SDK negotiates the transport independently of domain runs.
Use `tools/list` for precise schemas, descriptions and read/write annotations,
then `visualise_discover` for implemented names and limits. Four view tools and
`visualise_view_render` are included. A directly started backend without
`RENDER_ENTRY_URL` omits rendering and exposes 13 tools. Older released images
must not be presumed to contain the current source-built capabilities.

Official Go SDK **v1.7.0** and the checked TypeScript SDK **1.30.0** negotiate
stateful protocol **2025-11-25**; 2025-06-18, 2025-03-26 and 2024-11-05 are also
supported. SDK support for 2026-07-28 requires a different transport mode and is
not this endpoint's capability. Domain contract **2.0.0** is a separate version.
Use an image-capable client to inspect PNGs; text-only clients can read metadata.
No session ID represents a run.

## Client configuration

Use the exact published endpoint (default `http://localhost:8080/mcp`), transport
**Streamable HTTP**, no authentication headers, and an image-capable MCP client.
The executable client constructs `new StreamableHTTPClientTransport(new URL(endpoint))`
from the official SDK and connects with `Client.connect`; the SDK owns initialization,
session/version headers and `tools/list` validation. Do not handcraft session IDs.
Native clients can omit Origin; browser clients must match the configured exact
Origin. Host includes the externally published port. These allowlists are not
credentials. See [operations](operations.md#mcp-zugang-und-natives-rendern).

## A fresh client

1. Call `visualise_context_open` with `contractVersion: "2.0.0"`, a project ID,
   a run ID, your agent ID, `parentAgentId: null`, a fresh UUID `clientEventId`,
   UTC `occurredAt`, `role: "orchestrator"`, `displayName` and `assignedTask`.
   This explicitly creates the project/run/root if needed. A subagent opens its
   own context with `role: "subagent"` and its registered parent ID in that run.
2. Read `visualise_model_read` with contract version and project ID. Keep the
   returned `modelRevision`. Follow `nextCursor` for further pages; a model
   revision change returns `stale_cursor` and requires restarting pagination.
   `visualise_element_get` reads exactly one typed stable identity directly.
3. Call `visualise_model_mutate` with the same write identity fields, a **new**
   `clientEventId`, `expectedModelRevision` and typed operations. For example,
   add two components with IDs `service-aa` and `service-bb`, then a relationship
   with ID `calls-ab` and those endpoints in the **same** operations array.
   The change applies atomically. There is no approval tool or cockpit prompt.
4. Use `visualise_work_scope_set` to replace an agent's explicitly reported
   component/relationship ID arrays. Overlapping scopes are valid. Use
   `visualise_work_report` for `step_start`, `step_complete`, `status`, `progress`,
   `agent_finish` or root-only `run_finish`. No model edit implies code work,
   progress, completion or scope. Progress includes `scope` and `basis`; the
   published schema defines their existing explicit enums.
5. Read `visualise_context_read` using the **literal** run ID. The MCP string
   `current` is an ordinary run ID, not the legacy REST alias. Retain IDs for
   reconnecting. A dropped transport never closes a run or finishes an agent.

No MCP client needs to construct a REST envelope, schemaVersion or event type.
The checked examples in `api/examples/model-view-mcp/` show exact input shapes.

## Receipts, errors and limits

Every accepted write returns its original project/run/agent IDs, event IDs,
project position, model revision, nullable view revision, affected IDs and
received timestamp. Save the **complete input**, including its UUID. After an
uncertain response, resend exactly that input/key through MCP or its equivalent
REST command. The original receipt is returned with `duplicate: true`, even
after the run closes or later mutations advance the model. Altering expected
revision, reporter, timestamp or number token under the same key conflicts.

A revision conflict includes `currentModelRevision` and applicable
`currentViewRevision` for views. Read, reconcile intent,
and submit a revised command with a new key. Tool domain failures use
`isError: true`, structured `code`, `message`, RFC 6901 `fields` and applicable
revision/position metadata. Successful structured output is validated against
the generated output schema and is also returned as text. Unknown tools and
malformed protocol messages remain SDK protocol errors.

Requests and structured results are limited to 1 MiB. Mutation batches contain
1–100 operations. Collection pages default to 50 items and allow at most 200;
they stop earlier at the response budget and return a continuation cursor.
An individual oversized legacy element returns `response_too_large` with its
ID, avoiding empty-page loops. Signed cursors bind operation, project, literal
run and snapshot counter. Model pages bind model revision; context pages bind
project position; view pages also bind project position; project IDs bind a catalogue membership fingerprint. A server
restart invalidates its old cursors: restart pagination after `invalid_input`.
Targeted element reads query one descriptor; complete model page preparation
currently loads a consistent model snapshot in memory before bounded output.

## Common writes and frontend hydration

MCP writes call `ingest.Service.Submit`; REST and MCP share schema validation,
full command identity, lifecycle guards, the project append lock, projection,
receipt and post-commit SSE publication. `context.opened`, `work.reported` and
`work.scope_reported` each occupy **one** log position without advancing model
revision. Their projections reuse the existing explicit domain operations.

The existing REST run-agents response adds `modelRevision` and optional agent
fields `workScope`, `workScopePosition`, `missingScopeReferences`. These are read
with agents/head in one repeatable-read transaction and support browser reload
and reconnect hydration. Absent scope means no report; empty ID arrays mean an
explicit clear. Inspector responses that have not loaded scopes omit these
optional fields. Terminal agents retain their last scope; deleted IDs are
diagnosed, never removed from the report or inferred as new work. MCP wraps the
same snapshot in its explicit scope/null result shape. Existence lookups
deduplicate overlapping scopes and execute bounded SQL batches.

Step ownership is enforced across typed MCP and legacy REST, including effective
legacy corrections. A fresh key cannot overwrite a step or complete another
agent's step. Same-owner metadata corrections remain accepted after completion
and run closure; corrected starts must retain their original component set.
Legacy starts may still reference planned IDs, as the existing simulator does;
new typed starts require materialized IDs. Neither reserves model identities.

Step-component associations now include run ID. Migration reconstructs each
run's associations from accepted start events and effective corrections, rather
than copying a project's old union into every run. Unattributable legacy links
remain under an empty run ID as preserved evidence. The migration is repeatable.

The frontend uses one project stream for atomic canvas changes, scope
contributions, localized history and view invalidation. Inspector/history and
model identities remain shared; saved views filter the native drawing.

## Validation

`api: npm test` checks generated REST/MCP schema drift and examples.
`frontend: npm run typecheck`, `npm run check:contract`, and `npm test` check the
generated client and existing UI integration. Backend `go test -count=1 -p 1 ./...`
requires `TEST_DATABASE_URL` for real PostgreSQL acceptance; skipped DB tests
are not evidence. `go build ./...` and `go vet ./...` are additional checks.

Set `TEST_MCP_ENDPOINT=http://localhost:<published-port>/mcp` and run
`go test -count=1 -run TestPublished ./internal/mcptransport ./internal/mcptools`
to verify the built Compose/Nginx entry with the official SDK, REST hydration,
SSE transport replay, reconnect/retry, model conflicts and explicit lifecycle.

## Saved views and exact native feedback

`visualise_views_list`, `visualise_view_get`, `visualise_view_put` and
`visualise_view_remove` manage project-owned references, never model copies.
Put requires exact model/view revisions (view revision zero creates); remove
requires the view revision. View changes advance project position and view
revision, not model revision. Removed view IDs remain reserved. Explicit edges
require both explicitly selected endpoints; ancestors add only structure.
Missing or retargeted references remain diagnosed.

Render requires both exact revisions, width 320–3840, height 240–2160, pixel
ratio 1 or 2 and detail `map`, `readable`, `standard` or `full`. A current
immutable snapshot goes through the native frontend pipeline. Later writes
cannot change the capture; historical revision rendering is not provided.
There are two slots, no queue and a 30-second deadline including capture/startup.
Excess capacity returns `render_failed`; deadline expiry returns `render_timeout`;
explicit cancellation releases the browser job.

Success contains one `image/png` image block (at most 4 MiB decoded), matching
metadata and text (at most 1 MiB structured). Metadata identifies both revisions,
project position, byte length, missing/boundary references and actually painted
original IDs. `clipped` means content is outside the readable viewport or an ID
list exceeded 200 entries; overflow returns the first 200 sorted IDs. Complete
coverage requires `clipped: false`. The server does not judge image quality,
change user camera/selection or claim code changed. The agent reads the PNG,
issues a targeted model correction using a new key/revision and renders again.
Only native architecture views are implemented; other diagram families remain
outside this capability. No UML or PlantUML parity is claimed.

Advertised `outputSchema` accepts success **or** the frozen structured Error
schema because the official TypeScript SDK also validates structured errors.
Success validation remains strict; domain failures retain `isError: true`.
HTTP/JSON-RPC errors remain distinct from domain errors.

REST lists at `/api/v1/projects/{projectId}/views`; its opaque-ID-safe getter is
`/api/v1/projects/{projectId}/view?viewId=<URL-encoded ID>`, not `/views/{viewId}`.
The UI uses `?view=…`; omission selects the compatible complete overview, not a
persisted renderable view. Unknown/removed saved views show unavailable state.
Camera, drag positions, selection, orientation override and disclosure are local
per view within the tab, not domain writes or cross-browser persisted settings.
URL selection remains authoritative on reload; Inspector/history stay global.

## Executable client

Start source-built Compose, then use Node with the E2E lockfile dependencies:

```bash
npm --prefix e2e ci
MCP_URL=http://localhost:8080/mcp node e2e/examples/native-feedback.mjs
```

PowerShell uses the same checked program:

```powershell
npm --prefix e2e ci
$env:MCP_URL='http://localhost:8080/mcp'
node e2e/examples/native-feedback.mjs
```

The checked example opens a uniquely named project/run, creates a model and
saved view, reads exact revisions, writes a PNG, corrects one model label,
writes another PNG and explicitly closes the run. Outputs are retained under
ignored `e2e/test-results/client-example/<unique-project>` as `before.png`,
`after.png` and their `.png.json` metadata. `MCP_OUTPUT_DIR` sets the complete output
directory; stdout contains one JSON summary with project/run IDs and exact metadata. See the
[acceptance matrix](epic-75-acceptance.md) for fault injection, concurrency,
browser replay, measurement conditions and coverage limits.
