# Event contract

`openapi.yaml` is the single, versioned contract between the reporting agents, the Visualise
AI cockpit and its UI. Everything the cockpit shows arrives through it; nothing is inferred.

* **Document version** — `info.version` (`1.1.0`), OpenAPI 3.1.0.
* **Payload version** — `schemaVersion` inside every event envelope. v0 accepts `1.0` only.

## Surface

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/events` | Single-event ingestion, idempotent on `clientEventId`. |
| `GET /api/v1/projects/{projectId}/stream` | Server-Sent Events: replay from a position, then live. |
| `GET /api/v1/projects` | Every known project. |
| `GET /api/v1/projects/{projectId}` | One project with the sizes of its read models. |
| `GET /api/v1/projects/{projectId}/architecture` | Applied components and relationships plus pending proposals. |
| `GET /api/v1/projects/{projectId}/runs` | Current and historical runs, paged. |
| `GET /api/v1/projects/{projectId}/runs/{runId}` | One run; `current` resolves to the current one. |
| `GET /api/v1/projects/{projectId}/runs/{runId}/agents` | Flat agent tree of one run. |
| `GET /api/v1/projects/{projectId}/runs/{runId}/plans` | Every plan of one run with all revisions. |
| `GET /api/v1/projects/{projectId}/components/{componentId}` | Component inspector for exactly one run. |
| `GET /api/v1/projects/{projectId}/components/{componentId}/history` | Run spanning component history, paged. |
| `GET /healthz`, `GET /readyz` | Internal probes on the Go backend container. |

## Read models

The read endpoints answer from normalised projections the backend advances in the same
transaction that appends the event. A client never queries the event log; the only place the
log surfaces is the component history, and there as a paged, component filtered list.

* **`projectPosition` is in every response.** It is the project position at the moment the
  snapshot was read, so an HTTP snapshot and the SSE stream can be reconciled without guessing
  which one is ahead. Every row additionally carries the position of the event that last wrote
  it as `position`. On the project collection, which is not scoped to one project,
  `projectPosition` is the highest position across the listed projects.
* **Everything is scoped to one project.** No response ever carries a row of another project,
  even when two projects reuse the same run, agent or component ids.
* **Current run and history are separate views.** The inspector shows the evidence of exactly
  one run — the one in `runId`, or the current one. `…/history` is the run spanning, paged
  view. Neither mixes into the other.
* **`activeChanges` means pending.** Only changes in state `planned` are listed: an applied
  change *is* the model, a retracted one was withdrawn.
* **Pagination.** `limit` defaults to 50 and maxes out at 200; a value outside that range is a
  `400`, never a silently clamped page. `cursor` is opaque and echoed back unchanged. Runs, the
  component history and the inspector's unified diffs (`diffLimit`, `diffCursor`,
  `nextDiffCursor`) are paged; every other collection is complete.
* **Errors follow RFC 9457** as on the write path, with the additional codes `run_not_found`,
  `current_run_not_found`, `component_not_found` and `invalid_query_parameter`. A project whose
  runs were never opened by a root orchestrator has no current run, and
  `current_run_not_found` is distinct from `run_not_found` so a client can tell "no run yet"
  from "wrong run id".

## How the contract is closed

An event is an `EventEnvelope` (project, run, agent, optional parent agent, client event id,
timestamp, type, schema version, payload) plus a payload typed by `type`.

The request body of `POST /api/v1/events` is `IngestEventRequest`: a `oneOf` over one
envelope schema per event type, with `discriminator.propertyName: type` and a complete
mapping. Combined with the `EventType` enum, the `schemaVersion` enum and
`additionalProperties: false` on every object schema, this makes unknown event types, unknown
schema versions and unknown fields structurally impossible. There is no free-form fallback
event.

`StreamedEvent` is the same union plus the server-assigned `position`, `serverEventId` and
`receivedAt`, and is what a single SSE `data:` line carries.

## Event catalogue (v0)

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
| Risk / problem | `risk.reported`, `problem.reported` |
| Correction | `correction.issued`, `retraction.issued` |
| Run | `run.finished` |

Low-level tool calls, terminal commands, file reads and token usage are deliberately absent.

## Rules worth knowing before implementing against it

* **Status is reported, never derived.** `agent.status_reported` is explicit; silence changes
  nothing. `run.finished` is optional and no terminal state is inferred without it. After
  `run.finished` further work events of that run are rejected with `422`.
* **Risks and problems are agent statements.** The system performs no quality or drift
  evaluation of its own; the human reviewer judges.
* **One diff event carries exactly one repository-relative file** plus its unified diff.
  Absolute paths and `..` segments are rejected by the `filePath` pattern.
* **Every NATS topic is its own relationship** (`kind: nats_topic`, topic name in `channel`,
  own `relationshipId`). Topics are never merged into one aggregated edge.
* **`architecture.snapshot_published` replaces the applied model entirely**; incremental
  updates use the `component.change_*` and `relationship.change_*` events.
* **Idempotency.** `clientEventId` is the key: `201` on first delivery, `200` with
  `duplicate: true` on a byte-identical retry, `409` when the id is reused with different
  content.
* **Size limit.** 2 MiB (2097152 bytes) by default, configurable server-side via
  `MAX_EVENT_BYTES`; violations return `413` with code `event_too_large`.
* **Errors follow RFC 9457** (`application/problem+json`). `400` uses `ValidationProblem`,
  which adds `errors[]` with a JSON Pointer `field`, a `code` and a `message`.

## Examples

`examples/` holds ready-to-post payloads and response bodies, referenced from the spec via
`externalValue`:

| File | Shows |
| --- | --- |
| `root-agent-started.json` | Root orchestrator, `parentAgentId: null` |
| `subagent-started.json` | Subagent with a parent agent |
| `architecture-snapshot.json` | Four hierarchy levels and every relationship kind, including separate NATS topic edges |
| `component-change-planned.json` | Planned component change |
| `component-change-applied.json` | The same change applied |
| `feedback-published.json` | Component-scoped markdown feedback |
| `diff-reported.json` | Single-file unified diff |
| `correction-issued.json` | Correction of an earlier event |
| `run-finished.json` | Optional terminal run event |
| `architecture-read-model.json` | Read model of the applied architecture with two pending proposals |
| `component-inspector.json` | Read model of one component in one run: feedback, diff, risk, problem, proposal |
| `retry-idempotent-response.json` | `200` with `duplicate: true` |
| `conflict-response.json` | `409` problem |
| `validation-error-response.json` | `400` problem with field errors |
| [`sse-reconnect.md`](./examples/sse-reconnect.md) | Full SSE reconnect walkthrough with `Last-Event-ID` |

## Rejection fixtures

`fixtures/invalid/` holds documents that the contract **must** refuse. They exist so the
"closed catalogue" property is tested rather than merely asserted. Each file carries a
`_reason` field describing what it proves; the validator strips it before checking.

| File | Proves |
| --- | --- |
| `unknown-event-type.json` | A tool-call event is not representable — no free-form fallback |
| `unsupported-schema-version.json` | `schemaVersion: "2.0"` is refused |
| `unknown-payload-field.json` | Raw terminal output cannot be smuggled into a payload |
| `diff-with-absolute-path.json` | `filePath` must be repository relative |
| `progress-out-of-range.json` | `percent` stays within `0..100` |

## Working on the spec

```bash
npm ci                     # or: npm install
npm test                   # lint + bundle + example validation
```

The individual steps:

```bash
npm run lint               # redocly lint openapi.yaml
npm run bundle             # writes dist/openapi.bundled.yaml
npm run validate:examples  # checks examples/ and fixtures/invalid/ against the bundle
```

`validate:examples` compiles the bundled component schemas with Ajv (OpenAPI 3.1 schemas are
JSON Schema 2020-12) and asserts that every example matches the schema it illustrates and that
every rejection fixture is refused. `externalValue` examples are not checked by `redocly lint`,
so without this step the examples could silently drift away from the contract that the backend,
the simulator and the UI are built against.

`redocly.yaml` extends the `recommended` ruleset with `struct: error` (the current name of the
former `spec` rule). Two rules are switched off with a reason in the file: `info-license`
(the repository declares no license) and `no-server-example.com` (the only entry point really
is `http://localhost:8080`). `.redocly.lint-ignore.yaml` carries narrow, documented exceptions
for the two internal probes and for `GET /api/v1/projects`, which takes no parameter a client
could get wrong; `operation-4xx-response` stays enforced everywhere else.
