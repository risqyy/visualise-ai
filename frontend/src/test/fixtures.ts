import type {
  AgentListResponse,
  AppliedComponent,
  ArchitectureResponse,
  ComponentHistoryResponse,
  ComponentInspectorResponse,
  EventType,
  PlanListResponse,
  ProjectListResponse,
  ProjectResponse,
  RunAgent,
  RunListResponse,
  RunResponse,
  StreamedEvent,
  StreamedEventOf,
} from '@/api/types'

/**
 * Contract-shaped fixtures for the read API and the event stream.
 *
 * They exist so the tests exercise the real client against the shapes the
 * contract defines. They are never used by application code.
 */

export const PROJECT_ID = 'visualise-ai'
export const RUN_ID = 'run-2026-08-04-0001'

export function component(overrides: Partial<AppliedComponent> = {}): AppliedComponent {
  return {
    componentId: 'shop-platform.orders.domain',
    name: 'Orders Domain',
    kind: 'module',
    parentComponentId: null,
    description: '',
    technology: {},
    tags: [],
    appliedAt: '2026-08-04T09:05:00Z',
    appliedByAgentId: 'orchestrator-root',
    appliedRunId: RUN_ID,
    position: 7,
    ...overrides,
  }
}

/**
 * `RunAgent` reports "nothing was reported" as an empty string, not as `null`,
 * and carries no `capabilities`, no `summary` and no `statusReportedAt` — those
 * live on the events, not on the projection.
 */
export function agent(overrides: Partial<RunAgent> = {}): RunAgent {
  return {
    agentId: 'orchestrator-root',
    runId: RUN_ID,
    parentAgentId: null,
    role: 'orchestrator',
    displayName: 'Orchestrator',
    assignedTask: 'Koordiniert den Run.',
    status: 'working',
    statusNote: '',
    progress: null,
    finishedOutcome: null,
    startedAt: '2026-08-04T09:00:00Z',
    lastEventAt: '2026-08-04T09:12:00Z',
    position: 12,
    ...overrides,
  }
}

export function streamedEvent<T extends EventType>(
  type: T,
  payload: StreamedEventOf<T>['payload'],
  overrides: Partial<StreamedEventOf<T>> = {},
): StreamedEvent {
  return {
    schemaVersion: '1.0',
    clientEventId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    projectId: PROJECT_ID,
    runId: RUN_ID,
    agentId: 'orchestrator-root',
    parentAgentId: null,
    occurredAt: '2026-08-04T09:12:00Z',
    position: 42,
    serverEventId: '6a3d1c0e-6b1e-4a2f-9c5d-2f8b0c7a1d33',
    receivedAt: '2026-08-04T09:12:00.481Z',
    type,
    payload,
    ...overrides,
  } as StreamedEvent
}

export const projectsResponse: ProjectListResponse = {
  projectPosition: 42,
  projects: [
    {
      projectId: PROJECT_ID,
      firstSeenAt: '2026-08-04T09:00:00Z',
      lastEventAt: '2026-08-04T09:12:00Z',
      lastPosition: 42,
      currentRunId: RUN_ID,
    },
  ],
}

export const projectResponse: ProjectResponse = {
  projectPosition: 42,
  project: {
    projectId: PROJECT_ID,
    firstSeenAt: '2026-08-04T09:00:00Z',
    lastEventAt: '2026-08-04T09:12:00Z',
    lastPosition: 42,
    currentRunId: RUN_ID,
    counts: {
      runs: 1,
      openRuns: 1,
      components: 1,
      relationships: 0,
      activeChanges: 0,
    },
  },
}

export const architectureResponse: ArchitectureResponse = {
  projectPosition: 42,
  components: [component()],
  relationships: [],
  activeChanges: [],
}

export const runsResponse: RunListResponse = {
  projectPosition: 42,
  runs: [
    {
      runId: RUN_ID,
      rootAgentId: 'orchestrator-root',
      startedAt: '2026-08-04T09:00:00Z',
      finishedAt: null,
      outcome: null,
      isOpen: true,
      isCurrent: true,
      position: 42,
    },
  ],
  nextCursor: null,
}

export const runResponse: RunResponse = {
  projectPosition: 42,
  run: {
    ...runsResponse.runs[0]!,
    counts: { agents: 1, plans: 0, workSteps: 0 },
  },
}

/**
 * `GET /runs/current`. The alias is a separate endpoint by contract (ADR 0005),
 * so the fixture answers it separately instead of letting the run-id route match
 * the literal `current`.
 */
export const currentRunResponse: RunResponse = runResponse

export const agentsResponse: AgentListResponse = {
  projectPosition: 42,
  agents: [agent()],
}

export const plansResponse: PlanListResponse = { projectPosition: 42, plans: [] }

export const inspectorResponse: ComponentInspectorResponse = {
  projectPosition: 42,
  runId: RUN_ID,
  component: component(),
  responsibleAgent: agent(),
  currentWorkStep: null,
  feedback: [],
  diffs: [],
  nextDiffCursor: null,
  risks: [],
  problems: [],
  activeChanges: [],
}

export const historyResponse: ComponentHistoryResponse = {
  projectPosition: 42,
  entries: [],
  nextCursor: null,
}

/**
 * Minimal router for `fetch`: matches the read API paths of the contract and
 * answers with the fixtures above. Anything unmatched fails loudly so a test can
 * never pass because a request silently returned nothing.
 */
export function createFakeFetch(
  overrides: Partial<Record<string, unknown>> = {},
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    const path = url.split('?')[0] ?? url

    for (const [pattern, body] of Object.entries(overrides)) {
      if (path !== pattern) continue
      // A factory override lets a test answer with a non-200 — the contract's
      // `404 current_run_not_found` is a state the UI has to render, not a bug.
      return typeof body === 'function' ? (body as () => Response)() : jsonResponse(body)
    }

    if (path === '/api/v1/projects') return jsonResponse(projectsResponse)
    if (path === `/api/v1/projects/${PROJECT_ID}/runs/current`)
      return jsonResponse(currentRunResponse)
    if (path === `/api/v1/projects/${PROJECT_ID}`) return jsonResponse(projectResponse)
    if (path === `/api/v1/projects/${PROJECT_ID}/architecture`)
      return jsonResponse(architectureResponse)
    if (path === `/api/v1/projects/${PROJECT_ID}/runs`) return jsonResponse(runsResponse)
    if (path === `/api/v1/projects/${PROJECT_ID}/runs/${RUN_ID}`)
      return jsonResponse(runResponse)
    if (path === `/api/v1/projects/${PROJECT_ID}/runs/${RUN_ID}/agents`)
      return jsonResponse(agentsResponse)
    if (path === `/api/v1/projects/${PROJECT_ID}/runs/${RUN_ID}/plans`)
      return jsonResponse(plansResponse)
    if (path.endsWith('/history')) return jsonResponse(historyResponse)
    if (path.includes('/components/')) return jsonResponse(inspectorResponse)

    throw new Error(`unexpected request in test: ${url}`)
  }) as typeof fetch
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
