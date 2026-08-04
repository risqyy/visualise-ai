/**
 * The `retry` scenario: idempotency on `clientEventId`.
 *
 * It opens its own run, sends one ordinary event and then the byte-identical
 * document a second time. The contract promises `201` followed by `200` with
 * `duplicate: true` and the **same** position; the runner asserts all three and
 * aborts otherwise.
 *
 * The scenario expects an empty project — a second execution against the same
 * database would legitimately answer `200` to the first delivery too, which is
 * the correct behaviour but not what this scenario is trying to prove.
 */
import { SequenceBuilder, type Agent } from '../sequence.js'
import type { Scenario } from '../types.js'

export const RETRY_RUN_ID = 'run-2026-08-04-0002'

const ORCHESTRATOR: Agent = { agentId: 'orchestrator-retry', parentAgentId: null }

export interface RetryScenarioOptions {
  projectId: string
  runId: string
  seed: number
}

export function buildRetryScenario(options: RetryScenarioOptions): Scenario {
  const b = new SequenceBuilder({
    projectId: options.projectId,
    runId: options.runId,
    seed: options.seed,
    scenarioLabel: 'retry',
  })

  b.beginPhase('Run start')
  b.emit(ORCHESTRATOR, 'agent.started', {
    role: 'orchestrator',
    displayName: 'Idempotency Probe',
    assignedTask: 'Demonstrate that a byte-identical redelivery is not appended twice.',
  })

  b.beginPhase('First delivery')
  const target = b.emit(ORCHESTRATOR, 'agent.status_reported', {
    status: 'working',
    note: 'This exact event is sent twice.',
  })

  b.beginPhase('Byte-identical redelivery')
  b.emitRetryOf(target)

  return {
    name: 'retry',
    projectId: options.projectId,
    runId: options.runId,
    steps: b.build(),
  }
}
