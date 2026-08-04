/**
 * The architecture model the `self` scenario publishes.
 *
 * Unlike `architecture.ts`, **nothing here is invented**. Every component is a
 * real directory, container or package of this repository, and every
 * relationship is a real import, a real Nginx location block, a real Compose
 * dependency or a real HTTP call. The evidence for each one is named in the
 * comment above it.
 *
 * Two consequences follow, and both are the point of the scenario:
 *
 * * **There is no `nats_topic` relationship and no `queue`/`topic` component.**
 *   This project has no message bus. The contract knows the kind and the `full`
 *   scenario shows it; reporting one here would be a lie, and `self.test.ts`
 *   asserts it never appears.
 * * The snapshot is the model **as it stood before the two changes this run
 *   reports**: `frontend/src/backendStatus.ts` still exists (it was deleted in
 *   PR #19), `frontend/src/api/generated/` does not (it was added in PR #25),
 *   and the Nginx probe edge is missing (the contract claimed until PR #30 that
 *   the probes were not routed through Nginx). Applying the reported changes
 *   ends at the repository as it is today.
 */

import type { Component, Relationship } from './architecture.js'

export const SELF_COMPONENT_IDS = {
  system: 'visualise-ai',
  browser: 'browser',

  nginx: 'visualise-ai.nginx',
  postgres: 'visualise-ai.postgres',
  contract: 'visualise-ai.api-contract',
  simulator: 'visualise-ai.simulator',
  e2e: 'visualise-ai.e2e',

  frontend: 'visualise-ai.frontend',
  frontendApi: 'visualise-ai.frontend.api',
  frontendGenerated: 'visualise-ai.frontend.api.generated',
  frontendCanvas: 'visualise-ai.frontend.canvas',
  frontendComponents: 'visualise-ai.frontend.components',
  frontendInspector: 'visualise-ai.frontend.components.inspector',
  frontendRunAgents: 'visualise-ai.frontend.components.run-agents',
  frontendRoutes: 'visualise-ai.frontend.routes',
  frontendState: 'visualise-ai.frontend.state',
  frontendLib: 'visualise-ai.frontend.lib',
  frontendBackendStatus: 'visualise-ai.frontend.backend-status',

  backend: 'visualise-ai.backend',
  backendCmd: 'visualise-ai.backend.cmd-server',
  backendConfig: 'visualise-ai.backend.config',
  backendDatabase: 'visualise-ai.backend.database',
  backendHealth: 'visualise-ai.backend.health',
  backendHttpapi: 'visualise-ai.backend.httpapi',
  backendIngest: 'visualise-ai.backend.ingest',
  backendLogging: 'visualise-ai.backend.logging',
  backendReadapi: 'visualise-ai.backend.readapi',
  backendSse: 'visualise-ai.backend.sse',
  backendStore: 'visualise-ai.backend.store',

  repositoryProvider: 'visualise-ai.repository-provider',
} as const

const C = SELF_COMPONENT_IDS

/**
 * The components of the snapshot, parent before child.
 *
 * Sources: the repository tree, `docker-compose.yml`, `backend/go.mod`,
 * `frontend/package.json`, `frontend/Dockerfile`, `backend/Dockerfile`,
 * `e2e/package.json` and `simulator/package.json`.
 */
export const SELF_SNAPSHOT_COMPONENTS: Component[] = [
  {
    componentId: C.system,
    name: 'Visualise AI',
    kind: 'system',
    parentComponentId: null,
    description:
      'This repository and the three-container Compose deployment it builds. Root of the component hierarchy.',
  },

  // -- Deployment -----------------------------------------------------------
  {
    // docker-compose.yml service `frontend`; frontend/Dockerfile runtime stage;
    // frontend/nginx/default.conf.template.
    componentId: C.nginx,
    name: 'Nginx Entry Point',
    kind: 'service',
    parentComponentId: C.system,
    description:
      'Compose service `frontend`. Serves the built SPA bundle and proxies the API, the SSE route and the probes to the backend. The only container that publishes a host port.',
    technology: { runtime: 'Nginx', version: '1.29-alpine' },
    tags: ['deployment', 'entry-point'],
  },
  {
    // docker-compose.yml service `postgres`, no `ports:` on purpose.
    componentId: C.postgres,
    name: 'PostgreSQL',
    kind: 'datastore',
    parentComponentId: C.system,
    description:
      'Event log and normalised read models. Publishes no port and is reachable only from inside the Compose network.',
    technology: { runtime: 'PostgreSQL', version: '17-alpine' },
    tags: ['deployment'],
  },

  // -- Contract -------------------------------------------------------------
  {
    // api/openapi.yaml, api/examples/, api/scripts/validate-examples.mjs.
    componentId: C.contract,
    name: 'Event Contract',
    kind: 'library',
    parentComponentId: C.system,
    description:
      '`api/openapi.yaml` — the single authority for the closed v0 event catalogue, the read models and the SSE envelope. Backend, frontend and simulator all resolve against it.',
    technology: { framework: 'OpenAPI', version: '3.1.0' },
    tags: ['contract', 'authority'],
  },

  // -- Frontend -------------------------------------------------------------
  {
    componentId: C.frontend,
    name: 'Cockpit SPA',
    kind: 'ui',
    parentComponentId: C.system,
    description:
      '`frontend/src` — the single page application. Built by Vite and shipped as a static bundle inside the Nginx image.',
    technology: { language: 'TypeScript', framework: 'React', runtime: 'Browser', version: '19' },
    tags: ['frontend'],
  },
  {
    componentId: C.frontendApi,
    name: 'API Client',
    kind: 'module',
    parentComponentId: C.frontend,
    description:
      '`frontend/src/api` — read model queries, the RFC 9457 problem mapping and the `EventSource` live stream with its position cursor.',
    technology: { language: 'TypeScript', framework: 'TanStack Query', version: '5' },
  },
  {
    componentId: C.frontendCanvas,
    name: 'Architecture Canvas',
    kind: 'module',
    parentComponentId: C.frontend,
    description:
      '`frontend/src/canvas` — graph projection, ELK layered layout, edge bundling, the camera policy and the change overlays.',
    technology: { language: 'TypeScript', framework: '@xyflow/react', version: '12' },
  },
  {
    componentId: C.frontendComponents,
    name: 'Workspace Panes',
    kind: 'module',
    parentComponentId: C.frontend,
    description:
      '`frontend/src/components` — the three-pane workspace layout, the shared UI primitives and the pane headers.',
    technology: { language: 'TypeScript', framework: 'radix-ui' },
  },
  {
    componentId: C.frontendInspector,
    name: 'Component Inspector',
    kind: 'module',
    parentComponentId: C.frontendComponents,
    description:
      '`frontend/src/components/workspace/inspector` — feedback, findings, unified diffs grouped by `changeId`, and the sanitising markdown renderer.',
    technology: { language: 'TypeScript', framework: 'react-markdown', version: '10' },
  },
  {
    componentId: C.frontendRunAgents,
    name: 'Run and Agent Pane',
    kind: 'module',
    parentComponentId: C.frontendComponents,
    description:
      '`frontend/src/components/workspace/runAgents` — the agent hierarchy, the run selector, plan revisions and the two progress forms.',
    technology: { language: 'TypeScript' },
  },
  {
    componentId: C.frontendRoutes,
    name: 'Routing',
    kind: 'module',
    parentComponentId: C.frontend,
    description:
      '`frontend/src/routes` — the typed route tree, the search parameters that carry the selection and the error page.',
    technology: { language: 'TypeScript', framework: 'TanStack Router', version: '1' },
  },
  {
    componentId: C.frontendState,
    name: 'Client State',
    kind: 'module',
    parentComponentId: C.frontend,
    description:
      '`frontend/src/state` — the change ledger folded from the live stream, the live connection state, the work states and the local UI store.',
    technology: { language: 'TypeScript', framework: 'Zustand', version: '5' },
  },
  {
    componentId: C.frontendLib,
    name: 'Frontend Utilities',
    kind: 'library',
    parentComponentId: C.frontend,
    description:
      '`frontend/src/lib` — the shared `cn` class-name helper built on clsx and tailwind-merge.',
    technology: { language: 'TypeScript' },
  },
  {
    // Deleted in b40f7f2 (PR #19). Present here because the snapshot describes
    // the model before the changes this run reports.
    componentId: C.frontendBackendStatus,
    name: 'Backend Status Probe Client',
    kind: 'module',
    parentComponentId: C.frontend,
    description:
      '`frontend/src/backendStatus.ts` — the probe client of the Compose scaffold, kept only until the real server-state layer existed.',
    technology: { language: 'TypeScript' },
    tags: ['scaffold'],
  },

  // -- Backend --------------------------------------------------------------
  {
    componentId: C.backend,
    name: 'Backend',
    kind: 'service',
    parentComponentId: C.system,
    description:
      '`backend/` — the single internal Go instance. Publishes no host port; Nginx is the only thing that talks to it.',
    technology: { language: 'Go', framework: 'Gin', runtime: 'Go', version: '1.25.7' },
    tags: ['deployment'],
  },
  {
    componentId: C.backendCmd,
    name: 'Composition Root',
    kind: 'module',
    parentComponentId: C.backend,
    description:
      '`backend/cmd/server` — wires configuration, logging, the database, the broker, the handlers and the router, and owns the ordered shutdown.',
    technology: { language: 'Go' },
  },
  {
    componentId: C.backendHttpapi,
    name: 'HTTP Surface',
    kind: 'module',
    parentComponentId: C.backend,
    description:
      '`backend/internal/httpapi` — the Gin engine, the two probe routes and the `/api/v1` prefix carrying ingestion, the read models and the stream.',
    technology: { language: 'Go', framework: 'Gin', version: '1.12.0' },
  },
  {
    componentId: C.backendIngest,
    name: 'Ingestion',
    kind: 'module',
    parentComponentId: C.backend,
    description:
      '`backend/internal/ingest` — contract validation against the embedded copy of `api/openapi.yaml`, the lifecycle guard, RFC 9457 problems and the post-commit publish hook.',
    technology: { language: 'Go', framework: 'libopenapi-validator' },
  },
  {
    componentId: C.backendReadapi,
    name: 'Read API',
    kind: 'module',
    parentComponentId: C.backend,
    description:
      '`backend/internal/readapi` — the project scoped read models. Every statement filters on `project_id`; component evidence is loaded through join tables.',
    technology: { language: 'Go' },
  },
  {
    componentId: C.backendSse,
    name: 'SSE Stream',
    kind: 'module',
    parentComponentId: C.backend,
    description:
      '`backend/internal/sse` — the in-process broker, the paged replay from the log and the connection that holds `lastSent` across both phases.',
    technology: { language: 'Go' },
  },
  {
    componentId: C.backendStore,
    name: 'Event Store',
    kind: 'module',
    parentComponentId: C.backend,
    description:
      '`backend/internal/store` — the append-only event log, position allocation under the project row lock, content-based idempotency and the synchronous projections.',
    technology: { language: 'Go', framework: 'GORM', version: '1.31.2' },
  },
  {
    componentId: C.backendConfig,
    name: 'Configuration',
    kind: 'module',
    parentComponentId: C.backend,
    description:
      '`backend/internal/config` — the environment variables the container is configured with, parsed once at startup.',
    technology: { language: 'Go' },
  },
  {
    componentId: C.backendDatabase,
    name: 'Database Connection',
    kind: 'module',
    parentComponentId: C.backend,
    description:
      '`backend/internal/database` — opening, pinging and closing the GORM connection to PostgreSQL, with the startup connect timeout.',
    technology: { language: 'Go', framework: 'gorm.io/driver/postgres' },
  },
  {
    componentId: C.backendHealth,
    name: 'Health Checker',
    kind: 'module',
    parentComponentId: C.backend,
    description:
      '`backend/internal/health` — liveness, and readiness that stays false until migrations succeeded.',
    technology: { language: 'Go' },
  },
  {
    componentId: C.backendLogging,
    name: 'Logging',
    kind: 'module',
    parentComponentId: C.backend,
    description: '`backend/internal/logging` — the structured logger, level and format from configuration.',
    technology: { language: 'Go', framework: 'zerolog', version: '1.35.1' },
  },

  // -- Clients --------------------------------------------------------------
  {
    componentId: C.simulator,
    name: 'Event Simulator',
    kind: 'module',
    parentComponentId: C.system,
    description:
      '`simulator/` — the deterministic reference client. Validates every envelope against the contract before sending it and knows exactly one URL.',
    technology: { language: 'TypeScript', runtime: 'Node.js', framework: 'Ajv' },
    tags: ['client', 'tooling'],
  },
  {
    componentId: C.e2e,
    name: 'Acceptance Suite',
    kind: 'module',
    parentComponentId: C.system,
    description:
      '`e2e/` — the mandatory Playwright acceptance run. Builds the real Compose stack, drives it through Nginx in Chromium at 1920 × 1080.',
    technology: { language: 'TypeScript', framework: 'Playwright', runtime: 'Node.js', version: '1.62' },
    tags: ['client', 'tooling'],
  },

  // -- Outside the system boundary -----------------------------------------
  {
    componentId: C.browser,
    name: 'Operator Browser',
    kind: 'external',
    parentComponentId: null,
    description:
      'The desktop browser the cockpit is looked at in. Loads the bundle from Nginx and opens the SSE stream itself.',
  },
]

export const SELF_RELATIONSHIP_IDS = {
  browserBundle: 'rel-browser-nginx-bundle',
  frontendRead: 'rel-frontend-api-nginx-read',
  frontendStream: 'rel-frontend-api-nginx-stream',
  simulatorIngest: 'rel-simulator-nginx-events',
  e2eEntry: 'rel-e2e-nginx-entry',
  e2eSimulator: 'rel-e2e-simulator',

  nginxApi: 'rel-nginx-backend-api',
  nginxStream: 'rel-nginx-backend-stream',
  nginxProbes: 'rel-nginx-backend-probes',

  httpapiIngest: 'rel-httpapi-ingest',
  httpapiReadapi: 'rel-httpapi-readapi',
  httpapiSse: 'rel-httpapi-sse',
  httpapiHealth: 'rel-httpapi-health',
  ingestStore: 'rel-ingest-store',
  readapiStore: 'rel-readapi-store',
  sseStore: 'rel-sse-store',
  sseIngest: 'rel-sse-ingest-envelope',
  ingestPublish: 'rel-ingest-sse-publish',
  storeDb: 'rel-store-postgres',
  databaseDb: 'rel-database-postgres',
  cmdHttpapi: 'rel-cmd-httpapi',
  cmdConfig: 'rel-cmd-config',
  cmdDatabase: 'rel-cmd-database',
  cmdLogging: 'rel-cmd-logging',

  ingestContract: 'rel-ingest-contract',
  simulatorContract: 'rel-simulator-contract',
  frontendApiContract: 'rel-frontend-api-contract',

  canvasApi: 'rel-canvas-api',
  componentsApi: 'rel-components-api',
  stateApi: 'rel-state-api',
  routesApi: 'rel-routes-api',
  routesComponents: 'rel-routes-components',
  componentsCanvas: 'rel-components-canvas',
  componentsState: 'rel-components-state',
  canvasState: 'rel-canvas-state',
  componentsLib: 'rel-components-lib',
  canvasLib: 'rel-canvas-lib',

  fullReplayStream: 'rel-frontend-state-full-replay',
} as const

const R = SELF_RELATIONSHIP_IDS

/**
 * The relationships of the snapshot.
 *
 * `rel-nginx-backend-probes` and `rel-frontend-api-contract` are deliberately
 * absent: the first was denied by the contract until PR #30, the second did not
 * exist until PR #25. Both are added by this run.
 */
export const SELF_SNAPSHOT_RELATIONSHIPS: Relationship[] = [
  // -- Into the entry point -------------------------------------------------
  {
    // frontend/nginx/default.conf.template: `location /` with the SPA fallback
    // and `location /assets/`.
    relationshipId: R.browserBundle,
    sourceComponentId: C.browser,
    targetComponentId: C.nginx,
    kind: 'http',
    label: 'Loads the SPA bundle',
    protocol: 'HTTP',
    operation: 'GET /',
  },
  {
    // frontend/src/api/fetchJson.ts: API_BASE = '/api/v1', same-origin.
    relationshipId: R.frontendRead,
    sourceComponentId: C.frontendApi,
    targetComponentId: C.nginx,
    kind: 'http',
    label: 'Read models',
    protocol: 'HTTP',
    operation: 'GET /api/v1/projects/{projectId}/architecture',
  },
  {
    // frontend/src/api/liveStream.ts: streamUrl() + EventSource.
    relationshipId: R.frontendStream,
    sourceComponentId: C.frontendApi,
    targetComponentId: C.nginx,
    kind: 'http',
    label: 'Live stream, resumed with ?lastEventPosition',
    protocol: 'text/event-stream',
    operation: 'GET /api/v1/projects/{projectId}/stream',
  },
  {
    // simulator/src/runner.ts posts to `<base>/api/v1/events` and nothing else.
    relationshipId: R.simulatorIngest,
    sourceComponentId: C.simulator,
    targetComponentId: C.nginx,
    kind: 'http',
    label: 'Reports agent events',
    protocol: 'HTTP',
    operation: 'POST /api/v1/events',
  },
  {
    // e2e/src/config.ts: BASE_URL is the published Nginx port; e2e/src/api.ts
    // sends every request there.
    relationshipId: R.e2eEntry,
    sourceComponentId: C.e2e,
    targetComponentId: C.nginx,
    kind: 'http',
    label: 'Drives the system under test',
    protocol: 'HTTP',
    operation: 'GET / and POST /api/v1/events',
  },
  {
    // e2e/src/simulator.ts spawns `npm run simulate -- --json` in SIMULATOR_DIR.
    relationshipId: R.e2eSimulator,
    sourceComponentId: C.e2e,
    targetComponentId: C.simulator,
    kind: 'dependency',
    label: 'Spawns the seeded run and reads its positions',
    operation: 'npm run simulate -- --json',
  },

  // -- Nginx to the backend -------------------------------------------------
  // Three separate location blocks of the same file, so three relationships
  // between the same ordered pair rather than one merged "proxy" edge.
  {
    relationshipId: R.nginxApi,
    sourceComponentId: C.nginx,
    targetComponentId: C.backendHttpapi,
    kind: 'http',
    label: 'location /api/',
    protocol: 'HTTP/1.1',
    operation: 'proxy_pass http://backend:8080',
  },
  {
    relationshipId: R.nginxStream,
    sourceComponentId: C.nginx,
    targetComponentId: C.backendHttpapi,
    kind: 'http',
    label: 'SSE location: buffering off, read timeout 24h',
    protocol: 'text/event-stream',
    operation: 'location ~ ^/api/v1/projects/[^/]+/stream$',
  },

  // -- Inside the backend ---------------------------------------------------
  {
    // backend/internal/httpapi/router.go imports internal/ingest.
    relationshipId: R.httpapiIngest,
    sourceComponentId: C.backendHttpapi,
    targetComponentId: C.backendIngest,
    kind: 'dependency',
    label: 'Mounts the ingestion handler',
    operation: 'POST /api/v1/events',
  },
  {
    // backend/internal/httpapi/router.go imports internal/readapi.
    relationshipId: R.httpapiReadapi,
    sourceComponentId: C.backendHttpapi,
    targetComponentId: C.backendReadapi,
    kind: 'dependency',
    label: 'Mounts the project scoped read routes',
  },
  {
    // backend/internal/httpapi/router.go and stream.go import internal/sse.
    relationshipId: R.httpapiSse,
    sourceComponentId: C.backendHttpapi,
    targetComponentId: C.backendSse,
    kind: 'dependency',
    label: 'Mounts the stream handler',
    operation: 'GET /api/v1/projects/{projectId}/stream',
  },
  {
    // backend/internal/httpapi/router.go imports internal/health.
    relationshipId: R.httpapiHealth,
    sourceComponentId: C.backendHttpapi,
    targetComponentId: C.backendHealth,
    kind: 'dependency',
    label: 'Answers the two probe routes',
    operation: 'GET /healthz, GET /readyz',
  },
  {
    // backend/internal/ingest/handler.go and lifecycle.go import internal/store.
    relationshipId: R.ingestStore,
    sourceComponentId: C.backendIngest,
    targetComponentId: C.backendStore,
    kind: 'dependency',
    label: 'AppendGuarded inside one transaction',
  },
  {
    // backend/internal/readapi/{readapi,projects,runs,components}.go import
    // internal/store.
    relationshipId: R.readapiStore,
    sourceComponentId: C.backendReadapi,
    targetComponentId: C.backendStore,
    kind: 'dependency',
    label: 'Reads the normalised projections',
  },
  {
    // backend/internal/sse/reader.go imports internal/store.
    relationshipId: R.sseStore,
    sourceComponentId: C.backendSse,
    targetComponentId: C.backendStore,
    kind: 'dependency',
    label: 'Pages the log during replay',
  },
  {
    // backend/internal/sse/{broker,connection,reader}.go import internal/ingest
    // for the CommittedEvent envelope.
    relationshipId: R.sseIngest,
    sourceComponentId: C.backendSse,
    targetComponentId: C.backendIngest,
    kind: 'dependency',
    label: 'Shares the CommittedEvent envelope',
  },
  {
    // Runtime call, not an import: main.go hands the broker to the handler as
    // its Publisher, and the handler calls it once per committed event.
    relationshipId: R.ingestPublish,
    sourceComponentId: C.backendIngest,
    targetComponentId: C.backendSse,
    kind: 'async',
    label: 'Publishes after commit, never before and never for a duplicate',
    operation: 'Publisher.Publish(CommittedEvent)',
  },
  {
    relationshipId: R.storeDb,
    sourceComponentId: C.backendStore,
    targetComponentId: C.postgres,
    kind: 'data',
    label: 'Append and projections in one transaction',
    protocol: 'postgresql',
    operation: 'SELECT … FOR UPDATE, INSERT events, UPSERT projections',
  },
  {
    // backend/internal/database/database.go opens, pings and closes the pool.
    relationshipId: R.databaseDb,
    sourceComponentId: C.backendDatabase,
    targetComponentId: C.postgres,
    kind: 'data',
    label: 'Connection pool and readiness ping',
    protocol: 'postgresql',
  },
  {
    // backend/cmd/server/main.go imports httpapi, config, database and logging
    // (and everything else it wires).
    relationshipId: R.cmdHttpapi,
    sourceComponentId: C.backendCmd,
    targetComponentId: C.backendHttpapi,
    kind: 'dependency',
    label: 'Builds the router and runs the server',
  },
  {
    relationshipId: R.cmdConfig,
    sourceComponentId: C.backendCmd,
    targetComponentId: C.backendConfig,
    kind: 'dependency',
    label: 'Loads the environment before anything else',
  },
  {
    relationshipId: R.cmdDatabase,
    sourceComponentId: C.backendCmd,
    targetComponentId: C.backendDatabase,
    kind: 'dependency',
    label: 'Opens the connection and migrates before readiness',
  },
  {
    relationshipId: R.cmdLogging,
    sourceComponentId: C.backendCmd,
    targetComponentId: C.backendLogging,
    kind: 'dependency',
    label: 'Creates the structured logger',
  },

  // -- The drift guards -----------------------------------------------------
  {
    // backend/internal/ingest/contract.go embeds contract/openapi.yaml, and
    // TestEmbeddedContractMatchesTheAuthority asserts it is byte-identical.
    relationshipId: R.ingestContract,
    sourceComponentId: C.backendIngest,
    targetComponentId: C.contract,
    kind: 'dependency',
    label: 'Embedded copy, guarded byte for byte by a test',
  },
  {
    // simulator/src/contract.ts walks up to api/openapi.yaml and validates every
    // envelope against it before it reaches the network.
    relationshipId: R.simulatorContract,
    sourceComponentId: C.simulator,
    targetComponentId: C.contract,
    kind: 'dependency',
    label: 'Validates every envelope before sending it',
  },

  // -- Inside the frontend --------------------------------------------------
  {
    relationshipId: R.canvasApi,
    sourceComponentId: C.frontendCanvas,
    targetComponentId: C.frontendApi,
    kind: 'dependency',
    label: 'Read model types and the live stream hook',
  },
  {
    relationshipId: R.componentsApi,
    sourceComponentId: C.frontendComponents,
    targetComponentId: C.frontendApi,
    kind: 'dependency',
    label: 'Queries, problems and read model types',
  },
  {
    relationshipId: R.stateApi,
    sourceComponentId: C.frontendState,
    targetComponentId: C.frontendApi,
    kind: 'dependency',
    label: 'Folds StreamedEvent into the change ledger',
  },
  {
    relationshipId: R.routesApi,
    sourceComponentId: C.frontendRoutes,
    targetComponentId: C.frontendApi,
    kind: 'dependency',
    label: 'Route loaders call ensureQueryData',
  },
  {
    relationshipId: R.routesComponents,
    sourceComponentId: C.frontendRoutes,
    targetComponentId: C.frontendComponents,
    kind: 'dependency',
    label: 'Pages render the workspace panes',
  },
  {
    relationshipId: R.componentsCanvas,
    sourceComponentId: C.frontendComponents,
    targetComponentId: C.frontendCanvas,
    kind: 'dependency',
    label: 'The centre pane hosts the canvas',
  },
  {
    relationshipId: R.componentsState,
    sourceComponentId: C.frontendComponents,
    targetComponentId: C.frontendState,
    kind: 'dependency',
    label: 'Work states, the UI store and the connection state',
  },
  {
    relationshipId: R.canvasState,
    sourceComponentId: C.frontendCanvas,
    targetComponentId: C.frontendState,
    kind: 'dependency',
    label: 'Work states, temporary positions and the change ledger',
  },
  {
    relationshipId: R.componentsLib,
    sourceComponentId: C.frontendComponents,
    targetComponentId: C.frontendLib,
    kind: 'dependency',
    label: 'The cn class-name helper',
  },
  {
    relationshipId: R.canvasLib,
    sourceComponentId: C.frontendCanvas,
    targetComponentId: C.frontendLib,
    kind: 'dependency',
    label: 'The cn class-name helper',
  },
]

// ---------------------------------------------------------------------------
// What the run changes
// ---------------------------------------------------------------------------

/**
 * Added by PR #25: `frontend/src/api/generated/contract.ts`, produced by
 * `openapi-typescript` and committed because the frontend image builds with
 * `frontend/` as its Docker context.
 */
export const GENERATED_TYPES_COMPONENT: Component = {
  componentId: C.frontendGenerated,
  name: 'Generated Contract Types',
  kind: 'library',
  parentComponentId: C.frontendApi,
  description:
    '`frontend/src/api/generated/contract.ts` — produced by openapi-typescript from `api/openapi.yaml`. Committed, and guarded by `contractDrift.test.ts`, which regenerates and compares byte for byte.',
  technology: { language: 'TypeScript', framework: 'openapi-typescript', version: '7.13.0' },
  tags: ['generated', 'contract'],
}

/** The edge that makes the frontend a consumer of the contract (PR #25). */
export const FRONTEND_CONTRACT_RELATIONSHIP: Relationship = {
  relationshipId: R.frontendApiContract,
  sourceComponentId: C.frontendApi,
  targetComponentId: C.contract,
  kind: 'dependency',
  label: 'Generated types, guarded by contractDrift.test.ts',
  operation: 'npm run check:contract',
}

/** The component PR #19 deleted. */
export const BACKEND_STATUS_COMPONENT: Component = {
  componentId: C.frontendBackendStatus,
  name: 'Backend Status Probe Client',
  kind: 'module',
  parentComponentId: C.frontend,
  description: '`frontend/src/backendStatus.ts` — superseded by the server-state layer.',
}

/**
 * The edge PR #30 established as true. Until then the contract stated the two
 * probes were "not routed through the Nginx frontend and therefore not
 * reachable from outside the Compose network"; the site config proxies both.
 */
export const NGINX_PROBES_RELATIONSHIP: Relationship = {
  relationshipId: R.nginxProbes,
  sourceComponentId: C.nginx,
  targetComponentId: C.backendHttpapi,
  kind: 'http',
  label: 'Container probes, reachable from the published port',
  protocol: 'HTTP/1.1',
  operation: 'GET /healthz, GET /readyz',
}

/**
 * The proposal that is planned and then withdrawn: a stream opened with
 * `?lastEventPosition=0` on every page load, so the change ledger would describe
 * the whole project rather than only what the cockpit watched. ADR 0010 records
 * that this was considered and rejected.
 */
export const FULL_REPLAY_RELATIONSHIP: Relationship = {
  relationshipId: R.fullReplayStream,
  sourceComponentId: C.frontendState,
  targetComponentId: C.nginx,
  kind: 'http',
  label: 'Full replay per page load, so the ledger covers the whole project',
  protocol: 'text/event-stream',
  operation: 'GET /api/v1/projects/{projectId}/stream?lastEventPosition=0',
}

/**
 * The proposal that stays open.
 *
 * `docs/security-and-boundaries.md` states that v0 contains no repository
 * access and no `RepositoryProvider` interface, and describes only *where* a
 * later attachment would sit: as a resolver of a reported diff against a
 * repository, never as a second data source next to the event log. Nothing
 * about its signature, its place in the code or its transport is decided, which
 * is exactly why this stays a proposal.
 */
export const REPOSITORY_PROVIDER_COMPONENT: Component = {
  componentId: C.repositoryProvider,
  name: 'Repository Provider',
  kind: 'external',
  parentComponentId: null,
  description:
    'Proposed attachment point for a forge (GitHub, GitLab, Gitea). It would resolve a reported `filePath` and diff against a repository; the event log stays the authority on what the agent claimed. Not part of v0 — see docs/security-and-boundaries.md.',
  tags: ['proposed', 'not-in-v0'],
}
