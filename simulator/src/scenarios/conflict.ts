/**
 * The `conflict` scenario: the same `clientEventId` with different content.
 *
 * Idempotency is content based (ADR 0002), so reusing the key for a different
 * document is not a retry but a bug in the reporting agent. The contract answers
 * `409` with code `client_event_id_conflict`; the runner aborts if it sees
 * anything else, including a silently accepted second event.
 *
 * Like `retry`, this scenario expects an empty project.
 */
import { SequenceBuilder, type Agent } from '../sequence.js'
import type { Scenario } from '../types.js'

export const CONFLICT_RUN_ID = 'run-2026-08-04-0003'

const ORCHESTRATOR: Agent = { agentId: 'orchestrator-conflict', parentAgentId: null }

export interface ConflictScenarioOptions {
  projectId: string
  runId: string
  seed: number
}

export function buildConflictScenario(options: ConflictScenarioOptions): Scenario {
  const b = new SequenceBuilder({
    projectId: options.projectId,
    runId: options.runId,
    seed: options.seed,
    scenarioLabel: 'conflict',
  })

  b.beginPhase('Run start')
  b.emit(ORCHESTRATOR, 'agent.started', {
    role: 'orchestrator',
    displayName: 'Conflict Probe',
    assignedTask: 'Demonstrate that a reused client event id with different content is refused.',
  })

  b.beginPhase('First delivery')
  const target = b.emit(ORCHESTRATOR, 'agent.status_reported', {
    status: 'working',
    note: 'Original content.',
  })

  b.beginPhase('Same id, different payload')
  b.emitConflictWith(target, ORCHESTRATOR, 'agent.status_reported', {
    status: 'blocked',
    note: 'Different content under the same client event id.',
  })

  return {
    name: 'conflict',
    projectId: options.projectId,
    runId: options.runId,
    steps: b.build(),
  }
}
