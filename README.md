# Visualise AI — Agent Project Cockpit

An observation cockpit for agent work on a software project. It shows the
complete application architecture, running agents and subagents, their
reported work steps, component-specific AI feedback, and unified diffs.

The cockpit **observes**; it never controls the agent. Users cannot send prompts
from the application, and the system never judges whether the agent's work
is correct.

> **Trust boundary:** v0 is intended for a local machine or a private
> network. It has no authentication, authorization, or multi-tenancy.
> **Do not expose it to the public internet.**
> For details and the complete product boundaries, see
> [`docs/security-and-boundaries.md`](docs/security-and-boundaries.md).

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/getting-started.md`](docs/getting-started.md) | Connect an agent or set up the demo without learning the event contract |
| [`docs/operations.md`](docs/operations.md) | Prerequisites, Compose startup, all environment variables, health checks, persistence, simulator, end-to-end tests |
| [`docs/mcp-domain-tools.md`](docs/mcp-domain-tools.md) | Verified SDK client: read, mutate atomically, save a view, inspect a native PNG |
| [`docs/epic-75-acceptance.md`](docs/epic-75-acceptance.md) | Local acceptance results, measurement conditions, and remaining limits |
| [`docs/agent-integration.md`](docs/agent-integration.md) | The event contract in practice: lifecycle, idempotency, error codes, SSE reconnect, and a minimal valid sequence |
| [`docs/security-and-boundaries.md`](docs/security-and-boundaries.md) | Trust boundary, attack surface, v0 exclusions, and the `RepositoryProvider` boundary |
| [`api/README.md`](api/README.md) | The contract itself: schemas, examples, and rejection fixtures |
| [`api/openapi.yaml`](api/openapi.yaml) | OpenAPI 3.1 — the authoritative source for all field names and formats |
| [`simulator/README.md`](simulator/README.md) | Simulator flags and scenarios |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records |

## Quick Start

Docker with Compose v2 is the only prerequisite (see
[`docs/operations.md`](docs/operations.md#prerequisites)).

```bash
cp .env.example .env   # optional; the defaults work without changes
docker compose up --build
```

Then open <http://localhost:8080>. If port 8080 is occupied, set
`FRONTEND_HTTP_PORT` — see
[port conflicts](docs/operations.md#port-conflicts).

A fresh database is empty, so the cockpit has nothing to show until an agent
reports something. The included simulator populates it deterministically through
the public route:

```bash
cd simulator
npm install
npm run simulate
```

Then <http://localhost:8080/projects/visualise-ai> shows the complete demo run.
For details, see
[running the demo](docs/operations.md#running-the-demo).

## MCP: read, update, and inspect the model as an image

The current source build exposes **14 tools** at `http://localhost:8080/mcp`.
An MCP client with Streamable HTTP and image support can explicitly open a
context, read and atomically update the shared project model, save views, and
retrieve a native PNG at exact model/view revisions. No user browser needs to
be open. Model changes are not repository code changes; progress and work are
reported separately.

The [MCP guide](docs/mcp-domain-tools.md) includes the complete workflow and an
executable SDK example. [Operations](docs/operations.md) covers configuration,
migration, and limits. These capabilities belong to the source build; older
published images do not automatically include them.

## Published Docker Hub images

The
[`release-dockerhub.yml`](.github/workflows/release-dockerhub.yml) workflow publishes
both application images only for valid release tags in the format
`v<major>.<minor>.<patch>`, with an optional prerelease suffix such as
`v1.2.3-rc.1`. Contract, backend, frontend, simulator, and E2E checks, along with
the Compose build, must succeed before images are pushed.

Configure the `DOCKERHUB_NAMESPACE` variable and the `DOCKERHUB_USERNAME` and
`DOCKERHUB_TOKEN` secrets in the repository settings. No secret is written to
a build argument, image, or log. The two separate Docker Hub repositories are:

- `risqy3d/visualise-ai-backend`
- `risqy3d/visualise-ai-frontend`

A stable tag such as `v1.2.3` produces `1.2.3`, `1.2`, `1`, and `latest`. A
prerelease such as `v1.2.3-rc.1` produces only `1.2.3-rc.1`; stable tags and
`latest` remain unchanged.

You can pull a published image directly:

```bash
docker pull "risqy3d/visualise-ai-backend:1.2.3"
docker pull "risqy3d/visualise-ai-frontend:1.2.3"
```

To start Compose using the published images instead of local source builds:

```bash
IMAGE_TAG=1.2.3 \
  docker compose -f docker-compose.yml -f docker-compose.images.yml pull
IMAGE_TAG=1.2.3 \
  docker compose -f docker-compose.yml -f docker-compose.images.yml up -d --no-build
```

The release publishes only the backend and frontend. PostgreSQL remains the
unchanged internal `postgres:17-alpine` service from the Compose file and is
not published as a Visualise AI image.

## Repository structure

| Path | Contents |
| --- | --- |
| `api/` | OpenAPI contract, example payloads, rejection fixtures |
| `backend/` | Go module: Gin HTTP surface, zerolog, GORM/PostgreSQL |
| `frontend/` | React and TypeScript application built with Vite |
| `frontend/nginx/` | Nginx site configuration — the only external entry point |
| `simulator/` | Node/TypeScript event simulator — the deterministic demo client |
| `e2e/` | Playwright acceptance tests against the real Compose system |
| `docker-compose.yml` | The `frontend`, `backend`, and `postgres` services |
| `docker-compose.images.yml` | Optional Compose override for published images |
| `docs/` | Operations and integration documentation, decision records |

## Network topology

```
Host :8080
     │
     ▼
┌──────────────┐        ┌─────────────┐        ┌──────────────┐
│  frontend    │ ─────▶ │  backend    │ ─────▶ │  postgres    │
│  (nginx)     │        │  (go/gin)   │        │              │
│  published   │        │  internal   │        │  internal    │
└──────────────┘        └─────────────┘        └──────────────┘
```

Nginx serves the production bundle and proxies the following traffic to
the backend:

| Route | Purpose |
| --- | --- |
| `/mcp` | Streamable HTTP: model, work, views, and PNG feedback |
| `POST /api/v1/events` | Compatible event and command ingestion |
| `GET /api/v1/…` | Read models for the UI |
| `GET /api/v1/projects/{id}/stream` | Live SSE stream, proxied **without buffering** |
| `GET /healthz`, `GET /readyz` | Backend probes |

Neither `backend` nor `postgres` publishes a host port. For why this is a
security property rather than a convenience, see
[`docs/security-and-boundaries.md`](docs/security-and-boundaries.md#nginx-is-the-only-entry-point).

## Local development

Only needed when working on the code; Docker is enough to run the application.

Prerequisites: Bash (for example, Git Bash on Windows), Go as specified in
[`backend/go.mod`](backend/go.mod) (currently 1.25.7), Node 24 with npm as used in
[CI](.github/workflows/ci.yml), and running Docker with Compose v2 for database
and E2E tests. The frontend container builds separately with Node 22.

**Backend:** The [backend testing guide](backend/README.md) covers building,
vetting, and running the full test suite from the repository root with a
separate PostgreSQL 17 test database. Without `TEST_DATABASE_URL`,
`go test ./...` skips the database tests.

Start the remaining checks from the repository root too. Each pair of
parentheses opens a subshell, leaving your working directory at the repository root.

```bash
# Frontend
(
  cd frontend &&
  npm ci &&
  npm run lint && npm run typecheck && npm test && npm run build
)

# Simulator
(
  cd simulator &&
  npm ci &&
  npm run lint && npm run typecheck && npm test
)

# Contract
(
  cd api &&
  npm ci &&
  npm test
)

# End-to-end acceptance (details: e2e/README.md)
(
  cd e2e &&
  npm ci && npx playwright install --with-deps chromium &&
  npm test
)
```

`npm run dev` in `frontend/` starts Vite on port 5173 and proxies `/api`,
`/healthz`, and `/readyz` to a backend at `localhost:8080`, matching the paths
used in the Compose deployment.

## License

Visualise AI is licensed under the [MIT License](LICENSE).
Third-party sources retain their respective licenses; the Chromium seccomp
profile has separate license and attribution notices in
[`deploy/chromium/`](deploy/chromium/).
