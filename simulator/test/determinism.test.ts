import { describe, expect, it } from 'vitest'

import { BASE_INSTANT_MS } from '../src/clock.js'
import {
  buildConflictScenario,
  buildFullScenario,
  buildRetryScenario,
  DEFAULT_PROJECT_IDS,
} from '../src/scenarios/index.js'
import { DEFAULT_OPTIONS } from '../src/options.js'

const base = {
  projectId: DEFAULT_PROJECT_IDS.full,
  runId: 'run-2026-08-04-0001',
  seed: DEFAULT_OPTIONS.seed,
}

describe('determinism', () => {
  it('produces byte-identical envelopes for two builds with the same seed', () => {
    const first = buildFullScenario({ ...base, finish: true })
    const second = buildFullScenario({ ...base, finish: true })

    expect(second.steps.map((s) => s.event)).toEqual(first.steps.map((s) => s.event))
    // The pacing is seeded too, so even the pauses repeat.
    expect(second.steps.map((s) => s.pauseMs)).toEqual(first.steps.map((s) => s.pauseMs))
  })

  it('is stable across the retry and conflict scenarios as well', () => {
    expect(buildRetryScenario({ ...base, runId: 'run-2026-08-04-0002' }).steps).toEqual(
      buildRetryScenario({ ...base, runId: 'run-2026-08-04-0002' }).steps,
    )
    expect(buildConflictScenario({ ...base, runId: 'run-2026-08-04-0003' }).steps).toEqual(
      buildConflictScenario({ ...base, runId: 'run-2026-08-04-0003' }).steps,
    )
  })

  it('changes every client event id when the seed changes', () => {
    const a = buildFullScenario({ ...base, finish: true })
    const b = buildFullScenario({ ...base, seed: base.seed + 1, finish: true })

    const idsA = a.steps.map((s) => s.event.clientEventId)
    const idsB = b.steps.map((s) => s.event.clientEventId)
    expect(idsB).toHaveLength(idsA.length)
    expect(idsB.some((id, index) => id === idsA[index])).toBe(false)
  })

  it('gives the three scenarios disjoint client event ids under one seed', () => {
    const full = buildFullScenario({ ...base, finish: true })
    const retry = buildRetryScenario({ ...base, runId: 'run-2026-08-04-0002' })
    const conflict = buildConflictScenario({ ...base, runId: 'run-2026-08-04-0003' })

    const ids = [full, retry, conflict].flatMap((scenario) =>
      // The deliberate duplicates of retry/conflict are excluded: they repeat an
      // id on purpose.
      [...new Set(scenario.steps.map((s) => s.event.clientEventId))],
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('draws every client event id as a distinct UUIDv4', () => {
    const scenario = buildFullScenario({ ...base, finish: true })
    const ids = scenario.steps.map((s) => s.event.clientEventId)

    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reports a strictly increasing timeline anchored to the contract base date', () => {
    const scenario = buildFullScenario({ ...base, finish: true })
    const times = scenario.steps.map((s) => Date.parse(s.event.occurredAt))

    expect(times[0]).toBeGreaterThan(BASE_INSTANT_MS)
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThan(times[i - 1] as number)
    }
    // No wall clock anywhere: the whole run stays inside the simulated day.
    expect(times.at(-1)).toBeLessThan(BASE_INSTANT_MS + 24 * 60 * 60 * 1000)
  })
})
