# 1. Compose topology with Nginx as the single entry point

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #2 (part of the v0 epic #1)

## Context

v0 runs on a local machine or in a private network. It needs a reproducible
environment for a React frontend, a Go backend and PostgreSQL, without a queue,
a broker or a separate worker, and with exactly one backend instance.

The backend serves three kinds of traffic that behave very differently: short
read requests for the UI, agent event ingestion, and long-lived Server-Sent
Event streams.

## Decision

Three Compose services on one bridge network:

1. `frontend` — Nginx serving the Vite production bundle. It is the **only**
   service that publishes a host port.
2. `backend` — the Go binary, internal only.
3. `postgres` — internal only, with a named volume `pgdata`.

Nginx proxies `/api/`, `/healthz` and `/readyz` to the backend. The SSE route
`/api/v1/projects/{id}/stream` gets its own regex location with
`proxy_buffering off`, `proxy_cache off`, `chunked_transfer_encoding off` and
24 h read/send timeouts, so events are forwarded the moment the backend writes
them.

The backend resolves through Docker's embedded DNS at request time
(`resolver 127.0.0.11` plus a `set $backend …` variable) instead of at
configuration load. Nginx therefore survives a backend restart instead of
refusing to start.

Readiness is modelled separately from liveness. `/healthz` reports the process,
`/readyz` reports "startup work finished **and** PostgreSQL answers". The
backend container healthcheck probes `/readyz` and the frontend declares
`depends_on: backend: condition: service_healthy`.

## Consequences

- A backend that fails to start never becomes healthy, so it is never routed to
  as ready — this is the acceptance criterion of #2.
- Because the frontend waits for a healthy backend, the UI is unavailable while
  the backend is down rather than serving a shell that 502s on every request.
  That is the intended behaviour for a single-instance observability tool.
- Publishing the database or the backend for debugging requires an explicit,
  deliberate change to `docker-compose.yml`.
- Schema management is owned by the backend (GORM `AutoMigrate` on startup); the
  readiness gate is the place where a failed migration will surface.
