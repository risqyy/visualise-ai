/**
 * The `self` scenario: the cockpit reporting on the repository that builds it.
 *
 * Everything it sends is derived from this repository and nothing else:
 *
 * * the component tree from the directory layout, `docker-compose.yml`,
 *   `backend/go.mod`, `frontend/package.json` and the Dockerfiles,
 * * the relationships from the real Go imports, the real TypeScript imports and
 *   the real `location` blocks of `frontend/nginx/default.conf.template`,
 * * the agents and the plan from the sixteen merged pull requests of epic #1,
 * * the feedback, risks and problems from the ADRs under `docs/decisions/`,
 * * the diffs from `git show` on the commits that made them.
 *
 * Where the evidence stops, the scenario stops. There is no message bus in this
 * project, so there is no `nats_topic` relationship — even though the contract
 * has the kind and the `full` scenario demonstrates it.
 */
import { SequenceBuilder, type Agent } from '../sequence.js'
import type { Scenario } from '../types.js'
import type { DiffFile } from './diffs.js'
import {
  BACKEND_STATUS_COMPONENT,
  FRONTEND_CONTRACT_RELATIONSHIP,
  FULL_REPLAY_RELATIONSHIP,
  GENERATED_TYPES_COMPONENT,
  NGINX_PROBES_RELATIONSHIP,
  REPOSITORY_PROVIDER_COMPONENT,
  SELF_COMPONENT_IDS as C,
  SELF_SNAPSHOT_COMPONENTS,
  SELF_SNAPSHOT_RELATIONSHIPS,
} from './selfArchitecture.js'
import {
  BACKEND_STATUS_DIFF,
  CONTRACT_PROBE_DIFF,
  GENERATED_TYPES_DIFF,
  NGINX_TEMPLATE_DIFF,
  PACKAGE_JSON_DIFF,
  SELF_CHANGE_IDS,
  STORE_LOCK_DIFF,
  TYPES_DIFF,
} from './selfDiffs.js'
import {
  CANVAS_LAYOUT_FEEDBACK,
  INGESTION_VALIDATION_FEEDBACK,
  MARKDOWN_SAFETY_FEEDBACK,
  POSITION_ALLOCATOR_FEEDBACK,
  PROBE_BOUNDARY_FEEDBACK,
  PROBE_BOUNDARY_FEEDBACK_CORRECTED,
  PROGRESS_SCOPE_FEEDBACK,
  REPLAY_HANDOVER_FEEDBACK,
} from './selfFeedback.js'

export const SELF_RUN_ID = 'run-v0-epic-1'

/**
 * The agent tree: one root orchestrator and nine subagents, one per work
 * package of epic #1. `assignedTask` is the pull request title as it was
 * merged, verbatim — including the language it was written in.
 */
const ORCHESTRATOR: Agent = { agentId: 'orchestrator-v0', parentAgentId: null }

const sub = (agentId: string): Agent => ({ agentId, parentAgentId: ORCHESTRATOR.agentId })

const CONTRACT_AGENT = sub('subagent-event-contract')
const PLATFORM = sub('subagent-platform')
const EVENT_STORE = sub('subagent-event-store')
const FRONTEND_SHELL = sub('subagent-frontend-shell')
const BACKEND_API = sub('subagent-backend-api')
const SIMULATOR = sub('subagent-simulator')
const PANES = sub('subagent-cockpit-panes')
const CONTRACT_TYPES = sub('subagent-contract-types')
const VERIFICATION = sub('subagent-verification')

const PLAN_ID = 'plan-v0-epic-1'
const SNAPSHOT_ID = 'snapshot-visualise-ai-repository'

/** Plan step ids, named after the pull request that closed them. */
const STEP = {
  contract: 'step-pr-16-event-contract',
  platform: 'step-pr-17-compose-baseline',
  store: 'step-pr-18-event-store',
  shell: 'step-pr-19-frontend-shell',
  ingest: 'step-pr-20-event-ingestion',
  readapi: 'step-pr-21-read-api',
  simulator: 'step-pr-22-event-simulator',
  sse: 'step-pr-23-sse-stream',
  canvas: 'step-pr-24-architecture-canvas',
  types: 'step-pr-25-generated-types',
  runAgents: 'step-pr-26-run-agent-hierarchy',
  inspector: 'step-pr-27-component-inspector',
  overlays: 'step-pr-28-change-overlays',
  docs: 'step-pr-29-operations-docs',
  acceptance: 'step-pr-31-e2e-acceptance',
} as const

const WORK = {
  map: 'work-map-repository',
  contract: 'work-define-event-contract',
  platform: 'work-compose-baseline',
  store: 'work-event-store',
  shell: 'work-frontend-shell',
  backendApi: 'work-backend-http-surface',
  simulator: 'work-event-simulator',
  canvas: 'work-architecture-canvas',
  panes: 'work-run-inspector-overlays',
  types: 'work-generate-contract-types',
  docs: 'work-operations-docs',
  acceptance: 'work-e2e-acceptance',
  align: 'work-align-contract-with-behaviour',
} as const

/** The real titles, quoted once and reused by the plan and the agents. */
const TITLE = {
  contract: '[v0] Versionierten OpenAPI-Eventvertrag definieren (#16)',
  platform: 'Set up project structure and Docker Compose baseline (#17)',
  store: '[v0] PostgreSQL Event Store und normalisierte Read Models implementieren (#18)',
  shell: '[v0] Frontend-Shell, Routing und Server-State-Grundlage erstellen (#19)',
  ingest: '[v0] Event-Ingestion, Validierung und Lifecycle-Regeln implementieren (#20)',
  readapi: '[v0] Projektbezogene HTTP Read API implementieren (#21)',
  simulator: '[v0] Deterministischen Agent-Event-Simulator bereitstellen (#22)',
  sse: '[v0] SSE-Livestream mit positionsbasiertem Replay implementieren (#23)',
  canvas: '[v0] Hierarchischen Architekturcanvas mit React Flow und ELK umsetzen (#24)',
  types: '[v0] Frontend-Read-Model-Typen aus dem OpenAPI-Vertrag generieren (#25)',
  runAgents: '[v0] Run- und Agenthierarchie mit Fortschritt umsetzen (#26)',
  inspector: '[v0] Komponenteninspektor für KI-Feedback und Unified Diffs bauen (#27)',
  overlays: '[v0] Geplante, aktive und angewandte Änderungen live visualisieren (#28)',
  docs: '[v0] Betriebs- und Agent-Integrationsdokumentation schreiben (#29)',
  acceptance: '[v0] Verpflichtenden Playwright-End-to-End-Abnahmetest implementieren (#31)',
  align: 'Vertrag und Einstiegspunkt an das tatsächliche Verhalten angleichen (#30)',
} as const

export interface SelfScenarioOptions {
  projectId: string
  runId: string
  seed: number
}

/** Turns a diff file into a `diff.reported` payload. */
function diffPayload(diff: DiffFile): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    diffId: diff.diffId,
    componentIds: diff.componentIds,
    filePath: diff.filePath,
    unifiedDiff: diff.unifiedDiff,
  }
  if (diff.changeId !== undefined) {
    payload.changeId = diff.changeId
  }
  return payload
}

interface Step {
  stepId: string
  order: number
  title: string
  state: 'pending' | 'in_progress' | 'done' | 'skipped'
  componentIds: string[]
}

/**
 * The plan, in the order the pull requests were actually merged.
 *
 * `withTypes` is the second revision: `#25` had to be inserted after the canvas
 * landed and before the remaining panes could be finished, because the
 * hand-written read model types described an API the contract never had.
 */
function planSteps(withTypes: boolean, done: number): Step[] {
  const ordered: Omit<Step, 'order' | 'state'>[] = [
    { stepId: STEP.contract, title: TITLE.contract, componentIds: [C.contract] },
    {
      stepId: STEP.platform,
      title: TITLE.platform,
      componentIds: [C.system, C.nginx, C.postgres, C.backend, C.frontend],
    },
    { stepId: STEP.store, title: TITLE.store, componentIds: [C.backendStore, C.postgres] },
    {
      stepId: STEP.shell,
      title: TITLE.shell,
      componentIds: [C.frontend, C.frontendRoutes, C.frontendApi, C.frontendState],
    },
    { stepId: STEP.ingest, title: TITLE.ingest, componentIds: [C.backendIngest, C.contract] },
    { stepId: STEP.readapi, title: TITLE.readapi, componentIds: [C.backendReadapi] },
    { stepId: STEP.simulator, title: TITLE.simulator, componentIds: [C.simulator, C.contract] },
    { stepId: STEP.sse, title: TITLE.sse, componentIds: [C.backendSse, C.frontendApi] },
    { stepId: STEP.canvas, title: TITLE.canvas, componentIds: [C.frontendCanvas] },
    ...(withTypes
      ? [
          {
            stepId: STEP.types,
            title: TITLE.types,
            componentIds: [C.frontendApi, C.frontendGenerated, C.contract],
          },
        ]
      : []),
    { stepId: STEP.runAgents, title: TITLE.runAgents, componentIds: [C.frontendRunAgents] },
    { stepId: STEP.inspector, title: TITLE.inspector, componentIds: [C.frontendInspector] },
    {
      stepId: STEP.overlays,
      title: TITLE.overlays,
      componentIds: [C.frontendState, C.frontendCanvas],
    },
    { stepId: STEP.docs, title: TITLE.docs, componentIds: [C.system] },
    { stepId: STEP.acceptance, title: TITLE.acceptance, componentIds: [C.e2e, C.nginx] },
  ]

  return ordered.map((step, index) => ({
    ...step,
    order: index,
    state: index < done ? 'done' : index === done ? 'in_progress' : 'pending',
  }))
}

export function buildSelfScenario(options: SelfScenarioOptions): Scenario {
  const b = new SequenceBuilder({
    projectId: options.projectId,
    runId: options.runId,
    seed: options.seed,
    scenarioLabel: 'self',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Run start')
  // -------------------------------------------------------------------------
  b.emit(ORCHESTRATOR, 'agent.started', {
    role: 'orchestrator',
    displayName: 'Root Orchestrator',
    assignedTask:
      'Build the v0 agent cockpit of epic #1: a versioned event contract, a Compose deployment behind one entry point, an append-only event store, the ingestion and read surfaces, the live stream, the three-pane cockpit, a deterministic simulator and a mandatory end-to-end acceptance run.',
    capabilities: ['planning', 'delegation', 'architecture'],
  })
  b.emit(ORCHESTRATOR, 'agent.status_reported', {
    status: 'working',
    note: 'Reading the repository tree, go.mod, package.json, docker-compose.yml and the Nginx site config before delegating anything.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Architecture snapshot')
  // -------------------------------------------------------------------------
  b.emit(ORCHESTRATOR, 'work.step_started', {
    workStepId: WORK.map,
    title: 'Map the repository as it stands',
    componentIds: [C.system, C.nginx, C.backend, C.frontend, C.postgres, C.contract],
  })
  b.emit(ORCHESTRATOR, 'architecture.snapshot_published', {
    snapshotId: SNAPSHOT_ID,
    components: SELF_SNAPSHOT_COMPONENTS,
    relationships: SELF_SNAPSHOT_RELATIONSHIPS,
  })
  b.emit(ORCHESTRATOR, 'work.step_completed', {
    workStepId: WORK.map,
    summary: `${SELF_SNAPSHOT_COMPONENTS.length} components across four hierarchy levels and ${SELF_SNAPSHOT_RELATIONSHIPS.length} relationships, derived from the directory tree, the Go and TypeScript imports, docker-compose.yml and the Nginx site config. No queue, no topic and no message bus: this project has none.`,
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Plan')
  // -------------------------------------------------------------------------
  b.emit(ORCHESTRATOR, 'plan.published', {
    planId: PLAN_ID,
    revision: 1,
    steps: planSteps(false, 0),
  })
  b.emit(ORCHESTRATOR, 'agent.progress_reported', {
    percent: 4,
    scope: 'overall_estimate',
    basis: 'reported_estimate',
    note: 'The model is mapped; none of the fourteen work packages is done.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Subagents spawn')
  // -------------------------------------------------------------------------
  b.emit(CONTRACT_AGENT, 'agent.started', {
    role: 'subagent',
    displayName: 'Event Contract',
    assignedTask: TITLE.contract,
    capabilities: ['openapi', 'json-schema'],
  })
  b.emit(PLATFORM, 'agent.started', {
    role: 'subagent',
    displayName: 'Platform',
    assignedTask: TITLE.platform,
    capabilities: ['docker', 'nginx', 'compose'],
  })
  b.emit(EVENT_STORE, 'agent.started', {
    role: 'subagent',
    displayName: 'Event Store',
    assignedTask: TITLE.store,
    capabilities: ['go', 'gorm', 'postgresql'],
  })
  b.emit(FRONTEND_SHELL, 'agent.started', {
    role: 'subagent',
    displayName: 'Frontend Shell',
    assignedTask: TITLE.shell,
    capabilities: ['typescript', 'react', 'tanstack'],
  })
  b.emit(BACKEND_API, 'agent.started', {
    role: 'subagent',
    displayName: 'Backend HTTP Surface',
    assignedTask: `${TITLE.ingest} · ${TITLE.readapi} · ${TITLE.sse}`,
    capabilities: ['go', 'gin', 'sse'],
  })
  b.emit(SIMULATOR, 'agent.started', {
    role: 'subagent',
    displayName: 'Event Simulator',
    assignedTask: TITLE.simulator,
    capabilities: ['typescript', 'ajv', 'determinism'],
  })
  b.emit(PANES, 'agent.started', {
    role: 'subagent',
    displayName: 'Cockpit Panes',
    assignedTask: `${TITLE.canvas} · ${TITLE.runAgents} · ${TITLE.inspector} · ${TITLE.overlays}`,
    capabilities: ['react', 'react-flow', 'elk', 'accessibility'],
  })
  b.emit(VERIFICATION, 'agent.started', {
    role: 'subagent',
    displayName: 'Verification and Documentation',
    assignedTask: `${TITLE.docs} · ${TITLE.acceptance}`,
    capabilities: ['playwright', 'docker', 'technical-writing'],
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Event contract')
  // -------------------------------------------------------------------------
  b.emit(CONTRACT_AGENT, 'agent.status_reported', {
    status: 'working',
    note: 'Writing the closed catalogue as a discriminated union.',
  })
  b.emit(CONTRACT_AGENT, 'work.step_started', {
    workStepId: WORK.contract,
    title: 'Define the versioned event contract',
    componentIds: [C.contract],
    planStepId: STEP.contract,
  })
  // The statement the contract made about the two probes. It was wrong, and it
  // is corrected further down rather than edited — the log is append-only.
  const probeClaim = b.emit(CONTRACT_AGENT, 'feedback.published', {
    feedbackId: 'feedback-probe-trust-boundary',
    componentIds: [C.contract, C.nginx],
    format: 'markdown',
    title: 'The container probes are not reachable from outside',
    body: PROBE_BOUNDARY_FEEDBACK,
  })
  b.emit(CONTRACT_AGENT, 'work.step_completed', {
    workStepId: WORK.contract,
    summary:
      '20 event types in one closed catalogue, a discriminator mapping, the read models and the SSE envelope. api/openapi.yaml 1.1.0.',
  })
  b.emit(CONTRACT_AGENT, 'agent.progress_reported', {
    percent: 100,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(CONTRACT_AGENT, 'agent.status_reported', { status: 'done' })
  b.emit(CONTRACT_AGENT, 'agent.finished', {
    outcome: 'completed',
    summary: 'The contract is the authority; everything else validates against it.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Compose baseline')
  // -------------------------------------------------------------------------
  b.emit(PLATFORM, 'agent.status_reported', {
    status: 'working',
    note: 'Three services, one internal network, one published port.',
  })
  b.emit(PLATFORM, 'work.step_started', {
    workStepId: WORK.platform,
    title: 'Set up the Compose topology and the single entry point',
    componentIds: [C.system, C.nginx, C.postgres, C.backend, C.frontend, C.frontendBackendStatus],
    planStepId: STEP.platform,
  })
  b.emit(PLATFORM, 'work.step_completed', {
    workStepId: WORK.platform,
    summary:
      'postgres:17-alpine and the Go backend publish no host port; nginx:1.29-alpine publishes 8080 and proxies everything else. Readiness, not liveness, gates the Compose dependency.',
  })
  b.emit(PLATFORM, 'agent.progress_reported', {
    percent: 100,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(PLATFORM, 'agent.status_reported', { status: 'done' })
  b.emit(PLATFORM, 'agent.finished', {
    outcome: 'completed',
    summary:
      'Compose scaffold up. frontend/src/backendStatus.ts proves the browser reaches the backend through Nginx only; the shell replaces it.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Event store')
  // -------------------------------------------------------------------------
  b.emit(EVENT_STORE, 'agent.status_reported', {
    status: 'working',
    note: 'One transaction: lock, idempotency, insert, project, link.',
  })
  b.emit(EVENT_STORE, 'work.step_started', {
    workStepId: WORK.store,
    title: 'Append-only log with synchronous projections',
    componentIds: [C.backendStore, C.postgres],
    planStepId: STEP.store,
  })
  b.emit(EVENT_STORE, 'diff.reported', diffPayload(STORE_LOCK_DIFF))
  b.emit(EVENT_STORE, 'feedback.published', {
    feedbackId: 'feedback-position-allocator',
    componentIds: [C.backendStore, C.postgres],
    format: 'markdown',
    title: 'The project row is the position allocator',
    body: POSITION_ALLOCATOR_FEEDBACK,
  })
  b.emit(EVENT_STORE, 'risk.reported', {
    riskId: 'risk-automigrate-not-null',
    componentIds: [C.backendStore, C.postgres],
    title: 'AutoMigrate cannot add a NOT NULL column to a populated table',
    detail:
      'GORM AutoMigrate on startup is the only schema authority in v0 — there is no migration engine and no rebuild command. Adding a NOT NULL column without a default to a table that already has rows therefore fails, and the backend never reports ready. Every projection column carries a database default for that reason. The failure mode is loud rather than silent, but it is a real constraint on every future schema change.',
    severity: 'medium',
  })
  b.emit(EVENT_STORE, 'work.step_completed', {
    workStepId: WORK.store,
    summary:
      'Positions are per project, monotonic and gapless. BeforeUpdate and BeforeDelete hooks fail with ErrEventLogImmutable, so the log is append-only in the code and not only by convention.',
  })
  b.emit(EVENT_STORE, 'agent.progress_reported', {
    percent: 100,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(EVENT_STORE, 'agent.status_reported', { status: 'done' })
  b.emit(EVENT_STORE, 'agent.finished', {
    outcome: 'completed',
    summary: 'The log is the audit source; the read models are folds of it inside the same transaction.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Frontend shell')
  // -------------------------------------------------------------------------
  b.emit(FRONTEND_SHELL, 'agent.status_reported', {
    status: 'working',
    note: 'Splitting server state, live connection state and local UI state.',
  })
  b.emit(FRONTEND_SHELL, 'work.step_started', {
    workStepId: WORK.shell,
    title: 'Routing, server state and the three-pane shell',
    componentIds: [
      C.frontend,
      C.frontendRoutes,
      C.frontendApi,
      C.frontendState,
      C.frontendBackendStatus,
    ],
    planStepId: STEP.shell,
  })
  b.emit(FRONTEND_SHELL, 'component.change_planned', {
    changeId: SELF_CHANGE_IDS.dropBackendStatus,
    operation: 'remove',
    component: BACKEND_STATUS_COMPONENT,
    rationale:
      'The scaffold probe client exists only to prove the browser reaches the backend through Nginx. The server-state layer answers that and more, so the file has no callers left.',
  })
  b.emit(FRONTEND_SHELL, 'diff.reported', diffPayload(BACKEND_STATUS_DIFF))
  b.emit(FRONTEND_SHELL, 'component.change_applied', {
    changeId: SELF_CHANGE_IDS.dropBackendStatus,
    operation: 'remove',
    component: BACKEND_STATUS_COMPONENT,
  })
  b.emit(FRONTEND_SHELL, 'work.step_completed', {
    workStepId: WORK.shell,
    summary:
      'Typed routes, query cache, and a live connection state reported separately from the data: losing the stream never discards what was already loaded.',
  })
  b.emit(FRONTEND_SHELL, 'agent.progress_reported', {
    percent: 100,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(FRONTEND_SHELL, 'agent.status_reported', { status: 'done' })
  b.emit(FRONTEND_SHELL, 'agent.finished', {
    outcome: 'completed',
    summary: 'Shell, routing and server-state foundation in place. backendStatus.ts and App.tsx removed.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Backend HTTP surface')
  // -------------------------------------------------------------------------
  b.emit(BACKEND_API, 'agent.status_reported', {
    status: 'working',
    note: 'Validating against the contract document itself, not a copy of its rules.',
  })
  b.emit(BACKEND_API, 'work.step_started', {
    workStepId: WORK.backendApi,
    title: 'Ingestion, read models and the position-cursored stream',
    componentIds: [
      C.backendHttpapi,
      C.backendIngest,
      C.backendReadapi,
      C.backendSse,
      C.backendStore,
      C.contract,
    ],
    planStepId: STEP.ingest,
  })
  b.emit(BACKEND_API, 'feedback.published', {
    feedbackId: 'feedback-discriminator-validation',
    componentIds: [C.backendIngest, C.contract],
    format: 'markdown',
    title: 'Validate the branch the discriminator selects, and turn format assertions on',
    body: INGESTION_VALIDATION_FEEDBACK,
  })
  b.emit(BACKEND_API, 'agent.progress_reported', {
    percent: 60,
    scope: 'own_task',
    basis: 'completed_steps',
    note: 'Ingestion and the read models are done; the stream is open.',
  })
  b.emit(BACKEND_API, 'feedback.published', {
    feedbackId: 'feedback-replay-handover',
    componentIds: [C.backendSse, C.backendStore],
    format: 'markdown',
    title: 'The replay-to-live handover, and why both naive orderings fail',
    body: REPLAY_HANDOVER_FEEDBACK,
  })
  b.emit(BACKEND_API, 'risk.reported', {
    riskId: 'risk-stream-without-cursor',
    componentIds: [C.backendSse, C.frontendApi],
    title: 'A stream opened without a cursor starts at the live end',
    detail:
      'A connection that sends neither Last-Event-ID nor lastEventPosition has no baseline to reconcile against and begins with the next live event (`liveOnly` in backend/internal/sse/connection.go). Anything a client wants from before that point has to be fetched from the read models. A cursor beyond the end of the log is clamped to the current end and logged, because honouring it verbatim would present as a working but permanently silent stream.',
    severity: 'medium',
  })
  b.emit(BACKEND_API, 'work.step_completed', {
    workStepId: WORK.backendApi,
    summary:
      'Lifecycle rules run inside the append transaction, so a rejected event consumes no position. The publisher is called only after commit, and never for a duplicate.',
  })
  b.emit(BACKEND_API, 'agent.progress_reported', {
    percent: 100,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(BACKEND_API, 'agent.status_reported', { status: 'done' })
  b.emit(BACKEND_API, 'agent.finished', {
    outcome: 'completed',
    summary: 'POST /api/v1/events, the project scoped read models and the SSE stream are live.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Event simulator')
  // -------------------------------------------------------------------------
  b.emit(SIMULATOR, 'agent.status_reported', {
    status: 'working',
    note: 'Seeded ids, seeded pauses, seeded clock. Math.random, Date.now and crypto.randomUUID are banned by ESLint.',
  })
  b.emit(SIMULATOR, 'work.step_started', {
    workStepId: WORK.simulator,
    title: 'Deterministic reference client for the contract',
    componentIds: [C.simulator, C.contract, C.nginx],
    planStepId: STEP.simulator,
  })
  b.emit(SIMULATOR, 'work.step_completed', {
    workStepId: WORK.simulator,
    summary:
      'Every envelope is validated against api/openapi.yaml before it reaches the network, so the simulator cannot demonstrate anything the contract does not allow. It knows exactly one URL and nothing about internal ports or the database.',
  })
  b.emit(SIMULATOR, 'agent.progress_reported', {
    percent: 100,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(SIMULATOR, 'agent.status_reported', { status: 'done' })
  b.emit(SIMULATOR, 'agent.finished', {
    outcome: 'completed',
    summary: 'Two runs with the same seed against an empty database produce byte-identical events.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Architecture canvas')
  // -------------------------------------------------------------------------
  b.emit(PANES, 'agent.status_reported', {
    status: 'working',
    note: 'ELK layered layout, orthogonal routing, nested containers.',
  })
  b.emit(PANES, 'work.step_started', {
    workStepId: WORK.canvas,
    title: 'Hierarchical architecture canvas',
    componentIds: [C.frontendCanvas, C.frontendState],
    planStepId: STEP.canvas,
  })
  b.emit(PANES, 'feedback.published', {
    feedbackId: 'feedback-elk-and-fitview',
    componentIds: [C.frontendCanvas],
    format: 'markdown',
    title: 'Edge sections are ancestor-relative, and fitView() is silently dropped',
    body: CANVAS_LAYOUT_FEEDBACK,
  })
  b.emit(PANES, 'work.step_completed', {
    workStepId: WORK.canvas,
    summary:
      'Deterministic on three levels: canonical input, pinned randomness, fixed node sizes. The camera moves only while the surface is still settling or on an explicit user action.',
  })
  b.emit(PANES, 'agent.progress_reported', {
    percent: 25,
    scope: 'own_task',
    basis: 'completed_steps',
    note: 'One of four panes done.',
  })
  // The drift that forced the plan revision. Reported as it was found: three
  // rendered fields that the contract does not have at all.
  b.emit(PANES, 'problem.reported', {
    problemId: 'problem-read-model-type-drift',
    componentIds: [C.frontendApi, C.contract],
    title: 'The hand-written read model types describe an API that never existed',
    detail:
      'frontend/src/api/types.ts was derived by hand from api/openapi.yaml and never checked back against it. ActiveChange alone carried a target/componentId/relationshipId triple the contract never had (it has targetKind/targetId), lacked snapshot and was missing the retracted state. Three rendered fields do not exist in the contract at all and show undefined against a real backend: project.name, project.runCount and run.agentCount. The compiler cannot notice any of this while the types are hand-written.',
  })
  b.emit(PANES, 'agent.status_reported', {
    status: 'blocked',
    note: 'The remaining panes render read models whose types are wrong. Waiting for a decision on generating them.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Plan revision')
  // -------------------------------------------------------------------------
  b.emit(ORCHESTRATOR, 'agent.status_reported', {
    status: 'working',
    note: 'Inserting a work package: the read model types have to come out of the contract before the remaining panes are built on them.',
  })
  // A revision is a full republish under the same planId. Revision 2 differs
  // from revision 1 by exactly one inserted step.
  b.emit(ORCHESTRATOR, 'plan.published', {
    planId: PLAN_ID,
    revision: 2,
    steps: planSteps(true, 9),
  })
  b.emit(CONTRACT_TYPES, 'agent.started', {
    role: 'subagent',
    displayName: 'Generated Contract Types',
    assignedTask: TITLE.types,
    capabilities: ['typescript', 'openapi-typescript'],
  })
  b.emit(ORCHESTRATOR, 'agent.progress_reported', {
    percent: 62,
    scope: 'overall_estimate',
    basis: 'reported_estimate',
    note: 'Nine of fifteen steps done, and the plan is one step longer than it was.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Generated contract types')
  // -------------------------------------------------------------------------
  b.emit(CONTRACT_TYPES, 'agent.status_reported', {
    status: 'working',
    note: 'openapi-typescript over api/openapi.yaml; types.ts stops describing shapes.',
  })
  b.emit(CONTRACT_TYPES, 'work.step_started', {
    workStepId: WORK.types,
    title: 'Generate the read model types from the contract',
    componentIds: [C.frontendApi, C.frontendGenerated, C.contract],
    planStepId: STEP.types,
  })
  b.emit(CONTRACT_TYPES, 'component.change_planned', {
    changeId: SELF_CHANGE_IDS.generateContractTypes,
    operation: 'add',
    component: GENERATED_TYPES_COMPONENT,
    rationale:
      'The generated module has to be committed: the frontend image builds with frontend/ as its Docker context, so ../api does not exist there. Same arrangement, and the same argument, as the embedded contract copy in the backend.',
  })
  b.emit(CONTRACT_TYPES, 'relationship.change_planned', {
    changeId: SELF_CHANGE_IDS.generateContractTypes,
    operation: 'add',
    relationship: FRONTEND_CONTRACT_RELATIONSHIP,
    rationale:
      'A committed generated artefact is only defensible while something proves it still describes the authority. contractDrift.test.ts regenerates and compares byte for byte, and checks the sha256 in the header against the contract on disk.',
  })
  b.emit(CONTRACT_TYPES, 'diff.reported', diffPayload(PACKAGE_JSON_DIFF))
  b.emit(CONTRACT_TYPES, 'diff.reported', diffPayload(TYPES_DIFF))
  b.emit(CONTRACT_TYPES, 'diff.reported', diffPayload(GENERATED_TYPES_DIFF))
  b.emit(CONTRACT_TYPES, 'component.change_applied', {
    changeId: SELF_CHANGE_IDS.generateContractTypes,
    operation: 'add',
    component: GENERATED_TYPES_COMPONENT,
  })
  b.emit(CONTRACT_TYPES, 'relationship.change_applied', {
    changeId: SELF_CHANGE_IDS.generateContractTypes,
    operation: 'add',
    relationship: FRONTEND_CONTRACT_RELATIONSHIP,
  })
  b.emit(CONTRACT_TYPES, 'work.step_completed', {
    workStepId: WORK.types,
    summary:
      'Where the contract name and the frontend name differed, the contract won and the call sites moved. Both failure cases of the drift guard were demonstrated: editing the spec and editing the generated file by hand.',
  })
  b.emit(CONTRACT_TYPES, 'agent.progress_reported', {
    percent: 100,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(CONTRACT_TYPES, 'agent.status_reported', { status: 'done' })
  b.emit(CONTRACT_TYPES, 'agent.finished', {
    outcome: 'completed',
    summary: '42 real read responses validated against their schema with Ajv, all valid.',
  })
  b.emit(ORCHESTRATOR, 'plan.step_updated', {
    planId: PLAN_ID,
    stepId: STEP.types,
    state: 'done',
    note: 'types.ts derives every export from the generated module.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Run pane, inspector and overlays')
  // -------------------------------------------------------------------------
  b.emit(PANES, 'agent.status_reported', {
    status: 'working',
    note: 'Unblocked: the read models are typed from the contract now.',
  })
  b.emit(PANES, 'work.step_started', {
    workStepId: WORK.panes,
    title: 'Run and agent hierarchy, component inspector, change overlays',
    componentIds: [
      C.frontendRunAgents,
      C.frontendInspector,
      C.frontendState,
      C.frontendCanvas,
    ],
    planStepId: STEP.runAgents,
  })
  b.emit(PANES, 'feedback.published', {
    feedbackId: 'feedback-progress-scopes',
    componentIds: [C.frontendRunAgents],
    format: 'markdown',
    title: 'An overall estimate is a claim, never a counted bar',
    body: PROGRESS_SCOPE_FEEDBACK,
  })
  b.emit(PANES, 'feedback.published', {
    feedbackId: 'feedback-markdown-safety',
    componentIds: [C.frontendInspector],
    format: 'markdown',
    title: 'rehype-raw stays on so the sanitiser is the only boundary',
    body: MARKDOWN_SAFETY_FEEDBACK,
  })
  b.emit(PANES, 'agent.progress_reported', {
    percent: 80,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  // Planned, then withdrawn: ADR 0010 records that a full replay per page load
  // was considered for the change ledger and rejected.
  const fullReplayProposal = b.emit(PANES, 'relationship.change_planned', {
    changeId: SELF_CHANGE_IDS.fullReplayPerPageLoad,
    operation: 'add',
    relationship: FULL_REPLAY_RELATIONSHIP,
    rationale:
      'A stream opened without a cursor starts at the live tail, so the change ledger only describes what the cockpit watched happen. Asking for a full replay on every page load would make it describe the whole project instead.',
  })
  b.emit(PANES, 'problem.reported', {
    problemId: 'problem-recent-applied-limit',
    componentIds: [C.frontendState, C.frontendCanvas],
    title: 'Only the newest eight applied changes contribute an overlay',
    detail:
      'RECENT_APPLIED_LIMIT is 8 and "recent" is counted, not timed — a clock-based window would make the picture change without an event having arrived. The consequence is real: ghosts accumulate until a replacing snapshot or the recency bound drops them, so a run that removes more than eight elements stops showing the earliest ones. The history keeps them; the overlay does not.',
  })
  b.emit(PANES, 'retraction.issued', {
    retractsClientEventId: fullReplayProposal,
    reason:
      'Rejected. A full replay per page load would fire an invalidation per historical event on every open, and it would change the streaming behaviour of every pane rather than only the ledger. Replayed events after a reconnect are folded in idempotently instead.',
  })
  b.emit(PANES, 'work.step_completed', {
    workStepId: WORK.panes,
    summary:
      'Overlays keep every contribution for a target rather than the last one, and the single work state is condensed by the module that already owns the four states. Nothing is overwritten: a retraction marks its entry, a correction supersedes it and appends.',
  })
  b.emit(PANES, 'agent.progress_reported', {
    percent: 100,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(PANES, 'agent.status_reported', { status: 'done' })
  b.emit(PANES, 'agent.finished', {
    outcome: 'completed',
    summary: 'Canvas, run and agent pane, component inspector and the live change overlays are in place.',
  })
  b.emit(ORCHESTRATOR, 'plan.step_updated', {
    planId: PLAN_ID,
    stepId: STEP.runAgents,
    state: 'done',
  })
  b.emit(ORCHESTRATOR, 'plan.step_updated', {
    planId: PLAN_ID,
    stepId: STEP.inspector,
    state: 'done',
  })
  b.emit(ORCHESTRATOR, 'plan.step_updated', {
    planId: PLAN_ID,
    stepId: STEP.overlays,
    state: 'done',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Documentation and acceptance')
  // -------------------------------------------------------------------------
  b.emit(VERIFICATION, 'agent.status_reported', {
    status: 'working',
    note: 'Exercising the system instead of describing it.',
  })
  b.emit(VERIFICATION, 'work.step_started', {
    workStepId: WORK.docs,
    title: 'Operations and agent integration documentation',
    componentIds: [C.system, C.nginx, C.contract, C.simulator],
    planStepId: STEP.docs,
  })
  b.emit(VERIFICATION, 'work.step_completed', {
    workStepId: WORK.docs,
    summary:
      'Two contradictions between the documentation and the deployment surfaced while writing it, both about the entry point.',
  })
  b.emit(ORCHESTRATOR, 'plan.step_updated', {
    planId: PLAN_ID,
    stepId: STEP.docs,
    state: 'done',
    note: 'Written against a running system, which is how the two contradictions were found.',
  })
  b.emit(VERIFICATION, 'work.step_started', {
    workStepId: WORK.acceptance,
    title: 'Mandatory Playwright end-to-end acceptance run',
    componentIds: [C.e2e, C.nginx, C.simulator],
    planStepId: STEP.acceptance,
  })
  b.emit(VERIFICATION, 'work.step_completed', {
    workStepId: WORK.acceptance,
    summary:
      'The suite builds the real Compose stack from an empty database and drives it through Nginx in Chromium at 1920 × 1080. Its own Compose project name, so it can never down -v a development stack.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Correcting the contract')
  // -------------------------------------------------------------------------
  b.emit(VERIFICATION, 'work.step_started', {
    workStepId: WORK.align,
    title: TITLE.align,
    componentIds: [C.contract, C.nginx, C.backendHttpapi],
  })
  b.emit(VERIFICATION, 'relationship.change_planned', {
    changeId: SELF_CHANGE_IDS.alignProbeReachability,
    operation: 'add',
    relationship: NGINX_PROBES_RELATIONSHIP,
    rationale:
      'The edge is missing from the model because the contract denied it. curl against the published port answers 200 for both probes, so the model is wrong, not the deployment.',
  })
  b.emit(VERIFICATION, 'diff.reported', diffPayload(CONTRACT_PROBE_DIFF))
  b.emit(VERIFICATION, 'diff.reported', diffPayload(NGINX_TEMPLATE_DIFF))
  b.emit(VERIFICATION, 'relationship.change_applied', {
    changeId: SELF_CHANGE_IDS.alignProbeReachability,
    operation: 'add',
    relationship: NGINX_PROBES_RELATIONSHIP,
  })
  b.emit(VERIFICATION, 'correction.issued', {
    correctsClientEventId: probeClaim,
    reason:
      'The contract claimed /healthz and /readyz were not routed through the Nginx frontend and therefore not reachable from outside the Compose network. Nginx proxies both, and curl against the published port answers 200. An agent author reading only the contract would have drawn the wrong trust boundary.',
    correctedType: 'feedback.published',
    correctedPayload: {
      feedbackId: 'feedback-probe-trust-boundary',
      componentIds: [C.contract, C.nginx],
      format: 'markdown',
      title: 'The container probes are reachable from the published port',
      body: PROBE_BOUNDARY_FEEDBACK_CORRECTED,
    },
  })
  b.emit(VERIFICATION, 'work.step_completed', {
    workStepId: WORK.align,
    summary:
      'MAX_EVENT_BYTES was documented as configurable while Nginx capped every request at a hard-coded 8m and answered with an HTML error page. The site config is a template now, and an oversized body is refused with application/problem+json and code event_too_large — verified at 2 MiB against a 1m limit.',
  })
  b.emit(VERIFICATION, 'agent.progress_reported', {
    percent: 100,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(VERIFICATION, 'agent.status_reported', { status: 'done' })
  b.emit(VERIFICATION, 'agent.finished', {
    outcome: 'completed',
    summary:
      'Documentation written against a running system, acceptance run green, and the two things the contract got wrong corrected in the log rather than edited.',
  })
  b.emit(ORCHESTRATOR, 'plan.step_updated', {
    planId: PLAN_ID,
    stepId: STEP.acceptance,
    state: 'done',
    note: 'The acceptance run is mandatory and gates the v0 release.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Open proposal')
  // -------------------------------------------------------------------------
  // Planned and neither applied nor retracted, so the cockpit has a pending
  // proposal to render once the run goes quiet. It is a real open question:
  // docs/security-and-boundaries.md describes where a forge would attach and
  // states explicitly that nothing about it is decided.
  b.emit(ORCHESTRATOR, 'component.change_planned', {
    changeId: SELF_CHANGE_IDS.repositoryProvider,
    operation: 'add',
    component: REPOSITORY_PROVIDER_COMPONENT,
    rationale:
      'v0 has no repository access. Everything the cockpit knows about the code is reported content: diff.reported carries the unified diff and the repository-relative path, architecture.snapshot_published carries the model. A provider would resolve a report against a repository, never sit next to the event log as a second source. Signature, place in the code and transport are deliberately not decided here.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Wind down')
  // -------------------------------------------------------------------------
  b.emit(ORCHESTRATOR, 'agent.progress_reported', {
    percent: 96,
    scope: 'overall_estimate',
    basis: 'reported_estimate',
    note: 'All fifteen planned steps are reported done. The repository provider stays a proposal; no issue schedules it.',
  })
  b.emit(ORCHESTRATOR, 'agent.status_reported', {
    status: 'idle',
    note: 'Every subagent finished. The run is left open on purpose: no status is derived from silence.',
  })

  return {
    name: 'self',
    projectId: options.projectId,
    runId: options.runId,
    steps: b.build(),
  }
}
