/**
 * The unified diffs the `self` scenario reports.
 *
 * **Every diff below was taken out of this repository's git history** with
 * `git show <commit> -- <path>` and shortened to a meaningful excerpt. Where an
 * excerpt is shorter than the original hunk, the hunk header was recomputed so
 * the counts still describe the lines that are actually there.
 *
 * The commits:
 *
 * * `a36a9cb` — [v0] Frontend-Read-Model-Typen aus dem OpenAPI-Vertrag
 *   generieren (#25): `frontend/package.json`, `frontend/src/api/types.ts`,
 *   `frontend/src/api/generated/contract.ts`
 * * `b40f7f2` — [v0] Frontend-Shell, Routing und Server-State-Grundlage
 *   erstellen (#19): deletion of `frontend/src/backendStatus.ts`
 * * `5593ffa` — Vertrag und Einstiegspunkt an das tatsächliche Verhalten
 *   angleichen (#30): `api/openapi.yaml`, `frontend/nginx/default.conf.template`
 * * `f8303fb` — [v0] PostgreSQL Event Store und normalisierte Read Models
 *   implementieren (#18): `backend/internal/store/store.go`
 */

import { SELF_COMPONENT_IDS as C } from './selfArchitecture.js'
import type { DiffFile } from './diffs.js'

/**
 * The three logical changes this run reports. Files of one change share a
 * `changeId`, which is what the inspector groups on.
 */
export const SELF_CHANGE_IDS = {
  /** PR #25: hand-written read model types replaced by generated ones. */
  generateContractTypes: 'change-pr-25-generate-contract-types',
  /** PR #19: the Compose scaffold's probe client removed. */
  dropBackendStatus: 'change-pr-19-drop-backend-status',
  /** PR #30: contract and entry point aligned with what actually happens. */
  alignProbeReachability: 'change-pr-30-align-probe-reachability',
  /** ADR 0010: full replay per page load, planned and withdrawn. */
  fullReplayPerPageLoad: 'change-adr-0010-full-replay-per-page-load',
  /** docs/security-and-boundaries.md: the documented attachment point. */
  repositoryProvider: 'change-repository-provider-attachment',
} as const

// ---------------------------------------------------------------------------
// PR #25 — three files, one changeId
// ---------------------------------------------------------------------------

export const PACKAGE_JSON_DIFF: DiffFile = {
  diffId: 'diff-pr-25-package-json',
  changeId: SELF_CHANGE_IDS.generateContractTypes,
  componentIds: [C.frontendApi, C.frontendGenerated],
  filePath: 'frontend/package.json',
  unifiedDiff: [
    '--- a/frontend/package.json',
    '+++ b/frontend/package.json',
    '@@ -9,7 +9,9 @@',
    '     "preview": "vite preview",',
    '     "typecheck": "tsc --build --force",',
    '     "lint": "eslint .",',
    '-    "test": "vitest run"',
    '+    "test": "vitest run",',
    '+    "generate:contract": "node scripts/generate-contract.mjs",',
    '+    "check:contract": "node scripts/generate-contract.mjs --check"',
    '   },',
    '   "dependencies": {',
    '     "@tanstack/react-query": "^5.101.4",',
    '@@ -42,6 +44,7 @@',
    '     "eslint-plugin-react-refresh": "^0.4.24",',
    '     "globals": "^16.5.0",',
    '     "jsdom": "^28.0.0",',
    '+    "openapi-typescript": "^7.13.0",',
    '     "tailwindcss": "^4.3.3",',
    '     "tw-animate-css": "^1.4.0",',
    '     "typescript": "~5.9.0",',
    '',
  ].join('\n'),
}

export const TYPES_DIFF: DiffFile = {
  diffId: 'diff-pr-25-api-types',
  changeId: SELF_CHANGE_IDS.generateContractTypes,
  componentIds: [C.frontendApi, C.contract],
  filePath: 'frontend/src/api/types.ts',
  unifiedDiff: [
    '--- a/frontend/src/api/types.ts',
    '+++ b/frontend/src/api/types.ts',
    '@@ -1,21 +1,33 @@',
    ' /**',
    '  * Domain and read-model types of the cockpit.',
    '  *',
    '- * Everything here is derived by hand from `api/openapi.yaml` — there is',
    '- * deliberately **no code generation step**, so the Docker build stays a plain',
    '- * `npm ci && npm run build` with no generator in between.',
    '+ * **Nothing in this file describes a shape.** Every type below is an alias for a',
    '+ * schema of `api/openapi.yaml`, resolved through the generated module',
    '+ * `./generated/contract.ts`. The contract is the authority; when a name here',
    '+ * differs from a name there, this file is wrong.',
    '  *',
    '- * Two groups live in this file:',
    '+ * This indirection exists so the rest of the app writes `ActiveChange` instead',
    "+ * of `components['schemas']['ActiveChange']`, and so a renamed schema shows up",
    '+ * as a compile error in exactly one place.',
    '  *',
    '- * 1. Types that appear verbatim in the event contract (`Component`,',
    '- *    `Relationship`, `PlanStep`, `Technology`, every event payload and the',
    '- *    streamed envelope). They must stay byte-compatible with the contract.',
    '- * 2. Read models (`ProjectSummary`, `Agent`, `Plan`, `ActiveChange`, …). The',
    '- *    read API projects the event log into these shapes; it is specified in the',
    '- *    issue and implemented server-side in #8. They are folds over the events of',
    '- *    group 1 and never introduce information the contract cannot carry.',
    '+ * Why the aliases are not hand-written any more: they were, and they drifted.',
    '+ * `ActiveChange` alone had a `target`/`componentId`/`relationshipId` triple the',
    '+ * contract never had (`targetKind`/`targetId`), lacked `snapshot`, and was',
    '+ * missing the `retracted` state. See',
    '+ * `docs/decisions/0009-generated-frontend-contract-types.md`.',
    '  *',
    '- * Nothing in the cockpit is inferred: a field is `null` when no agent reported',
    '- * it, never a guess.',
    '+ * Two vocabularies live in the contract and must not be confused:',
    '+ *',
    '+ * * **Event descriptors** — `Component`, `Relationship`, `PlanStep`, every',
    '+ *   `*Payload`: what an agent reports.',
    '+ * * **Read models** — `AppliedComponent`, `AppliedRelationship`, `RunAgent`,',
    '+ *   `RunPlan`, `ActiveChange`, …: what the read API projects out of the log.',
    '+ *   They carry provenance (`appliedAt`, `appliedByAgentId`, `position`) that an',
    '+ *   event descriptor does not have, and they report "nothing was reported" as an',
    '+ *   empty string or `null` rather than by omitting the field.',
    '  */',
    ' ',
    "+import type { components } from './generated/contract'",
    '+',
    "+type Schemas = components['schemas']",
    '+',
    '',
  ].join('\n'),
}

export const GENERATED_TYPES_DIFF: DiffFile = {
  diffId: 'diff-pr-25-generated-contract',
  changeId: SELF_CHANGE_IDS.generateContractTypes,
  componentIds: [C.frontendGenerated],
  filePath: 'frontend/src/api/generated/contract.ts',
  unifiedDiff: [
    '--- /dev/null',
    '+++ b/frontend/src/api/generated/contract.ts',
    '@@ -0,0 +1,14 @@',
    '+/**',
    '+ * GENERATED FILE — DO NOT EDIT.',
    '+ *',
    '+ * Produced from `api/openapi.yaml` by `npm run generate:contract`',
    '+ * (openapi-typescript). Edit the contract, then regenerate.',
    '+ *',
    '+ * authority: api/openapi.yaml',
    '+ * sha256:    dc6b2426da195c0b6f220a3226c8229f2f575142f5ff5315222e68fd670ce0ee',
    '+ *',
    '+ * `npm run check:contract` — also run by the Vitest suite — fails when this',
    '+ * file no longer matches the authority above.',
    '+ */',
    '+export interface paths {',
    '+    "/api/v1/events": {',
    '',
  ].join('\n'),
}

// ---------------------------------------------------------------------------
// PR #19 — the scaffold's probe client removed
// ---------------------------------------------------------------------------

export const BACKEND_STATUS_DIFF: DiffFile = {
  diffId: 'diff-pr-19-drop-backend-status',
  changeId: SELF_CHANGE_IDS.dropBackendStatus,
  componentIds: [C.frontendBackendStatus, C.frontendApi],
  filePath: 'frontend/src/backendStatus.ts',
  unifiedDiff: [
    '--- a/frontend/src/backendStatus.ts',
    '+++ /dev/null',
    '@@ -1,40 +0,0 @@',
    '-/**',
    '- * Minimal client for the backend probes that Nginx proxies.',
    '- *',
    '- * It exists so the Compose scaffold can prove end to end that the browser',
    '- * reaches the internal backend through Nginx only. The real server-state layer',
    '- * is introduced with the frontend shell.',
    '- */',
    '-',
    '-export type BackendStatus =',
    "-  | { state: 'loading' }",
    "-  | { state: 'ready'; version: string }",
    "-  | { state: 'unavailable'; reason: string }",
    '-',
    '-interface ProbeResponse {',
    '-  status?: string',
    '-  version?: string',
    '-  reason?: string',
    '-}',
    '-',
    '-/** Reads `/readyz` through the Nginx proxy. */',
    '-export async function fetchBackendStatus(',
    '-  fetchImpl: typeof fetch = fetch,',
    '-): Promise<BackendStatus> {',
    '-  try {',
    "-    const response = await fetchImpl('/readyz', {",
    "-      headers: { Accept: 'application/json' },",
    '-    })',
    '-    const body = (await response.json()) as ProbeResponse',
    '-',
    '-    if (!response.ok) {',
    "-      return { state: 'unavailable', reason: body.reason ?? `HTTP ${response.status}` }",
    '-    }',
    "-    return { state: 'ready', version: body.version ?? 'unknown' }",
    '-  } catch (error) {',
    '-    return {',
    "-      state: 'unavailable',",
    "-      reason: error instanceof Error ? error.message : 'unreachable',",
    '-    }',
    '-  }',
    '-}',
    '',
  ].join('\n'),
}

// ---------------------------------------------------------------------------
// PR #30 — two files, one changeId
// ---------------------------------------------------------------------------

export const CONTRACT_PROBE_DIFF: DiffFile = {
  diffId: 'diff-pr-30-openapi-probes',
  changeId: SELF_CHANGE_IDS.alignProbeReachability,
  componentIds: [C.contract, C.nginx],
  filePath: 'api/openapi.yaml',
  unifiedDiff: [
    '--- a/api/openapi.yaml',
    '+++ b/api/openapi.yaml',
    '@@ -16,7 +16,7 @@ info:',
    '     | `POST /api/v1/events` | Single-event ingestion, idempotent per `clientEventId`. |',
    '     | `GET /api/v1/projects/{projectId}/stream` | Server-Sent Events: gap-free replay followed by the live stream. |',
    '     | `GET /api/v1/projects` … `GET /api/v1/projects/{projectId}/components/{componentId}/history` | Project scoped read models: projects, architecture, runs, agents, plans and component evidence. |',
    '-    | `GET /healthz`, `GET /readyz` | Internal container probes, not reachable from outside the Compose network. |',
    '+    | `GET /healthz`, `GET /readyz` | Container probes, proxied by Nginx and therefore reachable from the published port. |',
    ' ',
    '     ## The read models',
    ' ',
    '@@ -725,12 +725,12 @@ paths:',
    '       operationId: getLiveness',
    '       summary: Liveness probe (internal)',
    '       description: |',
    '-        Internal liveness probe of the Go backend container. It reports only that the process',
    '-        is running and answering; it never touches PostgreSQL. Not routed through the Nginx',
    '-        frontend and therefore not reachable from outside the Compose network.',
    '-      servers:',
    '-        - url: http://backend:8080',
    '-          description: Internal Go backend container — reachable only inside the Compose network',
    '+        Liveness probe of the Go backend container. It reports only that the process is',
    '+        running and answering; it never touches PostgreSQL.',
    '+',
    '+        Nginx proxies this route, so it answers on the published port as well as inside the',
    '+        Compose network. It carries no project data, but like every other route in v0 it is',
    '+        unauthenticated — see the trust boundary in `docs/security-and-boundaries.md`.',
    '       responses:',
    "         '200':",
    '           description: The process is alive.',
    '',
  ].join('\n'),
}

export const NGINX_TEMPLATE_DIFF: DiffFile = {
  diffId: 'diff-pr-30-nginx-template',
  changeId: SELF_CHANGE_IDS.alignProbeReachability,
  componentIds: [C.nginx],
  filePath: 'frontend/nginx/default.conf.template',
  unifiedDiff: [
    '--- a/frontend/nginx/default.conf',
    '+++ b/frontend/nginx/default.conf.template',
    '@@ -13,7 +13,20 @@ server {',
    '     resolver 127.0.0.11 valid=10s ipv6=off;',
    '     set $backend http://backend:8080;',
    ' ',
    '-    client_max_body_size 8m;',
    "+    # Must stay above the backend's MAX_EVENT_BYTES (2 MiB by default), otherwise",
    '+    # Nginx rejects an oversized event before the backend can answer with the',
    "+    # contract's problem+json. Raising MAX_EVENT_BYTES means raising this too;",
    '+    # both are documented together in .env.example.',
    '+    client_max_body_size ${MAX_REQUEST_BODY_SIZE};',
    '+',
    '+    # An event over the limit is still a contract violation, so answer it the way',
    "+    # the contract says instead of with Nginx's HTML error page.",
    '+    error_page 413 = @too_large;',
    '+',
    '+    location @too_large {',
    '+        default_type application/problem+json;',
    '+        return 413 \'{"type":"https://visualise-ai.local/problems/event-too-large","title":"Content Too Large","status":413,"detail":"The request body exceeds the size the entry point accepts. See MAX_EVENT_BYTES and MAX_REQUEST_BODY_SIZE.","code":"event_too_large"}\';',
    '+    }',
    ' ',
    '     # ---- Server-Sent Events -------------------------------------------------',
    '     # Must be declared before the generic /api/ prefix: regex locations win.',
    '',
  ].join('\n'),
}

// ---------------------------------------------------------------------------
// PR #18 — reported without a changeId
// ---------------------------------------------------------------------------

/**
 * No `changeId`: the position allocator is not one of the three logical changes
 * this run reports, it is the evidence behind the store feedback. The inspector
 * must show it ungrouped next to the grouped ones.
 */
export const STORE_LOCK_DIFF: DiffFile = {
  diffId: 'diff-pr-18-lock-project',
  componentIds: [C.backendStore, C.postgres],
  filePath: 'backend/internal/store/store.go',
  unifiedDiff: [
    '--- /dev/null',
    '+++ b/backend/internal/store/store.go',
    '@@ -0,0 +191,21 @@',
    '+// lockProject makes sure the project row exists and holds its row lock until',
    '+// the transaction ends.',
    '+func lockProject(tx *gorm.DB, projectID string, seenAt time.Time) (Project, error) {',
    '+\t// A brand new project has no row to lock yet. Inserting it first is safe',
    '+\t// under concurrency: the loser of the race does nothing and then blocks on',
    "+\t// the winner's row lock below, which is exactly the intended queueing.",
    '+\tif err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Project{',
    '+\t\tProjectID:   projectID,',
    '+\t\tFirstSeenAt: seenAt.UTC(),',
    '+\t\tLastEventAt: seenAt.UTC(),',
    '+\t}).Error; err != nil {',
    '+\t\treturn Project{}, err',
    '+\t}',
    '+',
    '+\tvar project Project',
    '+\tif err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).',
    '+\t\tWhere("project_id = ?", projectID).',
    '+\t\tTake(&project).Error; err != nil {',
    '+\t\treturn Project{}, err',
    '+\t}',
    '+\treturn project, nil',
    '',
  ].join('\n'),
}

export const SELF_DIFFS: DiffFile[] = [
  PACKAGE_JSON_DIFF,
  TYPES_DIFF,
  GENERATED_TYPES_DIFF,
  BACKEND_STATUS_DIFF,
  CONTRACT_PROBE_DIFF,
  NGINX_TEMPLATE_DIFF,
  STORE_LOCK_DIFF,
]
