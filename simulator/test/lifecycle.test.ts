/**
 * The preconditions the backend enforces inside the append transaction
 * (ADR 0004). Getting them wrong turns a demo run into a wall of `422`s, so they
 * are asserted on the generated sequence rather than discovered at runtime.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_OPTIONS } from '../src/options.js'
import {
  buildConflictScenario,
  buildFullScenario,
  buildRetryScenario,
  DEFAULT_PROJECT_IDS,
} from '../src/scenarios/index.js'
import type { Scenario } from '../src/types.js'

const base = {
  projectId: DEFAULT_PROJECT_IDS.full,
  runId: 'run-2026-08-04-0001',
  seed: DEFAULT_OPTIONS.seed,
}

const scenarios: [string, Scenario][] = [
  ['full', buildFullScenario({ ...base, finish: true })],
  ['retry', buildRetryScenario({ ...base, runId: 'run-2026-08-04-0002' })],
  ['conflict', buildConflictScenario({ ...base, runId: 'run-2026-08-04-0003' })],
]

describe.each(scenarios)('lifecycle preconditions of the %s scenario', (_, scenario) => {
  it('opens the run with exactly one root orchestrator', () => {
    const roots = scenario.steps.filter(
      (step) =>
        step.event.type === 'agent.started' &&
        step.event.parentAgentId === null &&
        (step.event.payload as { role?: string }).role === 'orchestrator',
    )

    expect(roots).toHaveLength(1)
    expect(scenario.steps[0]?.event).toBe(roots[0]?.event)
  })

  it('reports agent.started before any other event of that agent', () => {
    const started = new Set<string>()
    for (const step of scenario.steps) {
      const { agentId, type } = step.event
      if (type === 'agent.started') {
        started.add(agentId)
        continue
      }
      expect(started, `${agentId} reported ${type} before agent.started`).toContain(agentId)
    }
  })

  it('names only already started agents as parentAgentId', () => {
    const started = new Set<string>()
    for (const step of scenario.steps) {
      const { agentId, parentAgentId, type } = step.event
      if (parentAgentId !== null) {
        expect(started, `parent ${parentAgentId} of ${agentId} never started`).toContain(
          parentAgentId,
        )
      }
      if (type === 'agent.started') started.add(agentId)
    }
  })

  it('keeps every event inside one project and one run', () => {
    for (const step of scenario.steps) {
      expect(step.event.projectId).toBe(scenario.projectId)
      expect(step.event.runId).toBe(scenario.runId)
    }
  })

  it('corrects and retracts only events that were sent earlier', () => {
    const seen = new Set<string>()
    for (const step of scenario.steps) {
      const payload = step.event.payload as Record<string, unknown>
      const target = payload.correctsClientEventId ?? payload.retractsClientEventId
      if (typeof target === 'string') {
        expect(seen, `${step.event.type} refers to an unsent event`).toContain(target)
      }
      seen.add(step.event.clientEventId)
    }
  })

  it('sends run.finished only from the run orchestrator, and last', () => {
    const terminal = scenario.steps.findIndex((step) => step.event.type === 'run.finished')
    if (terminal === -1) return

    expect(terminal).toBe(scenario.steps.length - 1)
    expect(scenario.steps[terminal]?.event.agentId).toBe(scenario.steps[0]?.event.agentId)
  })
})

describe('the full scenario leaves the run open by default', () => {
  it('omits run.finished unless --finish is given', () => {
    const open = buildFullScenario({ ...base, finish: false })
    expect(open.steps.some((step) => step.event.type === 'run.finished')).toBe(false)
  })

  it('appends run.finished as the only extra event when --finish is given', () => {
    const open = buildFullScenario({ ...base, finish: false })
    const closed = buildFullScenario({ ...base, finish: true })

    expect(closed.steps).toHaveLength(open.steps.length + 1)
    expect(closed.steps.slice(0, open.steps.length).map((s) => s.event)).toEqual(
      open.steps.map((s) => s.event),
    )
    expect(closed.steps.at(-1)?.event.type).toBe('run.finished')
  })
})
