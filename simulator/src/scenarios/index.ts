/** Scenario selection. */
import type { Options } from '../options.js'
import type { Scenario } from '../types.js'
import { buildConflictScenario, CONFLICT_RUN_ID } from './conflict.js'
import { buildFullScenario, FULL_RUN_ID } from './full.js'
import { buildRetryScenario, RETRY_RUN_ID } from './retry.js'

/**
 * Each scenario has its own default run id, so none of them can be mistaken for
 * another in the run list.
 */
export const DEFAULT_RUN_IDS = {
  full: FULL_RUN_ID,
  retry: RETRY_RUN_ID,
  conflict: CONFLICT_RUN_ID,
} as const

/**
 * The probes report into their own projects.
 *
 * `runs/current` resolves to the run a root orchestrator opened last (ADR 0005),
 * so a probe sent into the demo project afterwards would silently become the
 * cockpit's current run and empty every default component inspector. Keeping
 * them apart also gives the project list more than one row to render.
 *
 * Each id is fixed, so repeating a scenario always lands in the same project;
 * `--project` overrides all three.
 */
export const DEFAULT_PROJECT_IDS = {
  full: 'visualise-ai',
  retry: 'visualise-ai-retry',
  conflict: 'visualise-ai-conflict',
} as const

export function buildScenario(options: Options): Scenario {
  const runId = options.runId ?? DEFAULT_RUN_IDS[options.scenario]
  const projectId = options.projectId ?? DEFAULT_PROJECT_IDS[options.scenario]
  const common = { projectId, runId, seed: options.seed }

  switch (options.scenario) {
    case 'full':
      return buildFullScenario({ ...common, finish: options.finish })
    case 'retry':
      return buildRetryScenario(common)
    case 'conflict':
      return buildConflictScenario(common)
  }
}

export { buildConflictScenario, buildFullScenario, buildRetryScenario }
