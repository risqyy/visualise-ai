import { describe, expect, it } from 'vitest'

import { DEFAULT_OPTIONS, OptionsError, parseOptions } from '../src/options.js'
import { buildScenario, DEFAULT_PROJECT_IDS, DEFAULT_RUN_IDS } from '../src/scenarios/index.js'

const parse = (line: string) => parseOptions(line.split(' ').filter(Boolean))

describe('options', () => {
  it('defaults to the full scenario against localhost:8080 with an open run', () => {
    expect(parse('')).toEqual(DEFAULT_OPTIONS)
  })

  it('reads every documented flag', () => {
    expect(
      parse('--base http://localhost:8091 --project demo-project --run run-x --speed 0 --scenario retry --seed 7 --finish true --json'),
    ).toEqual({
      baseUrl: 'http://localhost:8091',
      projectId: 'demo-project' as string | null,
      runId: 'run-x',
      speed: 0,
      scenario: 'retry',
      seed: 7,
      finish: true,
      json: true,
    })
  })

  it('treats a bare --finish as true', () => {
    expect(parse('--finish')?.finish).toBe(true)
    expect(parse('--finish false')?.finish).toBe(false)
  })

  it('strips a trailing slash from the base url', () => {
    expect(parse('--base http://localhost:8091/')?.baseUrl).toBe('http://localhost:8091')
  })

  it('returns null for --help', () => {
    expect(parse('--help')).toBeNull()
  })

  it.each([
    ['--scenario nonsense', /--scenario/],
    ['--speed -1', /--speed/],
    ['--seed abc', /--seed/],
    ['--base localhost:8091', /--base/],
    ['--base http://localhost:8091/api', /--base/],
    ['--unknown', /unknown option/],
    ['--project', /requires a value/],
  ])('rejects %s', (line, message) => {
    expect(() => parse(line)).toThrow(OptionsError)
    expect(() => parse(line)).toThrow(message)
  })

  it('gives each scenario its own project and run id by default', () => {
    expect(new Set(Object.values(DEFAULT_RUN_IDS)).size).toBe(Object.keys(DEFAULT_RUN_IDS).length)
    expect(new Set(Object.values(DEFAULT_PROJECT_IDS)).size).toBe(
      Object.keys(DEFAULT_PROJECT_IDS).length,
    )

    for (const scenario of ['full', 'retry', 'conflict'] as const) {
      const options = parse(`--scenario ${scenario}`)
      expect(options).not.toBeNull()
      expect(buildScenario(options!).runId).toBe(DEFAULT_RUN_IDS[scenario])
      expect(buildScenario(options!).projectId).toBe(DEFAULT_PROJECT_IDS[scenario])
    }
  })

  it('is stable across repeated invocations', () => {
    expect(buildScenario(parse('')!).projectId).toBe(buildScenario(parse('')!).projectId)
    expect(buildScenario(parse('')!).projectId).toBe(DEFAULT_PROJECT_IDS.full)
  })

  it('lets --run and --project override the scenario defaults', () => {
    const options = parse('--scenario full --run run-override --project project-override')
    expect(buildScenario(options!).runId).toBe('run-override')
    expect(buildScenario(options!).projectId).toBe('project-override')
  })
})
