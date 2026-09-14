# Operations

How to run the cockpit locally or on a private network: prerequisites,
startup, configuration, health checks, data, and demos.

Before making the system accessible to anyone else, read
[`security-and-boundaries.md`](./security-and-boundaries.md). There is no
authentication.

## Prerequisites

| Tool | Purpose | Notes |
| --- | --- | --- |
| Docker Engine | Operation | Local #83 acceptance: 27.5.1 |
| Docker Compose | Operation | Use the plugin (`docker compose …`), not the old `docker-compose`. Local #83 acceptance: 2.32.4-desktop.1 |

Nothing else is required **to run the system**. Compose builds the backend and
frontend in containers. The simulator runs on the host; it and the executable
SDK client require Node. Go and Node are also development tools (see
[Running the demo](#running-the-demo) and the "Local development" section in the
[README](../README.md#local-development)).

The cockpit is desktop-only. The required acceptance resolution is 1920 × 1080 in
Chromium.

## Starting from a fresh checkout

```bash
git clone <repository-url> visualise-ai
cd visualise-ai
cp .env.example .env          # optional; the defaults work unchanged
docker compose up --build
```

The first build downloads the base images and compiles the Go backend and
Vite bundle; this takes a few minutes. The services then start in a fixed
order: `postgres` must be healthy before `backend` starts, and `backend`
must be healthy before `frontend` starts.

Running `docker compose up` without `-d` displays logs from all three
services. To run in the background:

```bash
docker compose up --build -d
docker compose ps             # status of all services
docker compose logs -f backend
docker compose down           # stops everything; data is retained
```

Once `frontend` is healthy, the interface is available at <http://localhost:8080>.

## Running the demo

A fresh database is empty. The cockpit does not invent anything, so there is
nothing to see until an agent reports something. The included simulator reports
a complete, deterministic run through the same public route used by a real agent.

It runs on the host and requires Node 24 with npm, matching the
simulator check in CI:

```bash
cd simulator
npm install
npm run simulate
```

If the frontend runs on a different port, the simulator needs its base URL:

```bash
npm run simulate -- --base http://localhost:8101
```

Afterwards, <http://localhost:8080/projects/visualise-ai> shows the run: the
architecture on the canvas, the agent hierarchy on the left, and the component
inspector on the right after clicking a component.

### Flags

| Flag | Meaning | Default |
| --- | --- | --- |
| `--base <url>` | Public entry point, scheme and host only | `http://localhost:8080` |
| `--project <id>` | Project to report to | Scenario's project |
| `--run <id>` | Run ID | Scenario's run ID |
| `--speed <factor>` | Delay multiplier: `1` normal, `0` no delays, `2` twice as slow | `1` |
| `--scenario <name>` | `full`, `retry`, `conflict`, or `self` | `full` |
| `--seed <n>` | Seed for the ID, delay, and clock streams | `20260804` |
| `--finish <bool>` | Whether the `full` run sends `run.finished` | `false` |
| `--json` | Machine-readable summary on stdout, narrative on stderr | off |

### Scenarios

| Scenario | Project | Demonstrates |
| --- | --- | --- |
| `full` | `visualise-ai` | The representative run: 62 events, every legacy event type except the optional `run.finished` |
| `retry` | `visualise-ai-retry` | `201`, followed by a byte-identical retry with `200 duplicate: true` and **the same** position |
| `conflict` | `visualise-ai-conflict` | The same `clientEventId` with different content: `409 client_event_id_conflict` |
| `self` | `visualise-ai-self` | This repository itself: 122 events, 28 components, 35 relationships, 10 agents, 7 diffs — none of them invented |

Each scenario writes to a separate project with its own root orchestrator, so
none overwrites another scenario's current run.

`full` is deliberately fictional: a shop platform with an orders service,
payment provider, and two NATS topics, because the scenario must demonstrate every
structural feature of the contract — including those this project does not use.

`self` does the opposite. Every component comes from the file tree,
`docker-compose.yml`, `backend/go.mod`, and `frontend/package.json`; every relationship
comes from a real Go or TypeScript import or a `location` block in the
Nginx configuration; agents and the plan come from the sixteen merged pull requests
of Epic #1; feedback, risks, and problems come from the ADRs under `docs/decisions/`;
and the diffs come from `git show`. Where the evidence ends, the model ends: **there
is no `nats_topic` relationship**, because there is no message bus here, and a test
explicitly rejects it. See
[`simulator/README.md`](../simulator/README.md#self--the-cockpit-on-its-own-architecture)
for details.

```bash
npm run simulate -- --scenario self
```

**All four scenarios require an empty project.** Against an already populated
database, the first delivery is legitimately a duplicate — correct behavior,
but not what the scenarios claim to demonstrate. Only for an explicitly disposable
demo/test stack, before a repeat run:

```bash
docker compose down -v && docker compose up --build -d
```

Repeated runs against an empty database produce the same semantic sequence:
the same events, the same positions, and therefore the same read models.
Client event IDs, delays, and timestamps come from separate seeded
generators. See [`simulator/README.md`](../simulator/README.md) for further details.

## Configuration

All settings are environment variables. `docker compose` reads them
automatically from a `.env` file in the project directory;
[`.env.example`](../.env.example) is the annotated template. Every value is
optional — the defaults allow `docker compose up --build` to work in a fresh
checkout.

| Variable | Purpose | Default | When to change |
| --- | --- | --- | --- |
| `FRONTEND_HTTP_PORT` | The only host port published by the deployment. Nginx always listens on 8080 inside the container; this variable only determines its host port mapping. | `8080` | For [port conflicts](#port-conflicts) or when running multiple stacks in parallel |
| `MAX_REQUEST_BODY_SIZE` | Largest request body Nginx allows, in Nginx notation (`4m`, `16m`). This is the entry point's limit, not the contract's. Must remain above `MAX_EVENT_BYTES`. | `4m` | Together with `MAX_EVENT_BYTES` — see the warning below |
| `POSTGRES_USER` | Database user. Also used in the `DATABASE_URL` assembled by Compose. | `visualise` | Almost never — the database is not externally accessible |
| `POSTGRES_PASSWORD` | This user's password | `visualise` | Almost never; see above |
| `POSTGRES_DB` | Database name | `visualise` | Almost never |
| `BACKEND_VERSION` | Backend image build argument. Returned as `version` by `/healthz` and `/readyz`. | `dev` | When building a tagged image and you want to identify the running version |
| `BACKEND_LOG_LEVEL` | zerolog level: `trace`, `debug`, `info`, `warn`, `error` | `info` | Set to `debug` for troubleshooting |
| `BACKEND_LOG_FORMAT` | `json` (machine-readable) or `console` (human-readable) | `json` | Set to `console` when reading logs locally. Any other value causes the backend to fail at startup |
| `DATABASE_CONNECT_TIMEOUT` | How long the backend waits for PostgreSQL at startup before failing. Go duration (`60s`, `2m`). | `60s` | Increase on slow machines |
| `MAX_EVENT_BYTES` | Maximum size of an individual ingested event in bytes | `2097152` (2 MiB) | When agents report larger snapshots or diffs — see the warning below |
| `SHUTDOWN_TIMEOUT` | Grace period for active requests during shutdown. Go duration. | `15s` | Rarely |
| `MCP_ALLOWED_HOSTS` | Comma-separated exact `host[:port]` values, without wildcards | Compose: `localhost`, `127.0.0.1`, `[::1]`, each with `FRONTEND_HTTP_PORT` | Custom hostname or private reverse proxy |
| `MCP_ALLOWED_ORIGINS` | Exact origins including scheme and external port, without a path | Compose: `http://` plus the same hosts/ports | Browser access through a different origin |
| `MCP_REQUEST_TIMEOUT` | Deadline for an MCP method call | `45s` | When deliberately choosing different transport limits |
| `MCP_SESSION_TIMEOUT` | SDK session timeout; not a domain-level run timeout | `5m` | When deliberately choosing a different session lifetime |
| `RENDER_ENTRY_URL` | Trusted production frontend entry point | Compose sets `http://frontend:8080/render.html`; a directly run backend without this value offers only 13 tools | Running the backend directly outside Compose |
| `RENDER_BROWSER_PATH` | Chromium binary | `/usr/bin/chromium` | Custom local installation outside Compose |
| `DATABASE_URL` | Full PostgreSQL DSN. Assembled by `docker-compose.yml` from the `POSTGRES_*` values. | assembled | Only when the backend should use a different database |

`HTTP_ADDR` (the backend's listen address, `:8080`) is fixed in
`docker-compose.yml` and deliberately absent from `.env.example`: the
container port is part of the topology, not the configuration.

`IMAGE_TAG` is used only by the optional Compose override for published images.
The override uses the fixed Docker Hub namespace `risqy3d`; the
normal local startup still builds from `./backend` and `./frontend`.

> **Increasing `MAX_EVENT_BYTES` alone is not enough.** Nginx sits in front of the
> backend and limits the request body to `MAX_REQUEST_BODY_SIZE` (default `4m`). An
> event exceeding that limit is rejected at the entry point and never reaches the
> backend. Increase both values together and keep `MAX_REQUEST_BODY_SIZE`
> above `MAX_EVENT_BYTES`.
>
> For REST, Nginx also responds with `application/problem+json` and
> `code: event_too_large` in this case, so an agent can handle the rejection in
> the same way as one from the backend.

## MCP access and native rendering

Source-built Compose offers 14 tools at `http://localhost:8080/mcp` using the
official Go SDK 1.7.0. The verified TypeScript client uses SDK 1.30.0.
The stateful transport negotiates 2025-11-25 and supports the older versions
listed in [ADR 0030](decisions/0030-official-mcp-http-transport.md), but not
2026-07-28 in this mode. Independently, the domain version is
`contractVersion: "2.0.0"`. Configuration and an executable PNG workflow are
in [MCP domain tools](mcp-domain-tools.md).

Host and origin must match the **external** URL; port 8101 is not port
8080. Nginx forwards the original host including the port. A native client
without an origin is allowed, but must use an allowed host. These checks
are not authentication. For a host deliberately used on a private network,
such as `cockpit.lan:8101`, set the following in addition to the published port:

```dotenv
FRONTEND_HTTP_PORT=8101
MCP_ALLOWED_HOSTS=cockpit.lan:8101
MCP_ALLOWED_ORIGINS=http://cockpit.lan:8101
```

Regardless of `MAX_EVENT_BYTES`, MCP accepts request bodies of at most 1 MiB;
structured results also have a 1 MiB limit. The six typed REST commands with
`schemaVersion: "2.0"` likewise have a fixed 1 MiB limit in addition to the
configurable event limit. A decoded PNG must not exceed 4 MiB. An MCP request
exceeding the Nginx limit returns HTTP 413 as plain text; it is neither a REST
problem nor a domain receipt. A tool error uses `isError: true` and the
structured error format.

The backend image includes Chromium and fonts, runs as non-root, and does not
require an open user browser. Compose sets `init: true` and 256 MiB of shared
memory for browser processes. The renderer loads only the configured entry
point and renders with the native React/ELK pipeline. Without `RENDER_ENTRY_URL`,
the render tool is not offered when running the backend directly.

Compose uses the versioned Seccomp profile under `deploy/chromium/` for the
backend service. This directory must also be present alongside the Compose
files in deployments using the image override. Profile maintenance and checks
of Chromium's actual active sandbox state are described in
[native rendering](native-rendering.md).

Each backend allows two concurrent render jobs, with no queue.
The fixed deadline is 30 seconds including the snapshot and browser startup;
an earlier request cancellation terminates the job. Size and detail limits,
the meaning of `clipped`, and the IDs actually visible in the output are described
in [native rendering](native-rendering.md). These limits and session timeouts
do not change any work status. Model changes are not code changes.

## Published Docker Hub images

The release workflow
([`.github/workflows/release-dockerhub.yml`](../.github/workflows/release-dockerhub.yml))
describes publishing; the new MCP/render capabilities documented here apply
to source builds and must not be assumed for older images. It triggers only
on tags of the form `v<major>.<minor>.<patch>` with an optional prerelease,
such as `v1.2.3` or `v1.2.3-rc.1`. Branch and pull request events do not
publish anything.

Before publishing, the existing CI and E2E workflows run as a combined gate:
the API contract, backend build/vet/tests, frontend locale checks, lint,
typecheck, tests and build, simulator checks, Playwright E2E, and the build
of both Dockerfiles must succeed. If configuration is missing, the workflow
fails with the missing names without printing secret values.

The following values are required in the repository settings:

| Setting | Value |
| --- | --- |
| Variable `DOCKERHUB_NAMESPACE` | Docker Hub namespace, without image names |
| Secret `DOCKERHUB_USERNAME` | Docker Hub username or machine account |
| Secret `DOCKERHUB_TOKEN` | Personal access token with push permissions |

The workflow uses only these separate repositories:
`risqy3d/visualise-ai-backend` and `risqy3d/visualise-ai-frontend`. A stable
`v1.2.3` produces the tags `1.2.3`, `1.2`, `1`, and `latest`. A prerelease such as
`v1.2.3-rc.1` produces only `1.2.3-rc.1`; it does not overwrite stable versions or
`latest`. Both images carry OCI labels for source, revision, version, and
creation time; the backend receives the version without the leading `v` as a
build argument.

An image can be inspected or pulled directly:

```bash
docker pull "risqy3d/visualise-ai-backend:1.2.3"
docker pull "risqy3d/visualise-ai-frontend:1.2.3"
```

The optional [`docker-compose.images.yml`](../docker-compose.images.yml) override
uses the images published under the fixed `risqy3d` namespace. `IMAGE_TAG`
defaults to `latest`:

```bash
IMAGE_TAG=1.2.3 \
  docker compose -f docker-compose.yml -f docker-compose.images.yml pull
IMAGE_TAG=1.2.3 \
  docker compose -f docker-compose.yml -f docker-compose.images.yml up -d --no-build
```

The override replaces only the backend and frontend. PostgreSQL remains the
internal `postgres:17-alpine` service; no Visualise-AI image is published for it.

All values are validated at startup. An unparseable or non-positive value
causes the backend to fail instead of silently falling back to the default —
and a failed backend is never routed as ready (see below).

### `POSTGRES_*` values have no effect after the first startup

The official PostgreSQL image initializes the user and database only when the
`pgdata` volume is empty. Changing `POSTGRES_USER`, `POSTGRES_PASSWORD`, or
`POSTGRES_DB` later changes the `DATABASE_URL` assembled by Compose, but not
the database — the backend can then no longer log in and never becomes ready.
Change existing credentials using PostgreSQL tools, then update the backend
configuration accordingly. The volume is not recreated during an upgrade.
`down -v` is suitable only for disposable test data and deletes all data.

## Health checks and readiness

The backend separates two different questions:

| Endpoint | Answers | Response |
| --- | --- | --- |
| `GET /healthz` | Is the process running and responding? PostgreSQL is **not** accessed. | Always `200 {"status":"ok","version":"…"}` while the process is serving |
| `GET /readyz` | Is startup complete **and** is PostgreSQL currently responding? | `200 {"status":"ready","version":"…"}`, otherwise `503` |

Startup includes schema migration (GORM `AutoMigrate`). It runs before the
readiness flag is set — a failed migration therefore means the backend never
reports ready.

The Compose topology builds on this:

- The `backend` container's health check probes `/readyz`, not `/healthz`.
  It has a `start_period` of 60 s so that waiting for PostgreSQL does not count
  as a failure.
- `frontend` declares `depends_on: backend: condition: service_healthy`.
- `backend` declares the same for `postgres`, whose health check runs `pg_isready`.

**A backend that fails to start is therefore never routed as ready.** It does
not become healthy, so the frontend does not start. The visible trade-off:
while the backend is down, the interface is inaccessible instead of serving a
shell that returns 502 for every request. For an observation tool with exactly
one instance, this is intentional — an interface that knows nothing but appears
to know something would be worse than none.

Both probes are also accessible through Nginx, which is useful for a script
waiting for the system:

```bash
curl -fsS http://localhost:8080/readyz
```

## Data persistence

PostgreSQL stores its data in the named volume `pgdata` (under the
Compose project name, so `visualise-ai_pgdata` by default).

| Command | Effect |
| --- | --- |
| `docker compose down` | Containers and the network are removed. **The volume remains** — all events are available again on the next `up`. |
| `docker compose down -v` | The volume is also deleted. The next startup begins with an empty database. |

The event log is append-only and is the audit source; v0 offers no deletion
of individual events, export, or backup command. To back up the data, back
up the volume using Docker's built-in tools.

`down -v` is suitable only for disposable simulator/acceptance fixtures,
never as an upgrade step. Use a dedicated Compose project name for these fixtures.

### Upgrading existing projects

Back up data before an upgrade and keep the existing PostgreSQL volume:
`docker compose up --build -d` updates the application containers. The repeatable
startup migration preserves the event log and projections. Existing projects
start the new revision counter at model revision 0 with a recorded activation
position; accepted revisions are not reset on restarts.

Current and historically materialized element IDs remain reserved. Planned IDs
that were never materialized remain available; deleted views retain tombstones.
Missing references, cycles, and ambiguous historical reuse remain diagnosable
instead of being silently repaired by migration. New model writes must produce
a valid complete graph. An explicit repair batch or a valid replacement snapshot
corrects legacy data without renaming historical identities or deleting history.

Work step assignments are reconstructed per run from attributable accepted starts
and effective corrections. Legacy links that cannot be attributed remain as
evidence with an empty run ID. There is no general log replay or automatic graph
repair command. Details:
[Model migration](model-command-implementation.md), [work context](mcp-domain-tools.md).

## Port conflicts

The default host port is **8080**. If it is occupied, `docker compose up` fails
with a bind error. `FRONTEND_HTTP_PORT` overrides it:

```bash
FRONTEND_HTTP_PORT=8101 docker compose up --build -d
# or permanently in .env: FRONTEND_HTTP_PORT=8101
```

Inside the container, Nginx continues listening on 8080; only the host mapping
changes. Everything that points to the base URL must be updated: the browser,
the simulator's `--base`, and the end-to-end test's base URL.

To run multiple stacks in parallel, each also needs a unique Compose project
name so that containers and volumes do not overwrite one another:

```bash
FRONTEND_HTTP_PORT=8101 docker compose -p my-stack up --build -d
FRONTEND_HTTP_PORT=8101 docker compose -p my-stack down
```

## End-to-end acceptance (Playwright)

The [acceptance matrix](epic-75-acceptance.md) documents the verified local state
and measurement conditions. A local run is not evidence of a remote CI run or
a published release version.

The mandatory acceptance test runs in Chromium at 1920 × 1080 against the real
Compose system with an empty database:

```bash
cd e2e
npm install
npx playwright install chromium
npm test
```

A failure blocks the v0 release. The test's structure, prerequisites, and
configuration are described in [`e2e/README.md`](../e2e/README.md); this section
intentionally covers only invocation.

The test starts and stops its own stack — under the Compose project name
`vai-e2e` and on port `8100`, so it neither uses an existing development stack
on `8080` nor deletes it during cleanup.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `docker compose up` fails with "port is already allocated" | Port 8080 is occupied — see [port conflicts](#port-conflicts) |
| `frontend` does not start; `backend` remains `starting` or `unhealthy` | The backend is not becoming ready. `docker compose logs backend` shows the reason: invalid configuration, failed migration, or no database connection |
| The interface loads but shows no projects | The database is empty. This is the correct state — run the [demo](#running-the-demo) or have an agent report |
| The simulator reports `200 duplicate: true` instead of `201` | The project is already populated. Clear only a disposable demo stack with `down -v`; keep production data |
| Ingestion responds with `422 unknown_agent` | The reporting agent did not send `agent.started` first — see [agent integration](./agent-integration.md#lifecycle) |
| The SSE stream remains silent although events arrive | The stream was opened without a cursor and starts at the live end. Set `lastEventPosition=0` for history — see [SSE](./agent-integration.md#sse-streaming-and-reconnection) |
