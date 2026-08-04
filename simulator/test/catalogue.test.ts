/**
 * The catalogue is closed and the simulator has to exercise all of it: whatever
 * the contract allows, the E2E test in #14 must be able to see happen.
 *
 * The expected set is read from `api/openapi.yaml` rather than restated here, so
 * adding a 21st event type to the contract fails this test until the scenario
 * reports it too.
 */
import { describe, expect, it } from 'vitest'

import { loadContract } from '../src/contract.js'
import { DEFAULT_OPTIONS } from '../src/options.js'
import { buildFullScenario, DEFAULT_PROJECT_IDS } from '../src/scenarios/index.js'

const contract = loadContract()
const base = {
  projectId: DEFAULT_PROJECT_IDS.full,
  runId: 'run-2026-08-04-0001',
  seed: DEFAULT_OPTIONS.seed,
}

const typesOf = (finish: boolean): Set<string> =>
  new Set(buildFullScenario({ ...base, finish }).steps.map((step) => step.event.type))

describe('event catalogue coverage', () => {
  it('covers every type of the published catalogue', () => {
    const covered = typesOf(true)
    const missing = contract.eventTypes.filter((type) => !covered.has(type))

    expect(missing, `not reported by the full scenario: ${missing.join(', ')}`).toEqual([])
    expect(covered.size).toBe(contract.eventTypes.length)
  })

  it('reports nothing that is not in the catalogue', () => {
    const catalogue = new Set(contract.eventTypes)
    for (const type of typesOf(true)) {
      expect(catalogue).toContain(type)
    }
  })

  it('leaves exactly one documented type out of the default run', () => {
    // `run.finished` is optional by contract and off by default, because a run
    // that never reports a terminal state is the case that proves the cockpit
    // derives nothing from silence. It is the only permitted omission, and
    // `--finish true` restores it.
    const covered = typesOf(false)
    const missing = contract.eventTypes.filter((type) => !covered.has(type))

    expect(missing).toEqual(['run.finished'])
  })
})
