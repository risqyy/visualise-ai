# Event contract

`openapi.yaml` is the single, versioned contract between the reporting agents and the
Visualise AI cockpit. Everything the cockpit shows arrives through it; nothing is inferred.

* **Document version** — `info.version` (`1.0.0`), OpenAPI 3.1.0.
* **Payload version** — `schemaVersion` inside every event envelope. v0 accepts `1.0` only.

## Surface

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/events` | Single-event ingestion, idempotent on `clientEventId`. |
| `GET /api/v1/projects/{projectId}/stream` | Server-Sent Events: replay from a position, then live. |
| `GET /healthz`, `GET /readyz` | Internal probes on the Go backend container. |

The historical read API is specified separately and is not part of this document.

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
| `retry-idempotent-response.json` | `200` with `duplicate: true` |
| `conflict-response.json` | `409` problem |
| `validation-error-response.json` | `400` problem with field errors |
| [`sse-reconnect.md`](./examples/sse-reconnect.md) | Full SSE reconnect walkthrough with `Last-Event-ID` |

## Working on the spec

```bash
npm ci        # or: npm install
npm run lint  # redocly lint openapi.yaml
npm run bundle # writes dist/openapi.bundled.yaml
```

`redocly.yaml` extends the `recommended` ruleset with `struct: error` (the current name of the
former `spec` rule). Two rules are switched off with a reason in the file: `info-license`
(the repository declares no license) and `no-server-example.com` (the only entry point really
is `http://localhost:8080`). `.redocly.lint-ignore.yaml` carries one narrow exception for the
two internal probes, so `operation-4xx-response` stays enforced everywhere else.
