import { spawn, type ChildProcess } from 'node:child_process'

import { BASE_URL, SIMULATOR_DIR } from './config.js'

/**
 * Driving the bundled event simulator.
 *
 * The simulator is the only thing in this suite that reports agent events for
 * the representative sequence, and it talks to `<base>/api/v1/events` and to
 * nothing else — the published Nginx route (ADR 0007). It is seeded and
 * deterministic, and `--json` gives the suite the server-assigned positions of
 * every accepted event, which is what makes the replay assertions arithmetic
 * rather than guesswork.
 */

export interface SimulatorEvent {
  position: number | null
  type: string
  agentId: string
  status: number
}

export interface SimulatorSummary {
  scenario: string
  projectId: string
  runId: string
  baseUrl: string
  eventsSent: number
  created: number
  duplicates: number
  conflicts: number
  /** Highest position the server assigned during this run. */
  endPosition: number
  events: SimulatorEvent[]
  projectUrl: string
}

export interface SimulatorOptions {
  scenario?: 'full' | 'retry' | 'conflict'
  projectId?: string
  runId?: string
  /** Pause multiplier. `1` keeps the pauses the live checks need. */
  speed?: number
  seed?: number
  finish?: boolean
}

export interface RunningSimulator {
  /** Resolves with the parsed `--json` summary once the process exited `0`. */
  done: Promise<SimulatorSummary>
  /** The narrative the simulator wrote on stderr so far. */
  narrative(): string
  kill(): void
}

function argsFor(options: SimulatorOptions): string[] {
  const args = ['--base', BASE_URL, '--json', '--speed', String(options.speed ?? 1)]
  if (options.scenario) args.push('--scenario', options.scenario)
  if (options.projectId) args.push('--project', options.projectId)
  if (options.runId) args.push('--run', options.runId)
  if (options.seed !== undefined) args.push('--seed', String(options.seed))
  if (options.finish !== undefined) args.push('--finish', String(options.finish))
  return args
}

/**
 * Starts the simulator without waiting for it.
 *
 * `node --import tsx src/cli.ts` rather than `npm run simulate`: no shell, no
 * npm banner on stdout, and the exact same entry point the documented command
 * uses.
 */
export function startSimulator(options: SimulatorOptions = {}): RunningSimulator {
  const args = argsFor(options)
  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/cli.ts', ...args],
    { cwd: SIMULATOR_DIR, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk
  })

  const done = new Promise<SimulatorSummary>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `simulator ${args.join(' ')} exited with ${String(code)}\n` +
              `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        )
        return
      }
      try {
        resolve(parseSummary(stdout))
      } catch (cause) {
        reject(
          new Error(
            `simulator ${args.join(' ')} produced no usable --json summary: ${
              cause instanceof Error ? cause.message : String(cause)
            }\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        )
      }
    })
  })

  return {
    done,
    narrative: () => stderr,
    kill: () => {
      child.kill()
    },
  }
}

/** Runs the simulator to completion and returns its machine-readable summary. */
export function runSimulator(options: SimulatorOptions = {}): Promise<SimulatorSummary> {
  return startSimulator(options).done
}

function parseSummary(stdout: string): SimulatorSummary {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object on stdout')
  return JSON.parse(stdout.slice(start, end + 1)) as SimulatorSummary
}
