# SSE reconnect walkthrough

How a cockpit client resumes `GET /api/v1/projects/{projectId}/stream` after a dropped
connection without losing or duplicating a single event.

## Guarantees

* Every committed event is delivered **exactly once**, in ascending `position` order, with no
  gaps and no duplicates.
* The SSE `id:` field always carries the server-side project `position` (an integer).
* The SSE `event:` field always carries the event `type` from the catalogue.
* Each `data:` line carries one compact-JSON `StreamedEvent`.
* Keepalives are SSE comment lines (`: keepalive`) and never carry an `id:`, so they cannot
  move the client cursor.

## 1. Initial connect

```http
GET /api/v1/projects/visualise-ai/stream HTTP/1.1
Host: localhost:8080
Accept: text/event-stream
```

Without `Last-Event-ID` and without `lastEventPosition` the server sends the live tail only —
no replay.

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no

id: 40
event: work.step_started
data: {"schemaVersion":"1.0","clientEventId":"a1d7...","projectId":"visualise-ai","runId":"run-2026-08-04-0001","agentId":"subagent-implementer","parentAgentId":"orchestrator-root","occurredAt":"2026-08-04T09:44:02Z","type":"work.step_started","payload":{"workStepId":"work-0004","title":"Extract VAT handling","componentIds":["shop-platform.orders.domain.pricing"]},"position":40,"serverEventId":"0c1f...","receivedAt":"2026-08-04T09:44:02.311Z"}

id: 41
event: agent.status_reported
data: {"schemaVersion":"1.0","clientEventId":"9a1f...","projectId":"visualise-ai","runId":"run-2026-08-04-0001","agentId":"subagent-implementer","parentAgentId":"orchestrator-root","occurredAt":"2026-08-04T09:45:10Z","type":"agent.status_reported","payload":{"status":"working","note":"Rewriting Total()."},"position":41,"serverEventId":"1d2c...","receivedAt":"2026-08-04T09:45:10.004Z"}

: keepalive

```

The client has now processed position `41`.

## 2. Connection drops

The browser's `EventSource` reconnects on its own and automatically replays the last received
`id:` in the `Last-Event-ID` request header:

```http
GET /api/v1/projects/visualise-ai/stream HTTP/1.1
Host: localhost:8080
Accept: text/event-stream
Last-Event-ID: 41
```

The server resumes at `41 + 1 = 42`, replays every committed event from there and then
continues seamlessly with live events. There is no visible boundary between replay and live
tail; the client simply keeps receiving increasing positions.

```text
id: 42
event: diff.reported
data: {"schemaVersion":"1.0", ... ,"position":42, ...}

id: 43
event: feedback.published
data: {"schemaVersion":"1.0", ... ,"position":43, ...}

```

## 3. Non-browser clients

Clients that persist the cursor themselves (the simulator, integration tests, CLI tools) can
pass the position explicitly instead:

```http
GET /api/v1/projects/visualise-ai/stream?lastEventPosition=41 HTTP/1.1
```

`lastEventPosition=0` replays the project from the very beginning, since positions start at
`1`. If both `lastEventPosition` and `Last-Event-ID` are present, `lastEventPosition` wins.

## 4. Unknown project

```http
GET /api/v1/projects/unknown-project/stream HTTP/1.1
```

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json

{
  "type": "https://visualise-ai.local/problems/project-not-found",
  "title": "Project not found",
  "status": 404,
  "detail": "No project with id \"unknown-project\" exists.",
  "code": "project_not_found"
}
```

## Client checklist

1. Store the last processed `position` (not the payload) as the cursor.
2. Ignore comment lines; they are keepalives.
3. Branch on the `event:` field — it equals `type` and selects the `StreamedEvent` variant.
4. On reconnect, send `Last-Event-ID` (browsers do this automatically) or
   `?lastEventPosition=<cursor>`.
5. Treat a `position` that is not `cursor + 1` as a bug and reconnect with the stored cursor
   rather than papering over the gap.
