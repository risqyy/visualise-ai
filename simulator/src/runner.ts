/**
 * Sends a scenario to a running cockpit and checks every answer.
 *
 * Two rules the runner never relaxes:
 *
 * 1. **Nothing is sent that the contract would refuse.** Every envelope is
 *    validated against `api/openapi.yaml` first; a violation aborts before the
 *    request is made, so a failing simulator run always means the *server*
 *    disagreed, never that the simulator invented a field.
 * 2. **Every response is checked.** An unexpected status, a duplicate flag that
 *    does not match or a re-allocated position stops the run with the event, the
 *    status, the problem `code` and the `detail` printed.
 */
import { setTimeout as delay } from 'node:timers/promises'

import type { Contract } from './contract.js'
import { createReporter, formatComponents, pad, padStart, type Reporter } from './report.js'
import type { EventAccepted, ProblemDocument, Scenario, ScenarioStep } from './types.js'

export const EVENTS_PATH = '/api/v1/events'

export class RunAbortedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunAbortedError'
  }
}

export interface RunnerOptions {
  baseUrl: string
  /** Pause multiplier. 0 disables every pause. */
  speed: number
  /** Narrate on stderr instead of stdout, so stdout can carry JSON only. */
  quietStdout: boolean
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  /** Injectable for tests. Defaults to a real sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Suppresses the narrative entirely. Used by the tests. */
  silent?: boolean
}

export interface RunSummary {
  scenario: string
  projectId: string
  runId: string
  baseUrl: string
  eventsSent: number
  created: number
  duplicates: number
  conflicts: number
  /** Highest position the server assigned during this run, or 0 when none. */
  endPosition: number
  /** Position, type and agent of every accepted event, in order. */
  events: { position: number | null; type: string; agentId: string; status: number }[]
  projectUrl: string
}

interface Answer {
  status: number
  body: unknown
}

async function post(
  fetchImpl: typeof fetch,
  url: string,
  event: unknown,
): Promise<Answer> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    })
  } catch (cause) {
    throw new RunAbortedError(
      `POST ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}\n` +
        '  Is the compose stack up and is --base pointing at the published Nginx port?',
    )
  }

  const text = await response.text()
  let body: unknown = text
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      // Leave the raw text in place; the mismatch report prints it verbatim.
    }
  }
  return { status: response.status, body }
}

function describeProblem(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const problem = body as ProblemDocument
    const parts = [`status ${status}`]
    if (problem.code) parts.push(`code ${problem.code}`)
    if (problem.detail) parts.push(`detail ${problem.detail}`)
    const errors = problem.errors ?? []
    for (const error of errors) {
      parts.push(`${error.field ?? '/'} ${error.code ?? ''} ${error.message ?? ''}`.trim())
    }
    return parts.join('\n      ')
  }
  return `status ${status}, body ${JSON.stringify(body)}`
}

/** Sends `scenario` and returns its summary. Throws on the first mismatch. */
export async function runScenario(
  scenario: Scenario,
  contract: Contract,
  options: RunnerOptions,
): Promise<RunSummary> {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((ms: number) => delay(ms))
  const reporter: Reporter = options.silent
    ? { phase: () => {}, step: () => {}, note: () => {}, blank: () => {} }
    : createReporter(options.quietStdout)
  const url = `${options.baseUrl}${EVENTS_PATH}`

  reporter.step(
    `simulator: scenario ${scenario.name}, project ${scenario.projectId}, run ${scenario.runId}`,
  )
  reporter.step(`           target ${url}`)
  reporter.step(
    `           contract ${contract.path} (v${contract.documentVersion}), ${scenario.steps.length} events`,
  )

  const summary: RunSummary = {
    scenario: scenario.name,
    projectId: scenario.projectId,
    runId: scenario.runId,
    baseUrl: options.baseUrl,
    eventsSent: 0,
    created: 0,
    duplicates: 0,
    conflicts: 0,
    endPosition: 0,
    events: [],
    projectUrl: `${options.baseUrl}/projects/${scenario.projectId}`,
  }

  /** Position assigned to each client event id, for the retry assertion. */
  const positions = new Map<string, number>()
  let phase = ''

  for (const step of scenario.steps) {
    if (step.phase !== phase) {
      phase = step.phase
      reporter.phase(phase)
    }

    // Contract first: an event that violates the published schema never leaves
    // the process.
    contract.assertIngestible(step.event)

    const pause = Math.round(step.pauseMs * options.speed)
    if (pause > 0) await sleep(pause)

    const answer = await post(fetchImpl, url, step.event)
    summary.eventsSent += 1

    assertStatus(step, answer)

    let position: number | null = null
    if (answer.status === 200 || answer.status === 201) {
      const violations = contract.validateResponse('EventAccepted', answer.body)
      if (violations.length > 0) {
        throw new RunAbortedError(
          `the ${answer.status} answer to ${step.event.type} does not match EventAccepted:\n` +
            violations.map((v) => `      ${v}`).join('\n'),
        )
      }
      const accepted = answer.body as EventAccepted
      position = accepted.position
      assertIdempotency(step, accepted, positions)
      positions.set(accepted.clientEventId, accepted.position)
      summary.endPosition = Math.max(summary.endPosition, accepted.position)
      if (accepted.duplicate) summary.duplicates += 1
      else summary.created += 1
    } else {
      summary.conflicts += 1
    }

    summary.events.push({
      position,
      type: step.event.type,
      agentId: step.event.agentId,
      status: answer.status,
    })

    reporter.step(
      `  ${padStart(position === null ? '—' : String(position), 4)}  ${answer.status}  ` +
        `${pad(step.event.type, 32)}${pad(step.event.agentId, 30)}${formatComponents(step.event)}`,
    )
  }

  reporter.blank()
  reporter.note('Summary')
  for (const [label, value] of [
    ['scenario', summary.scenario],
    ['project', summary.projectId],
    ['run', summary.runId],
    ['events sent', String(summary.eventsSent)],
    ['created (201)', String(summary.created)],
    ['duplicate (200)', String(summary.duplicates)],
    ['conflict (409)', String(summary.conflicts)],
    ['end position', String(summary.endPosition)],
    ['open', summary.projectUrl],
  ]) {
    reporter.note(`  ${pad(label as string, 16)}${value}`)
  }

  return summary
}

function assertStatus(step: ScenarioStep, answer: Answer): void {
  if (answer.status === step.expect.status) {
    if (step.expect.code) {
      const code = (answer.body as ProblemDocument | undefined)?.code
      if (code !== step.expect.code) {
        throw new RunAbortedError(
          `${step.event.type} (${step.event.clientEventId}) was refused with the expected ` +
            `status ${answer.status} but code ${JSON.stringify(code)} instead of ` +
            `${JSON.stringify(step.expect.code)}\n      ${describeProblem(answer.status, answer.body)}`,
        )
      }
    }
    return
  }

  throw new RunAbortedError(
    `${step.event.type} (${step.event.clientEventId}) by ${step.event.agentId}\n` +
      `      expected HTTP ${step.expect.status}, got:\n      ${describeProblem(answer.status, answer.body)}`,
  )
}

function assertIdempotency(
  step: ScenarioStep,
  accepted: EventAccepted,
  positions: Map<string, number>,
): void {
  const { expect } = step

  if (expect.duplicate !== undefined && accepted.duplicate !== expect.duplicate) {
    throw new RunAbortedError(
      `${step.event.type} (${step.event.clientEventId}) answered duplicate: ${accepted.duplicate}, ` +
        `expected ${expect.duplicate}`,
    )
  }

  if (expect.samePositionAs) {
    const original = positions.get(expect.samePositionAs)
    if (original === undefined) {
      throw new RunAbortedError(
        `internal: no position recorded for ${expect.samePositionAs}, cannot check the retry`,
      )
    }
    if (accepted.position !== original) {
      throw new RunAbortedError(
        `the byte-identical retry of ${expect.samePositionAs} was assigned position ` +
          `${accepted.position}, but the first delivery got ${original}. An idempotent retry ` +
          'must repeat the original position and must not append.',
      )
    }
  }
}
