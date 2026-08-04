# Visualise AI — Agent Project Cockpit

Observability cockpit for agent work on a software project. It shows the whole
application architecture, the running agents and subagents, their reported work
steps, component-scoped AI feedback and unified diffs.

The cockpit **observes**; it never drives the agent. Users cannot prompt from
inside the application, and the system never judges whether the agent's work is
right or wrong.

> **Trust boundary:** v0 is meant for a local machine or a private network. It
> has no authentication, no authorisation and no multi-tenancy. Do not expose it
> to the public internet.

## Repository layout

| Path              | Contents                                                   |
| ----------------- | ---------------------------------------------------------- |
| `backend/`        | Go module: Gin HTTP surface, zerolog, GORM/PostgreSQL       |
| `frontend/`       | React + TypeScript application, built by Vite               |
| `frontend/nginx/` | Nginx site config — the only external entry point           |
| `simulator/`      | Node/TypeScript event simulator — the deterministic demo client |
| `docker-compose.yml` | `frontend`, `backend` and `postgres` services           |
| `docs/decisions/` | Architecture decision records                               |

## Quick start

```bash
cp .env.example .env   # optional, defaults work as-is
docker compose up --build
```

Then open <http://localhost:8080>.

A fresh database is empty, so the cockpit has nothing to show until an agent
reports something. The bundled simulator fills it deterministically through the
public route:

```bash
cd simulator
npm install
npm run simulate                # or: npm run simulate -- --base http://localhost:8091
```

See [`simulator/README.md`](simulator/README.md) for the scenarios and flags.

The full operations and agent-integration guide is delivered separately; this
file covers the scaffold only.

## Network topology

```
host :8080
     │
     ▼
┌──────────────┐        ┌─────────────┐        ┌──────────────┐
│  frontend    │ ─────▶ │  backend    │ ─────▶ │  postgres    │
│  (nginx)     │        │  (go/gin)   │        │              │
│  published   │        │  internal   │        │  internal    │
└──────────────┘        └─────────────┘        └──────────────┘
```

Nginx serves the production bundle and proxies three kinds of traffic to the
backend:

| Route                                | Purpose                                  |
| ------------------------------------ | ---------------------------------------- |
| `/api/v1/events`                     | agent event ingestion                    |
| `/api/v1/…`                          | UI read models                           |
| `/api/v1/projects/{id}/stream`       | SSE live stream, proxied **unbuffered**  |
| `/healthz`, `/readyz`                | backend probes                           |

Neither `backend` nor `postgres` publishes a host port.

## Health and readiness

- `GET /healthz` — the process is alive. Always `200` while it serves.
- `GET /readyz` — the backend finished startup **and** PostgreSQL answers.
  Returns `503` otherwise.

The backend container healthcheck probes `/readyz`, and the frontend container
starts only once the backend is healthy. A backend that fails to start is
therefore never routed to as ready.

## Data persistence

PostgreSQL stores its data in the named volume `pgdata`. It survives
`docker compose down`; use `docker compose down -v` to start from an empty
database.

## Configuration

All settings are environment variables and documented in
[`.env.example`](.env.example).

## Local development

```bash
# Backend
cd backend
go build ./... && go vet ./... && go test ./...

# Frontend
cd frontend
npm ci
npm run lint && npm run typecheck && npm run test && npm run build

# Simulator
cd simulator
npm ci
npm run lint && npm run typecheck && npm test
```

`npm run dev` starts Vite on port 5173 and proxies `/api`, `/healthz` and
`/readyz` to a backend on `localhost:8080`, so paths match the Compose
deployment.
