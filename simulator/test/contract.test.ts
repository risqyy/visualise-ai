import { describe, expect, it } from 'vitest'

import { ContractViolationError, loadContract } from '../src/contract.js'
import { DEFAULT_OPTIONS } from '../src/options.js'
import {
  buildConflictScenario,
  buildFullScenario,
  buildRetryScenario,
  DEFAULT_PROJECT_IDS,
} from '../src/scenarios/index.js'
import type { EventEnvelope } from '../src/types.js'

const contract = loadContract()

const base = {
  projectId: DEFAULT_PROJECT_IDS.full,
  runId: 'run-2026-08-04-0001',
  seed: DEFAULT_OPTIONS.seed,
}

const scenarios = [
  ['full', buildFullScenario({ ...base, finish: true })],
  ['retry', buildRetryScenario({ ...base, runId: 'run-2026-08-04-0002' })],
  ['conflict', buildConflictScenario({ ...base, runId: 'run-2026-08-04-0003' })],
] as const

describe('contract conformance', () => {
  it.each(scenarios)('every event of the %s scenario validates as IngestEventRequest', (_, scenario) => {
    for (const step of scenario.steps) {
      expect(() => contract.assertIngestible(step.event)).not.toThrow()
    }
  })

  it('loads the contract the repository publishes', () => {
    expect(contract.path.replaceAll('\\', '/')).toMatch(/\/api\/openapi\.yaml$/)
    expect(contract.eventTypes.length).toBeGreaterThan(0)
  })

  it('refuses an event the contract does not allow', () => {
    const [first] = buildFullScenario({ ...base, finish: false }).steps
    const broken = {
      ...(first as { event: EventEnvelope }).event,
      payload: { role: 'orchestrator', displayName: 'x', assignedTask: 'y', rawTerminalOutput: '$ ls' },
    }

    expect(() => contract.assertIngestible(broken)).toThrow(ContractViolationError)
  })

  it('refuses an event type outside the closed catalogue', () => {
    const [first] = buildFullScenario({ ...base, finish: false }).steps
    const broken = { ...(first as { event: EventEnvelope }).event, type: 'tool.invoked' }

    expect(() => contract.assertIngestible(broken)).toThrow(ContractViolationError)
  })

  it('refuses a client event id that is not a uuid', () => {
    const [first] = buildFullScenario({ ...base, finish: false }).steps
    const broken = { ...(first as { event: EventEnvelope }).event, clientEventId: 'not-a-uuid' }

    expect(() => contract.assertIngestible(broken)).toThrow(ContractViolationError)
  })
})
