# 0036 — Backend startup admission

Status: accepted for #95.

The HTTP listener may start before schema migration so liveness and readiness
remain observable. A shared router middleware admits only GET /healthz and GET
/readyz until bootstrap succeeds. All application routes, including REST,
SSE and every MCP method, return 503 with code `backend_unavailable` before
their handlers run. A missing health checker also fails closed.

This boundary belongs to the backend: an existing Nginx instance can continue
proxying traffic during a backend-only restart and cannot be relied upon to
repeat its initial readiness wait. Delaying the listener would also prevent
application access, but would make probes unavailable throughout migration.

Admission uses the checker's atomic bootstrap state; it does not add a database
ping to every request. /readyz still checks PostgreSQL after bootstrap, while
/healthz indicates process liveness independently. Runtime database errors
remain the responsibility of the existing handlers.

Migration receives the process cancellation context. Failure never sets the
bootstrap state; deferred cleanup closes the HTTP listener and connections
before closing the database. Shutdown withdraws admission before closing SSE
subscriptions and draining renderer, MCP and HTTP work. Requests already
admitted can finish through the existing graceful shutdown path. Deferred HTTP
close also handles startup errors and a failed graceful shutdown.

Deterministic tests exercise every registered application route before bootstrap
and after readiness withdrawal, MCP admission after success, and the startup
transition for both successful and failed migration callbacks. Existing
database-backed route and streaming tests cover admitted application behavior.
