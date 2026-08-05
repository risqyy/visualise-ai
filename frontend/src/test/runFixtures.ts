import type {
  AgentListResponse,
  PlanListResponse,
  RunListResponse,
  RunResponse,
} from '@/api/types'
import { PROJECT_ID, RUN_ID, agent } from './fixtures'

/**
 * The run the pane tests read.
 *
 * It mirrors what the deterministic simulator reports for its `full` scenario,
 * because that is the shape the visual acceptance runs against: five agents in a
 * three-level tree, both progress scopes side by side, two plan revisions, and a
 * run that never received `run.finished`.
 *
 * Test data only; never imported by application code.
 */

export const HISTORICAL_RUN_ID = 'run-2026-08-03-0001'

export const runsWithHistoryResponse: RunListResponse = {
  projectPosition: 62,
  runs: [
    {
      runId: RUN_ID,
      rootAgentId: 'orchestrator-root',
      startedAt: '2026-08-04T09:00:01Z',
      finishedAt: null,
      outcome: null,
      isOpen: true,
      isCurrent: true,
      position: 62,
    },
    {
      runId: HISTORICAL_RUN_ID,
      rootAgentId: 'orchestrator-yesterday',
      startedAt: '2026-08-03T08:15:00Z',
      finishedAt: '2026-08-03T11:42:00Z',
      outcome: 'completed',
      isOpen: false,
      isCurrent: false,
      position: 31,
    },
  ],
  nextCursor: null,
}

/** The open run: no `finishedAt`, no `outcome`, `isOpen` stays `true`. */
export const openRunResponse: RunResponse = {
  projectPosition: 62,
  run: {
    ...runsWithHistoryResponse.runs[0]!,
    counts: { agents: 5, plans: 1, workSteps: 6 },
  },
}

export const historicalRunResponse: RunResponse = {
  projectPosition: 62,
  run: {
    ...runsWithHistoryResponse.runs[1]!,
    counts: { agents: 2, plans: 1, workSteps: 3 },
  },
}

/**
 * Five agents, three levels deep. The reviewer is spawned by the implementer and
 * the tester by the reviewer, so the tree is not two flat generations.
 */
export const treeAgentsResponse: AgentListResponse = {
  projectPosition: 62,
  agents: [
    agent({
      agentId: 'orchestrator-root',
      parentAgentId: null,
      role: 'orchestrator',
      displayName: 'Root Orchestrator',
      assignedTask: 'VAT-Behandlung aus dem Pricing-Modul lösen.',
      status: 'working',
      statusNote: 'Wartet auf den Review.',
      // An estimate about the whole run — the agent's own claim, not a measurement.
      progress: { percent: 20, scope: 'overall_estimate', basis: 'reported_estimate' },
      startedAt: '2026-08-04T09:00:01Z',
      lastEventAt: '2026-08-04T09:04:12Z',
      position: 30,
    }),
    agent({
      agentId: 'subagent-architect',
      parentAgentId: 'orchestrator-root',
      role: 'subagent',
      displayName: 'Architecture Mapper',
      assignedTask: 'Angewandtes Architekturmodell veröffentlichen.',
      status: 'done',
      statusNote: '',
      progress: { percent: 40, scope: 'own_task', basis: 'completed_steps' },
      finishedOutcome: 'completed',
      startedAt: '2026-08-04T09:00:03Z',
      lastEventAt: '2026-08-04T09:02:40Z',
      position: 18,
    }),
    agent({
      agentId: 'subagent-implementer',
      parentAgentId: 'orchestrator-root',
      role: 'subagent',
      displayName: 'Implementer',
      assignedTask: 'VAT-Behandlung in ein eigenes Modul verschieben.',
      status: 'working',
      statusNote: 'Schreibt Total() um.',
      progress: { percent: 70, scope: 'own_task', basis: 'completed_steps' },
      startedAt: '2026-08-04T09:00:05Z',
      lastEventAt: '2026-08-04T09:06:31Z',
      position: 41,
    }),
    agent({
      agentId: 'subagent-reviewer',
      parentAgentId: 'subagent-implementer',
      role: 'subagent',
      displayName: 'Reviewer',
      assignedTask: 'Die Extraktion prüfen.',
      status: 'waiting',
      statusNote: 'Wartet auf den Abschluss der Extraktion.',
      progress: { percent: 30, scope: 'own_task', basis: 'completed_steps' },
      startedAt: '2026-08-04T09:00:07Z',
      lastEventAt: '2026-08-04T09:05:02Z',
      position: 37,
    }),
    // Never reported a status and never reported a number. Both stay empty.
    agent({
      agentId: 'subagent-tester',
      parentAgentId: 'subagent-reviewer',
      role: 'subagent',
      displayName: 'Test Engineer',
      assignedTask: 'Das Tax-Modul mit Tabellentests abdecken.',
      status: '',
      statusNote: '',
      progress: null,
      startedAt: '2026-08-04T09:00:09Z',
      lastEventAt: '2026-08-04T09:00:09Z',
      position: 12,
    }),
  ],
}

/**
 * The density stress case of #39, mirroring the simulator's `self` scenario:
 * a root orchestrator whose `assignedTask` is a whole paragraph, a subagent
 * whose task is three issue titles chained with `·`, and a long status note.
 *
 * The strings are copied verbatim from what the simulator reports, because the
 * point of the fixture is exactly their length — a paraphrase would test a
 * different sentence than the one the acceptance looks at.
 */
export const PARAGRAPH_TASK =
  'Build the v0 agent cockpit of epic #1: a versioned event contract, a Compose ' +
  'deployment behind one entry point, an append-only event store, the ingestion ' +
  'and read surfaces, the live stream, the three-pane cockpit, a deterministic ' +
  'simulator and a mandatory end-to-end acceptance run.'

export const CHAINED_TASK =
  '[v0] Event-Ingestion, Validierung und Lifecycle-Regeln implementieren (#20) · ' +
  '[v0] Projektbezogene HTTP Read API implementieren (#21) · ' +
  '[v0] SSE-Livestream mit positionsbasiertem Replay implementieren (#23)'

export const LONG_STATUS_NOTE =
  'Every subagent finished. The run is left open on purpose: no status is derived from silence.'

export const longTaskAgentsResponse: AgentListResponse = {
  projectPosition: 62,
  agents: [
    agent({
      agentId: 'orchestrator-root',
      parentAgentId: null,
      role: 'orchestrator',
      displayName: 'Root Orchestrator',
      assignedTask: PARAGRAPH_TASK,
      status: 'idle',
      statusNote: LONG_STATUS_NOTE,
      progress: { percent: 96, scope: 'overall_estimate', basis: 'reported_estimate' },
      startedAt: '2026-08-04T09:00:49Z',
      lastEventAt: '2026-08-04T10:41:59Z',
      position: 122,
    }),
    agent({
      agentId: 'subagent-backend-api',
      parentAgentId: 'orchestrator-root',
      role: 'subagent',
      displayName: 'Backend HTTP Surface',
      assignedTask: CHAINED_TASK,
      status: 'done',
      statusNote: '',
      progress: { percent: 100, scope: 'own_task', basis: 'completed_steps' },
      finishedOutcome: 'completed',
      startedAt: '2026-08-04T09:08:26Z',
      lastEventAt: '2026-08-04T09:46:31Z',
      position: 56,
    }),
    agent({
      agentId: 'subagent-implementer',
      parentAgentId: 'orchestrator-root',
      role: 'subagent',
      displayName: 'Implementer',
      assignedTask: 'VAT-Behandlung in ein eigenes Modul verschieben.',
      status: 'working',
      statusNote: 'Schreibt Total() um.',
      progress: { percent: 70, scope: 'own_task', basis: 'completed_steps' },
      startedAt: '2026-08-04T09:00:05Z',
      lastEventAt: '2026-08-04T09:06:31Z',
      position: 41,
    }),
  ],
}

export const historicalAgentsResponse: AgentListResponse = {
  projectPosition: 62,
  agents: [
    agent({
      agentId: 'orchestrator-yesterday',
      runId: HISTORICAL_RUN_ID,
      parentAgentId: null,
      role: 'orchestrator',
      displayName: 'Orchestrator vom Vortag',
      assignedTask: 'Preislogik dokumentieren.',
      status: 'done',
      statusNote: '',
      progress: { percent: 100, scope: 'overall_estimate', basis: 'reported_estimate' },
      finishedOutcome: 'completed',
      startedAt: '2026-08-03T08:15:00Z',
      lastEventAt: '2026-08-03T11:42:00Z',
      position: 31,
    }),
  ],
}

/**
 * One plan with two revisions. Revision 1 keeps the four steps and the states it
 * was last seen with; revision 2 adds a fifth step. Nothing about revision 1 is
 * rewritten — that is what append-only means here.
 */
export const twoRevisionPlansResponse: PlanListResponse = {
  projectPosition: 62,
  plans: [
    {
      planId: 'plan-2026-08-04-0001',
      runId: RUN_ID,
      agentId: 'orchestrator-root',
      currentRevision: 2,
      position: 55,
      revisions: [
        {
          revision: 1,
          createdAt: '2026-08-04T09:01:00Z',
          createdByAgentId: 'orchestrator-root',
          isCurrent: false,
          position: 22,
          steps: [
            {
              stepId: 'step-map',
              order: 0,
              title: 'Angewandte Architektur kartieren',
              state: 'done',
              position: 22,
            },
            {
              stepId: 'step-extract',
              order: 1,
              title: 'VAT in ein Tax-Modul extrahieren',
              state: 'in_progress',
              position: 22,
            },
            {
              stepId: 'step-review',
              order: 2,
              title: 'Die Extraktion prüfen',
              state: 'pending',
              position: 22,
            },
            {
              stepId: 'step-cover',
              order: 3,
              title: 'Tax-Modul mit Tabellentests abdecken',
              state: 'pending',
              position: 22,
            },
          ],
        },
        {
          revision: 2,
          createdAt: '2026-08-04T09:05:30Z',
          createdByAgentId: 'orchestrator-root',
          isCurrent: true,
          position: 55,
          steps: [
            {
              stepId: 'step-map',
              order: 0,
              title: 'Angewandte Architektur kartieren',
              state: 'done',
              position: 55,
            },
            {
              stepId: 'step-extract',
              order: 1,
              title: 'VAT in ein Tax-Modul extrahieren',
              state: 'done',
              position: 55,
            },
            {
              stepId: 'step-rates',
              order: 2,
              title: 'Länderspezifische Sätze auslagern',
              state: 'in_progress',
              position: 55,
            },
            {
              stepId: 'step-review',
              order: 3,
              title: 'Die Extraktion prüfen',
              state: 'pending',
              position: 55,
            },
            {
              stepId: 'step-cover',
              order: 4,
              title: 'Tax-Modul mit Tabellentests abdecken',
              state: 'pending',
              position: 55,
            },
          ],
        },
      ],
    },
  ],
}

export const historicalPlansResponse: PlanListResponse = {
  projectPosition: 62,
  plans: [],
}

/** Paths of the read API this fixture set answers for. */
export const runPaths = {
  runs: `/api/v1/projects/${PROJECT_ID}/runs`,
  currentRun: `/api/v1/projects/${PROJECT_ID}/runs/current`,
  runDetail: `/api/v1/projects/${PROJECT_ID}/runs/${RUN_ID}`,
  agents: `/api/v1/projects/${PROJECT_ID}/runs/${RUN_ID}/agents`,
  plans: `/api/v1/projects/${PROJECT_ID}/runs/${RUN_ID}/plans`,
  architecture: `/api/v1/projects/${PROJECT_ID}/architecture`,
  historicalRunDetail: `/api/v1/projects/${PROJECT_ID}/runs/${HISTORICAL_RUN_ID}`,
  historicalAgents: `/api/v1/projects/${PROJECT_ID}/runs/${HISTORICAL_RUN_ID}/agents`,
  historicalPlans: `/api/v1/projects/${PROJECT_ID}/runs/${HISTORICAL_RUN_ID}/plans`,
} as const
