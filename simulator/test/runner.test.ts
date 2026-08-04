/**
 * The runner's assertions, exercised against a stub of the ingestion endpoint.
 *
 * A simulator that reports success when the server misbehaves is worse than no
 * simulator, so the negative cases matter more than the happy path here.
 */
import { describe, expect, it } from 'vitest'

import { loadContract } from '../src/contract.js'
import { DEFAULT_OPTIONS } from '../src/options.js'
import { EVENTS_PATH, RunAbortedError, runScenario } from '../src/runner.js'
import {
  buildConflictScenario,
  buildFullScenario,
  buildRetryScenario,
  DEFAULT_PROJECT_IDS,
} from '../src/scenarios/index.js'
import type { EventEnvelope, Scenario } from '../src/types.js'

const contract = loadContract()
const base = {
  projectId: DEFAULT_PROJECT_IDS.full,
  runId: 'run-2026-08-04-0001',
  seed: DEFAULT_OPTIONS.seed,
}

interface StubOptions {
  /** Answer the second delivery of a known id with a fresh position instead. */
  reallocatePositionOnRetry?: boolean
  /** Accept a conflicting redelivery instead of refusing it. */
  acceptConflicts?: boolean
}

/**
 * A minimal stand-in for `POST /api/v1/events`: it allocates positions, resolves
 * idempotency on the exact request body and refuses a reused id with different
 * content — the three behaviours the scenarios assert.
 */
function stubBackend(options: StubOptions = {}): typeof fetch {
  const byClientEventId = new Map<string, { position: number; body: string }>()
  let position = 0

  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? '')
    const event = JSON.parse(body) as EventEnvelope
    const known = byClientEventId.get(event.clientEventId)
    const respond = (status: number, payload: unknown): Response =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      })

    if (known && known.body === body) {
      const assigned = options.reallocatePositionOnRetry ? (position += 1) : known.position
      return respond(200, {
        projectId: event.projectId,
        position: assigned,
        serverEventId: '00000000-0000-4000-8000-000000000001',
        clientEventId: event.clientEventId,
        duplicate: true,
        receivedAt: '2026-08-04T09:00:00Z',
      })
    }

    if (known && !options.acceptConflicts) {
      return respond(409, {
        type: 'https://visualise-ai.local/problems/client-event-id-conflict',
        title: 'Client event id conflict',
        status: 409,
        detail: `clientEventId ${event.clientEventId} was already accepted`,
        code: 'client_event_id_conflict',
        instance: String(url),
      })
    }

    position += 1
    byClientEventId.set(event.clientEventId, { position, body })
    return respond(201, {
      projectId: event.projectId,
      position,
      serverEventId: '00000000-0000-4000-8000-000000000002',
      clientEventId: event.clientEventId,
      duplicate: false,
      receivedAt: '2026-08-04T09:00:00Z',
    })
  }) as unknown as typeof fetch
}

const run = (scenario: Scenario, fetchImpl: typeof fetch) =>
  runScenario(scenario, contract, {
    baseUrl: 'http://localhost:8091',
    speed: 0,
    quietStdout: true,
    silent: true,
    fetchImpl,
    sleep: async () => {},
  })

describe('runner', () => {
  it('sends the full scenario and summarises it', async () => {
    const scenario = buildFullScenario({ ...base, finish: true })
    const summary = await run(scenario, stubBackend())

    expect(summary.eventsSent).toBe(scenario.steps.length)
    expect(summary.created).toBe(scenario.steps.length)
    expect(summary.duplicates).toBe(0)
    expect(summary.endPosition).toBe(scenario.steps.length)
    expect(summary.projectUrl).toBe(`http://localhost:8091/projects/${scenario.projectId}`)
  })

  it('targets only the public ingestion route', async () => {
    const seen: string[] = []
    const backend = stubBackend()
    const spy = ((url: string, init?: RequestInit) => {
      seen.push(String(url))
      return backend(url, init)
    }) as unknown as typeof fetch

    await run(buildRetryScenario({ ...base, runId: 'run-2026-08-04-0002' }), spy)

    expect(new Set(seen)).toEqual(new Set([`http://localhost:8091${EVENTS_PATH}`]))
  })

  it('accepts a retry that repeats the original position', async () => {
    const summary = await run(
      buildRetryScenario({ ...base, runId: 'run-2026-08-04-0002' }),
      stubBackend(),
    )

    expect(summary.duplicates).toBe(1)
    expect(summary.created).toBe(2)
    // The retry must not have moved the project forward.
    expect(summary.endPosition).toBe(2)
  })

  it('aborts when a retry is given a new position', async () => {
    await expect(
      run(
        buildRetryScenario({ ...base, runId: 'run-2026-08-04-0002' }),
        stubBackend({ reallocatePositionOnRetry: true }),
      ),
    ).rejects.toThrow(RunAbortedError)
  })

  it('accepts the expected conflict', async () => {
    const summary = await run(
      buildConflictScenario({ ...base, runId: 'run-2026-08-04-0003' }),
      stubBackend(),
    )

    expect(summary.conflicts).toBe(1)
    expect(summary.created).toBe(2)
  })

  it('aborts when a conflicting redelivery is accepted instead of refused', async () => {
    await expect(
      run(
        buildConflictScenario({ ...base, runId: 'run-2026-08-04-0003' }),
        stubBackend({ acceptConflicts: true }),
      ),
    ).rejects.toThrow(RunAbortedError)
  })

  it('aborts on an unexpected status and names the event', async () => {
    const failing = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: 422,
            code: 'unknown_agent',
            detail: 'agent "x" never reported agent.started',
          }),
          { status: 422, headers: { 'content-type': 'application/json' } },
        ),
      )) as unknown as typeof fetch

    await expect(run(buildFullScenario({ ...base, finish: false }), failing)).rejects.toThrow(
      /unknown_agent/,
    )
  })

  it('aborts when the endpoint is unreachable', async () => {
    const offline = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch

    await expect(run(buildFullScenario({ ...base, finish: false }), offline)).rejects.toThrow(
      /ECONNREFUSED/,
    )
  })

  it('aborts when the acknowledgement does not match the contract', async () => {
    const malformed = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ position: 1 }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      )) as unknown as typeof fetch

    await expect(run(buildFullScenario({ ...base, finish: false }), malformed)).rejects.toThrow(
      /EventAccepted/,
    )
  })
})
