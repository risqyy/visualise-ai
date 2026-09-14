# 30. Official MCP SDK over the existing published HTTP entry point

- **Status:** accepted, transport implemented in #78; domain tools follow in #79
- **Date:** 2026-09-14
- **Builds on:** [ADR 0029](0029-model-view-and-mcp-contract.md)

## Decision

Use the official `github.com/modelcontextprotocol/go-sdk` **v1.7.0**, pinned in
`backend/go.mod` and `go.sum`. Backend Go remains **1.25.7**. Mount its stateful
Streamable HTTP handler at **`/mcp`** behind the existing Nginx/frontend port.
There is no separate public listener and no legacy HTTP+SSE MCP endpoint.
The existing `/api/v1` REST API, browser SSE, `/healthz` and `/readyz` remain.

The route supports MCP protocol **2025-11-25**, **2025-06-18**, **2025-03-26** and
**2024-11-05**. SDK v1.7.0 also supports **2026-07-28**, but its implementation
requires stateless HTTP for that protocol. This stateful route negotiates
2025-11-25 when initialize requests a newer or unknown version. The SDK client
v1.7.0 discovers this and falls back successfully. Unsupported legacy
`MCP-Protocol-Version` headers are HTTP 400. Contract **2.0.0**, MCP protocol
version and SDK release are independent versions.

This deliberately uses the SDK's session/initialization/cancellation behavior,
JSON-RPC dispatch, tool listing and content encoding rather than a custom MCP
implementation. A session ID is only a protocol connection identifier; no
connection, keepalive, cancellation, expiry or disconnect starts/finishes a run,
changes work status, or reports inferred progress.

## Registration and errors

`mcptransport.Options.Register func(*mcp.Server) error` runs once before serving.
#79 adds catalogue-derived tools through this hook, calling shared application
services. `httpapi.Options.MCP` is an ordinary optional `http.Handler` so router
and transport can be tested independently. No store lives in the transport.

Production #78 registers **zero tools**, returns an empty `tools/list`, and
advertises no tools, resources, prompts or logging capability. Tests register
explicitly test-only handlers in an `httptest` process. Those handlers are never
part of the production binary. The catalogue is a future domain contract, not
permission to advertise unimplemented operations.

Unknown tools and malformed MCP method parameters remain SDK JSON-RPC errors;
invalid HTTP/JSON framing uses the SDK's HTTP error surface. Domain adapters
return `CallToolResult{IsError:true}` with structured contract Error data and
matching text, while success returns the catalogue output and equivalent text.
The registration hook does not automatically validate domain inputs: #79 must
validate generated schemas and bound outputs before returning them.

## Proxy, trust and resource limits

Nginx forwards the original `$http_host` **including its port** on `/mcp`, leaves
MCP session/version and Origin headers intact, and disables request/response
buffering and caching. Streamable POST responses and optional GET streams pass
through the same published port. No transport event replay store is configured;
clients reconnect after session expiry or backend restart. Domain idempotency
belongs to explicit command IDs, not HTTP or session replay.

The backend validates **every MCP method's Host** against `MCP_ALLOWED_HOSTS`
(exact host[:port], case-insensitive), and every supplied **Origin** against
`MCP_ALLOWED_ORIGINS` (exact scheme/host/port). Omitted Origin is allowed for
native clients only after Host validation. Invalid, null, multiple or unlisted
origins receive HTTP 403. Forwarded headers cannot override these checks.
Wildcards, userinfo and URL paths are rejected in configuration. The SDK's
localhost rebinding protection remains enabled as additional protection.

Compose derives loopback host/origin defaults from `FRONTEND_HTTP_PORT` (8080
normally). A directly started backend defaults to loopback names with port 8080.
For a deliberately configured reverse proxy/LAN name set both allowlists to the
external authority. This is the existing trusted single-user deployment model:
**no OAuth, user authentication, project ACL or internet exposure is provided**.
Host/Origin checks are browser/rebinding protection, not user authentication.

Requests are capped at **1 MiB by the SDK**, including unknown-length bodies.
The existing Nginx limit defaults to 4 MiB; its location-specific MCP HTTP413
contains no REST event error code. Read headers and MCP body reads have a
10-second bound. `MCP_REQUEST_TIMEOUT` defaults to 45 seconds per dispatched
method; `MCP_SESSION_TIMEOUT` defaults to 5 minutes of inactivity. They are Go
durations and must be positive. No global HTTP write deadline cuts off SSE.
Handlers must honor their context; #81's 30-second render deadline remains
stricter. Domain structured-output/image limits are adapter responsibilities.

For these stateful protocol versions the SDK's explicit cancellation notification
cancels the tool context. A broken HTTP connection alone does not prove that a
mutation was cancelled and must not be translated into domain lifecycle changes.
`Shutdown(ctx)` rejects new HTTP calls, cancels tool contexts and streams, closes
SDK sessions, and waits within the existing shutdown budget (15 seconds by default).
Sessions admitted concurrently with shutdown are closed after HTTP calls drain.
There is no persistent session recovery and no distributed session routing.

## Verification

From `backend`, run `go test ./...`. The transport tests use the official SDK
client for initialization, negotiated capability/tool listing, empty production
registry, structured success/domain errors, unknown-tool errors, explicit
cancellation, deadline, shutdown and disconnect. Additional HTTP tests cover
all four supported requested versions plus newer/unknown negotiation, denied
Host/Origin, body limit, session DELETE/expiry and GET stream shutdown.

For acceptance through the actual published Nginx endpoint (PowerShell):

```powershell
$env:FRONTEND_HTTP_PORT = '18178'
docker compose -p vai-epic75-i78 up --build -d --wait
Set-Location backend
$env:TEST_MCP_ENDPOINT = 'http://localhost:18178/mcp'
go test ./internal/mcptransport -run TestPublishedEndpoint -v -count=1
```

This opt-in test uses the real production binary, checks the SDK handshake/list/
unknown-tool error, both backend/proxy body limits, Host and Origin protection,
health/readiness, creates an isolated project through real REST ingestion,
replays its event through browser SSE, and verifies MCP connection activity did
not change its project state. It intentionally writes test data only to the
isolated Compose project/volume. Tear down that named project after testing.

Sources inspected at the pinned release:
[SDK README](https://github.com/modelcontextprotocol/go-sdk/blob/v1.7.0/README.md),
[Streamable HTTP implementation](https://github.com/modelcontextprotocol/go-sdk/blob/v1.7.0/mcp/streamable.go),
[server capability and method implementation](https://github.com/modelcontextprotocol/go-sdk/blob/v1.7.0/mcp/server.go).
