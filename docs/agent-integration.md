# Agent integration

For authors of agents that report to the cockpit. Everything described here can
be implemented using only [`api/openapi.yaml`](../api/openapi.yaml). This guide
explains the rules that are not apparent from the schema alone and the mistakes
that commonly arise during integration.

Agents can use the official Streamable HTTP SDK at `<base>/mcp` to read, write
atomically, save views, and retrieve native PNGs. The
[MCP guide](mcp-domain-tools.md) includes client configuration and a runnable
workflow. Existing integrations continue to use `POST <base>/api/v1/events`;
both routes share transactions, lifecycle rules, and idempotency. Clients do not
access the database or internal ports.

## Four ground rules

1. **One REST request, one event.** A model command contains 1–100 atomic operations, but only one envelope.
2. **`Content-Type: application/json`** is required; otherwise the response is `415`.
3. **The catalog is closed.** There are 20 legacy types and six new command types,
   with no free-form fallback.
4. **State is reported, never inferred.** Anything the agent does not send does
   not exist for the cockpit.

## The envelope

Every event uses the same envelope; only `payload` depends on `type`. Unknown
fields are forbidden at every level (`additionalProperties: false`).

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion` | Yes | `"1.0"` for legacy events, `"2.0"` for the six command types |
| `clientEventId` | Yes | UUID assigned by the agent. The idempotency key — see [Idempotency](#idempotency-and-retries) |
| `projectId` | Yes | Project slug |
| `runId` | Yes | Run slug |
| `agentId` | Yes | The **reporting** agent |
| `parentAgentId` | Optional for legacy events; required for commands | The delegating agent; `null` or omitted for the root orchestrator. Belongs in **every** event from a subagent, not just its `agent.started` |
| `occurredAt` | Yes | RFC 3339 timestamp in UTC (`Z` suffix), from the agent's perspective. Independent of the server-side `receivedAt` |
| `type` | Yes | One of the 26 catalog types |
| `payload` | Yes | Object determined by `type` |

### Two different ID formats — a common pitfall

`projectId`, `runId`, and `agentId` use lowercase letters, digits, and hyphens,
with at least three characters and an alphanumeric first and last character.
`componentId` also allows `.` and `_` and can be as short as two characters;
dots do not imply hierarchy. Only `parentComponentId` defines the hierarchy.
`MyAgent` and `agent_1` are not valid agent IDs.

`feedbackId`, `diffId`, `planId`, `workStepId`, `relationshipId`, `changeId`,
`snapshotId`, and `viewId` are unrestricted `Identifier` values: 1 to 128 arbitrary
characters. For views, REST therefore uses the fixed query route
`/api/v1/projects/{projectId}/view?viewId=…`; the list path is `/views`.
A path segment would not reliably handle IDs such as `/`, `.`, or `..`.

## Lifecycle

Event ordering is enforced, not advisory. Validation takes place during the
write, within the same transaction that appends the event. A rejected event
leaves no trace and does not consume a position.

MCP registers an agent with `visualise_context_open` (REST command
`context.opened`); `visualise_work_report` with `report.action: "run_finish"`
explicitly closes the run. These use the same domain lifecycle rules as the
legacy events below, which remain valid. A transport connection does not open
or finish a run.

### The root orchestrator opens a run

The **first** event in a run must be `agent.started` with
`payload.role: "orchestrator"` and `parentAgentId: null`. Any other event before
it is rejected with `422 run_not_started`. A run has exactly one root
orchestrator; a second such event produces `422 run_already_started`.

### Every agent registers itself — the most common beginner mistake

> **Every agent must first send its own `agent.started`** before reporting
> anything else. Otherwise the server responds with **`422 unknown_agent`**.

This is a mistake in almost every first integration: the orchestrator starts
and delegates, and the subagent immediately reports its first
`work.step_started`. The server rejects it because that agent does not yet
exist for the cockpit. `agent.started` is the only exception to the rule,
because it introduces the agent in the first place.

The same check applies to `parentAgentId`: the named parent agent must already
have sent `agent.started` in the same run; otherwise the result is
`422 parent_agent_unknown`.

In practice: **A subagent must always send its own `agent.started` before any
other event.**

### Only the orchestrator can close the run

`run.finished` is optional and may only come from the run's root orchestrator;
any other agent receives `422 terminal_event_not_allowed`.

After `run.finished`, **work events are rejected** (`422
run_already_finished`). Exactly two types remain allowed for new legacy events:
`correction.issued` and `retraction.issued`. A closed run must remain
correctable because the log is append-only and there is no other way to fix
an incorrect report.

`correction.issued` and `retraction.issued` use `correctsClientEventId` and
`retractsClientEventId`, respectively, to refer to an event already accepted in
the same **project**; otherwise the result is `422 correction_target_unknown`.
Neither replaces anything: the original remains in the log and is marked as
corrected or retracted in the cockpit.

Identical retries of previously accepted commands return their original receipt
even after the run has finished, without writing again.

### Status is reported, never inferred

There is **no stall detection** and no work status inferred from elapsed time.
Transport and rendering timeouts limit requests, not domain work. Silence does
not create a status: the most recently reported `agent.status_reported` remains
valid until the agent sends a new one. **A run without a terminal event stays
open** and displays its last reported state. The cockpit invents neither
"finished" nor "crashed" states.

Likewise, `risk.reported` and `problem.reported` are statements by the agent
about itself. The system does not evaluate anything. An agent must report a
run's state for it to become visible in the cockpit.

## Relevant events, not raw activity

The 20 existing types use `schemaVersion: "1.0"`:

| Group | Types |
| --- | --- |
| Agent | `agent.started`, `agent.status_reported`, `agent.progress_reported`, `agent.finished` |
| Plan | `plan.published`, `plan.step_updated` |
| Work | `work.step_started`, `work.step_completed` |
| Feedback | `feedback.published` |
| Architecture | `architecture.snapshot_published` |
| Components | `component.change_planned`, `component.change_applied` |
| Relationships | `relationship.change_planned`, `relationship.change_applied` |
| Diff | `diff.reported` |
| Risk / Problem | `risk.reported`, `problem.reported` |
| Correction | `correction.issued`, `retraction.issued` |
| Run | `run.finished` |

**Low-level tool calls, terminal commands, file reads, token consumption, and
raw model output are not part of the contract**. They are structurally rejected,
not merely ignored: `type` is an enumeration, every payload schema is closed,
and the request body is a discriminated `oneOf` union. There is no field for
embedding terminal output.

The six command types with `schemaVersion: "2.0"` are
`model.mutation_applied`, `context.opened`, `work.reported`,
`work.scope_reported`, `view.saved`, and `view.removed`. MCP inputs use
`contractVersion: "2.0.0"` instead of an event envelope. A model change does not
prove that repository code changed. Scope and work steps are explicitly
reported; connections, silence, and the time of day do not create activity.

Report what a human reviewer of the observed application needs: what work is
being done, on what, and with what outcome. Reporting 200 tool calls per minute
misunderstands the tool's purpose and produces a `400 unsupported_event_type`
for each call.

### Rules that are easy to miss on a first integration

- **A `diff.reported` contains exactly one repository-relative file** and its
  unified diff. A change to three files requires three events, each with its own
  `diffId` and the same `changeId`; the `changeId` is their only connection. The
  `filePath` pattern already rejects absolute paths and `..` segments.
- **Each NATS topic is a separate relationship** with its own `relationshipId`,
  `kind: nats_topic`, and the topic name in `channel`. Topics are never combined
  into a single "messaging" edge.
- **`architecture.snapshot_published` completely replaces the applied model.**
  Anything absent from the snapshot no longer exists afterward. Use
  `component.change_*` and `relationship.change_*` for incremental changes.
- **`parentComponentId` is required**, including for root components. For roots,
  explicitly set it to `null`; omitting it produces a `400`.
- **Planned does not mean applied.** `*.change_planned` reports a proposal and
  does not change the model; only `*.change_applied` changes it. The cockpit
  draws proposals alongside the model, never as part of it.

## Idempotency and retries

`clientEventId` is the key. It is unique per project, and a retry must carry the
same value **and** the same content.

| Case | Response |
| --- | --- |
| First delivery | `201` with `duplicate: false` and the newly assigned `position` |
| Byte-identical retry | `200` with `duplicate: true` and **the same** `position` as the first delivery |
| Same ID, different content | `409 client_event_id_conflict` |

"Byte-identical" means identical content, not identical characters: the payload
is canonicalized (object keys recursively sorted, insignificant whitespace
removed) and hashed. A different JSON key order is therefore harmless; a
changed value is not.

In practice, after a network error with no response, simply **send the same
event again**. It cannot be delivered twice. Do not recalculate the timestamp
or adjust a field: that would be a different event under the same ID and would
produce a `409`.

For the six new command types, a retry includes the complete identity,
including the reporter, parent agent, timestamp, and expected revisions.
Numeric representations such as `0` and `0.0` are both valid integers but count
as different retry content. The stored receipt contains the original
`projectPosition`, `modelRevision`, and, where applicable, `viewRevision`; a
retry does not replace these with current values. After `revision_conflict`,
read and reconcile first, then write with a new ID. Model revision, view
revision, and log position are separate counters.

Example responses:
[`retry-idempotent-response.json`](../api/examples/retry-idempotent-response.json),
[`conflict-response.json`](../api/examples/conflict-response.json).

## Size limits

The following size limits and HTTP error details apply to REST. MCP separately
limits requests and structured responses to 1 MiB each, and a native PNG to
4 MiB decoded. MCP domain errors are structured tool errors; a proxy 413 is a
plain HTTP rejection. See [MCP](mcp-domain-tools.md).

A legacy event may be up to **2 MiB (2097152 bytes)** by default.
The six `schemaVersion: "2.0"` commands also have a fixed 1 MiB limit.
Above the limit, the server responds with `413` and the code `event_too_large`.
The server-side value is configurable through the `MAX_EVENT_BYTES`
environment variable (see [Operations](./operations.md#configuration)); an agent
cannot negotiate it and should avoid approaching it.

In practice, the limit affects two things: very large
`architecture.snapshot_published` events and very large `unifiedDiff` values.
Both can be split: architectures through incremental `change_*` events, and
diffs per file, as already required.

If the request also exceeds the entry-point limit (`MAX_REQUEST_BODY_SIZE`,
default `4m`), Nginx rejects it first. This rejection also uses
`application/problem+json` with `code: event_too_large`, so a client cannot
distinguish it from the backend's rejection. This is intentional.

## Error format

All errors follow **RFC 9457** (`application/problem+json`) with the fields
`type`, `title`, `status`, `detail`, `code`, and `instance`. The `code` is the
stable, machine-readable field; client logic should rely on it, not `detail`.

| Status | When | Codes |
| --- | --- | --- |
| `400` | The body is valid JSON but violates the contract | `invalid_field`, `unsupported_event_type`, `unsupported_schema_version` |
| `409` | `clientEventId` reused with different content | `client_event_id_conflict` |
| `413` | Event exceeds the limit | `event_too_large` |
| `415` | Incorrect `Content-Type` | `unsupported_media_type` |
| `422` | Valid against the schema, but conflicts with project state | See the table below |

### `400` identifies individual fields

A `400` also includes `errors[]`. Each entry contains a `field` as a
**JSON Pointer** (RFC 6901) into the submitted body, a `code`, and a message.
A typo in the envelope typically produces two entries: the unknown field and
the missing correct field:

```json
{
  "type": "https://visualise-ai.local/problems/invalid-field",
  "title": "Invalid field", "status": 400, "code": "invalid_field",
  "detail": "the agent.progress_reported event violates the contract in 3 place(s).",
  "instance": "/api/v1/events",
  "errors": [
    { "field": "/occuredAt",       "code": "unknown_property", "message": "property \"occuredAt\" is not declared by the contract" },
    { "field": "/occurredAt",      "code": "required",         "message": "required property \"occurredAt\" is missing" },
    { "field": "/payload/percent", "code": "out_of_range",     "message": "maximum: got 140, want 100" }
  ]
}
```

Because the server uses `type` to validate exactly the union branch the agent
intended, the pointers always refer to the submitted event, not to 19 other
event types. Another example:
[`validation-error-response.json`](../api/examples/validation-error-response.json).

### Individual `422` codes

| Code | Meaning | Resolution |
| --- | --- | --- |
| `run_not_started` | The run was never opened | First send the root orchestrator's `agent.started` with `role: orchestrator` and `parentAgentId: null` |
| `run_already_started` | A second root orchestrator for the same run | Use exactly one root per run. Use a new `runId` for a new session |
| `unknown_agent` | The reporting agent never sent `agent.started` | Send this agent's `agent.started` first |
| `parent_agent_unknown` | The agent named in `parentAgentId` is unknown | Start the parent agent first, or correct the ID |
| `terminal_event_not_allowed` | An agent other than the orchestrator sent `run.finished` | Leave `run.finished` to the root orchestrator |
| `run_already_finished` | Work event after `run.finished` | Open a new run. Corrections remain possible through `correction.issued`/`retraction.issued` |
| `correction_target_unknown` | The corrected or retracted event does not exist in the project | Check the original's `clientEventId`; it is project-wide, not run-wide |

## A minimal valid sequence

Five handcrafted events are enough for the cockpit to display something useful:
a root orchestrator, a subagent, an architecture snapshot, feedback, and a diff.

```bash
BASE=http://localhost:8080

post() { curl -sS -X POST "$BASE/api/v1/events" -H 'Content-Type: application/json' -d "$1"; echo; }

# 1 — The root orchestrator opens the run
post '{
  "schemaVersion": "1.0",
  "clientEventId": "11111111-1111-4111-8111-111111111111",
  "projectId": "docs-proof", "runId": "run-docs-proof-0001",
  "agentId": "orchestrator-root", "parentAgentId": null,
  "occurredAt": "2026-08-04T12:00:00Z",
  "type": "agent.started",
  "payload": { "role": "orchestrator", "displayName": "Root Orchestrator",
               "assignedTask": "Refactor the checkout service and delegate the work." }
}'

# 2 — The subagent registers itself before reporting anything else
post '{
  "schemaVersion": "1.0",
  "clientEventId": "22222222-2222-4222-8222-222222222222",
  "projectId": "docs-proof", "runId": "run-docs-proof-0001",
  "agentId": "subagent-implementer", "parentAgentId": "orchestrator-root",
  "occurredAt": "2026-08-04T12:00:10Z",
  "type": "agent.started",
  "payload": { "role": "subagent", "displayName": "Implementer",
               "assignedTask": "Extract pricing calculations from the API module." }
}'

# 3 — Architecture. Completely replaces the applied model.
post '{
  "schemaVersion": "1.0",
  "clientEventId": "33333333-3333-4333-8333-333333333333",
  "projectId": "docs-proof", "runId": "run-docs-proof-0001",
  "agentId": "subagent-implementer", "parentAgentId": "orchestrator-root",
  "occurredAt": "2026-08-04T12:01:00Z",
  "type": "architecture.snapshot_published",
  "payload": {
    "snapshotId": "snapshot-0001",
    "components": [
      { "componentId": "checkout",     "name": "Checkout",     "kind": "system",    "parentComponentId": null },
      { "componentId": "checkout.api", "name": "Checkout API", "kind": "service",   "parentComponentId": "checkout" },
      { "componentId": "checkout.db",  "name": "Checkout DB",  "kind": "datastore", "parentComponentId": "checkout" }
    ],
    "relationships": [
      { "relationshipId": "rel-0001", "sourceComponentId": "checkout.api",
        "targetComponentId": "checkout.db", "kind": "data", "protocol": "postgresql" }
    ]
  }
}'

# 4 — Component-related feedback as Markdown
post '{
  "schemaVersion": "1.0",
  "clientEventId": "44444444-4444-4444-8444-444444444444",
  "projectId": "docs-proof", "runId": "run-docs-proof-0001",
  "agentId": "subagent-implementer", "parentAgentId": "orchestrator-root",
  "occurredAt": "2026-08-04T12:02:00Z",
  "type": "feedback.published",
  "payload": {
    "feedbackId": "feedback-0001", "componentIds": ["checkout.api"],
    "format": "markdown", "title": "Rounding rule is undefined",
    "body": "The new pricing calculation rounds **per line item**; the old one rounded per order."
  }
}'

# 5 — Unified diff for exactly one file
post '{
  "schemaVersion": "1.0",
  "clientEventId": "55555555-5555-4555-8555-555555555555",
  "projectId": "docs-proof", "runId": "run-docs-proof-0001",
  "agentId": "subagent-implementer", "parentAgentId": "orchestrator-root",
  "occurredAt": "2026-08-04T12:03:00Z",
  "type": "diff.reported",
  "payload": {
    "diffId": "diff-0001", "changeId": "change-0001",
    "componentIds": ["checkout.api"],
    "filePath": "internal/checkout/pricing.go",
    "unifiedDiff": "--- a/internal/checkout/pricing.go\n+++ b/internal/checkout/pricing.go\n@@ -10,3 +10,3 @@ func Total(o Order) Amount {\n-\treturn round(sum(o.Lines))\n+\treturn sum(roundEach(o.Lines))\n }\n"
  }
}'
```

Each call responds with `201`, assigning positions 1 through 5. Then
`http://localhost:8080/projects/docs-proof` shows the three components;
clicking *Checkout API* opens the inspector with feedback and the diff.

`run.finished` is intentionally omitted here: it is optional, and the run stays open.

## Ready-made example payloads

Use these files instead of retyping them. They are the examples referenced by
the contract and are validated against it:

| File | Demonstrates |
| --- | --- |
| [`root-agent-started.json`](../api/examples/root-agent-started.json) | Root orchestrator, `parentAgentId: null` |
| [`subagent-started.json`](../api/examples/subagent-started.json) | Subagent with a parent agent |
| [`architecture-snapshot.json`](../api/examples/architecture-snapshot.json) | Four hierarchy levels and every relationship kind, including separate NATS topic edges |
| [`component-change-planned.json`](../api/examples/component-change-planned.json) | Planned component change |
| [`component-change-applied.json`](../api/examples/component-change-applied.json) | The same change, applied |
| [`feedback-published.json`](../api/examples/feedback-published.json) | Component-related Markdown feedback |
| [`diff-reported.json`](../api/examples/diff-reported.json) | Unified diff for exactly one file |
| [`correction-issued.json`](../api/examples/correction-issued.json) | Correction of an earlier event |
| [`run-finished.json`](../api/examples/run-finished.json) | Optional terminal event |

The examples are **individual illustrations, not an executable sequence**.
Sending them in order runs into the lifecycle rules above. A runnable sequence
is provided [above](#a-minimal-valid-sequence) and in the simulator.

Additional examples — read models, error responses, and rejection fixtures —
are cataloged in [`api/README.md`](../api/README.md).

## SSE: streaming and reconnection

`GET /api/v1/projects/{projectId}/stream` delivers Server-Sent Events. Each
`data:` contains a `StreamedEvent`: the same event the agent sent, plus
`position`, `serverEventId`, and `receivedAt`. The `event:` field contains the
`type`, and the `id:` field contains the position.

**The SSE `id` *is* the server-side project position.** Positions are monotonic
and gapless within each project; they are the only cursor. The event UUID is
not a cursor because it carries no ordering.

There are two ways to resume:

| Method | Used by | Behavior for an invalid value |
| --- | --- | --- |
| `Last-Event-ID` header | Browsers (`EventSource` sets it automatically) | Ignored; the stream starts live |
| `?lastEventPosition=` query | Clients managing their own cursor: simulator, tests, CLI | `400` — an unusable value is a client defect |

If both are set, `lastEventPosition` takes precedence. **Replay begins at
`position + 1`** and then transitions seamlessly to live delivery. There is no
visible boundary between them; the client sees only increasing positions.
Every committed event is delivered exactly once, in position order, without
gaps or duplicates.

> **Easy to miss: a stream *without* a cursor starts at the live end and does
> not replay.** It stays completely silent until the next event arrives. This
> can look like a broken stream, but it is the documented initial state.
> **To retrieve history, set `lastEventPosition=0`**; positions start at 1, so
> `0` returns the project from the beginning.

A few smaller points to consider when building a client:

- **Keepalives are SSE comment lines** (`: keepalive`) and never carry an `id:`.
  They cannot move the cursor; a client must ignore them. The first line after
  connecting is usually a keepalive.
- **A cursor beyond the end of the log** is clamped to the current end, rather
  than taken literally. Taking it literally would produce a permanently silent
  stream.
- An unknown project returns `404 project_not_found`.

A worked example with real requests and responses:
[`api/examples/sse-reconnect.md`](../api/examples/sse-reconnect.md).

## Read API

Agents do not need it; it is the cockpit's read interface. Clients that do use
it (for example, in tests) should know two things: every response includes
`projectPosition` to compare an HTTP snapshot with the SSE cursor, and the
alias run ID `current` resolves to the run most recently opened by a root
orchestrator. The complete overview is in
[`api/README.md`](../api/README.md).

## What agents must not expect

The cockpit is observational and read-only: it provides no return channel,
control commands, approvals, or evaluation of reported work. For other
explicit v0 exclusions, and why agent feedback is treated as untrusted input,
see [`security-and-boundaries.md`](./security-and-boundaries.md).
