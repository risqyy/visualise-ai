/** Command line surface of the simulator. */
import { SCENARIO_NAMES, type ScenarioName } from './types.js'

export interface Options {
  /** Public entry point. The simulator only ever appends paths to this. */
  baseUrl: string
  /** Explicit project id, or `null` to use the scenario's own default. */
  projectId: string | null
  /** Explicit run id, or `null` to use the scenario's own default. */
  runId: string | null
  /** Pause multiplier: 1 = normal, 0 = no pauses, 2 = twice as long. */
  speed: number
  scenario: ScenarioName
  seed: number
  /** Whether the `full` scenario closes the run with `run.finished`. */
  finish: boolean
  /** Emit a machine-readable summary on stdout and narrate on stderr. */
  json: boolean
}

export const DEFAULT_OPTIONS: Options = {
  baseUrl: 'http://localhost:8080',
  projectId: null,
  runId: null,
  speed: 1,
  scenario: 'full',
  // The date the contract, its examples and the simulated timeline are set on.
  // Any integer works; this one just makes the default run recognisable.
  seed: 20260804,
  // A run without a terminal event is the more interesting cockpit state and
  // the one that proves no status is derived from silence, so it is the default.
  finish: false,
  json: false,
}

export const USAGE = `visualise-ai event simulator

  npm run simulate -- [options]

Options
  --base <url>        Public Nginx entry point. Default: ${DEFAULT_OPTIONS.baseUrl}
  --project <id>      Project id. Default: the scenario's own project id.
  --run <id>          Run id. Default: the scenario's own run id.
  --speed <factor>    Pause multiplier. 1 = normal pauses, 0 = none (CI/E2E),
                      2 = twice as slow. Default: ${DEFAULT_OPTIONS.speed}
  --scenario <name>   ${SCENARIO_NAMES.join(' | ')}. Default: ${DEFAULT_OPTIONS.scenario}
  --seed <n>          Seed of the deterministic id and pause generator.
                      Default: ${DEFAULT_OPTIONS.seed}
  --finish <bool>     Whether the full scenario sends run.finished.
                      Default: ${DEFAULT_OPTIONS.finish}
  --json              Print a machine-readable summary on stdout.
  --help              Show this text.

Every scenario talks to <base>/api/v1/events only. The simulator has no
knowledge of internal ports or of the database.`

export class OptionsError extends Error {}

const BOOLEAN_FLAGS = new Set(['--json', '--help', '-h'])

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) {
    throw new OptionsError(`${flag} requires a value`)
  }
  return value
}

function parseBoolean(flag: string, value: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new OptionsError(`${flag} expects true or false, got ${JSON.stringify(value)}`)
}

/**
 * Parses `argv` (without the node and script entries).
 *
 * Returns `null` when the caller asked for `--help`, so the CLI can print the
 * usage and exit `0` rather than treating it as a failure.
 */
export function parseOptions(argv: readonly string[]): Options | null {
  const options: Options = { ...DEFAULT_OPTIONS }

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] as string
    const next = argv[i + 1]
    const consume = (): string => {
      const value = requireValue(flag, next)
      i += 1
      return value
    }

    switch (flag) {
      case '--help':
      case '-h':
        return null
      case '--json':
        options.json = true
        break
      case '--base':
        options.baseUrl = consume().replace(/\/+$/, '')
        break
      case '--project':
        options.projectId = consume()
        break
      case '--run':
        options.runId = consume()
        break
      case '--speed': {
        const raw = consume()
        const speed = Number(raw)
        if (!Number.isFinite(speed) || speed < 0) {
          throw new OptionsError(`--speed expects a number >= 0, got ${JSON.stringify(raw)}`)
        }
        options.speed = speed
        break
      }
      case '--scenario': {
        const raw = consume()
        if (!(SCENARIO_NAMES as readonly string[]).includes(raw)) {
          throw new OptionsError(
            `--scenario expects one of ${SCENARIO_NAMES.join(', ')}, got ${JSON.stringify(raw)}`,
          )
        }
        options.scenario = raw as ScenarioName
        break
      }
      case '--seed': {
        const raw = consume()
        const seed = Number(raw)
        if (!Number.isInteger(seed)) {
          throw new OptionsError(`--seed expects an integer, got ${JSON.stringify(raw)}`)
        }
        options.seed = seed
        break
      }
      case '--finish':
        // `--finish` on its own means `--finish true`; the explicit form is what
        // the acceptance criteria ask for.
        if (next === undefined || next.startsWith('--')) {
          options.finish = true
        } else {
          options.finish = parseBoolean(flag, consume())
        }
        break
      default:
        if (BOOLEAN_FLAGS.has(flag)) break
        throw new OptionsError(`unknown option ${JSON.stringify(flag)}`)
    }
  }

  if (!/^https?:\/\/[^/]+$/.test(options.baseUrl)) {
    throw new OptionsError(
      `--base must be a scheme and host only, for example http://localhost:8091, got ${JSON.stringify(options.baseUrl)}`,
    )
  }

  return options
}
