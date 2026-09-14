# MCP domain tools

The `/mcp` Streamable HTTP endpoint exposes nine implemented tools from contract
2.0.0. The official SDK negotiates the transport independently of domain runs.
Use `tools/list` for precise schemas, descriptions and read/write annotations,
then `visualise_discover` for implemented names and limits. Views and rendering
are separate follow-up issues and are not advertised yet.

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

A revision conflict includes `currentModelRevision`. Read, reconcile intent,
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
project position; project IDs bind a catalogue membership fingerprint. A server
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

The frontend in this issue registers the generated events, localized history
labels and cache invalidation. Canvas scope rendering/interaction belongs to #80.

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
