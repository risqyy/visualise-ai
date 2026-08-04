import { expect, test } from '@playwright/test'

import {
  asAccepted,
  asProblem,
  bootstrapEvent,
  getJson,
  postEvent,
  type EventEnvelope,
} from '../src/api.js'
import {
  CONFLICT_PROJECT,
  RETRY_PROJECT,
  VALIDATION_AGENT,
  VALIDATION_PROJECT,
  VALIDATION_RUN,
} from '../src/config.js'
import { runSimulator } from '../src/simulator.js'

/**
 * Mandatory check 1 — event validation, idempotency and observable projections.
 *
 * Three separate promises of the contract are asserted here, and the third is
 * what makes the first two more than a status-code test:
 *
 * 1. A refused event is refused **and occupies no position**. Positions are
 *    handed out under the project row lock (ADR 0002), so the only honest way to
 *    show that a rejection consumed none is to send a valid event afterwards and
 *    read the position the server assigned it.
 * 2. Idempotency is **content based**: a byte-identical redelivery answers
 *    `200 duplicate: true` with the original position, a different payload under
 *    the same key answers `409`.
 * 3. The effect is **observable in the UI**. A rejected event that nevertheless
 *    reached a projection, or a conflicting one that silently overwrote the
 *    original, would be invisible in the HTTP answers above.
 */

// Fixed ids: the suite always starts from an empty database, so nothing has to
// be random, and a failing run names the same event every time.
const IDS = {
  open: '11111111-0000-4000-8000-000000000001',
  schemaInvalid: '11111111-0000-4000-8000-000000000002',
  lifecycleInvalid: '11111111-0000-4000-8000-000000000003',
  accepted: '11111111-0000-4000-8000-000000000004',
} as const

function statusEvent(
  clientEventId: string,
  payload: Record<string, unknown>,
  agentId = VALIDATION_AGENT,
): EventEnvelope {
  return {
    schemaVersion: '1.0',
    clientEventId,
    projectId: VALIDATION_PROJECT,
    runId: VALIDATION_RUN,
    agentId,
    parentAgentId: null,
    occurredAt: '2026-08-04T08:05:00Z',
    type: 'agent.status_reported',
    payload,
  }
}

test.describe.configure({ mode: 'serial' })

test('1 · a refused event occupies no position, a retry repeats it, a conflict is rejected', async () => {
  const opened = await postEvent(
    bootstrapEvent({
      clientEventId: IDS.open,
      projectId: VALIDATION_PROJECT,
      runId: VALIDATION_RUN,
      agentId: VALIDATION_AGENT,
      displayName: 'Validation Probe',
      assignedTask: 'Demonstrate that refused events never enter the log.',
    }),
  )
  expect(opened.status, JSON.stringify(opened.body)).toBe(201)
  expect(asAccepted(opened).position).toBe(1)
  expect(asAccepted(opened).duplicate).toBe(false)

  // ---- schema violation: `status` is a closed enum -------------------------
  const schemaInvalid = await postEvent(
    statusEvent(IDS.schemaInvalid, { status: 'exploded', note: 'not a contract status' }),
  )
  expect(schemaInvalid.status, JSON.stringify(schemaInvalid.body)).toBe(400)
  const schemaProblem = asProblem(schemaInvalid)
  expect(schemaProblem.code).toBe('invalid_field')
  expect(schemaProblem.errors?.length ?? 0).toBeGreaterThan(0)

  // ---- lifecycle violation: an agent that never started --------------------
  const lifecycleInvalid = await postEvent(
    statusEvent(IDS.lifecycleInvalid, { status: 'working' }, 'agent-that-never-started'),
  )
  expect(lifecycleInvalid.status, JSON.stringify(lifecycleInvalid.body)).toBe(422)
  expect(asProblem(lifecycleInvalid).code).toBe('unknown_agent')

  // ---- the next accepted event proves neither took a position --------------
  const accepted = await postEvent(
    statusEvent(IDS.accepted, {
      status: 'working',
      note: 'Accepted after two refusals.',
    }),
  )
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201)
  expect(
    asAccepted(accepted).position,
    'a refused event must not consume a project position',
  ).toBe(2)

  // ---- byte-identical redelivery ------------------------------------------
  const retry = await postEvent(
    statusEvent(IDS.accepted, {
      status: 'working',
      note: 'Accepted after two refusals.',
    }),
  )
  expect(retry.status, JSON.stringify(retry.body)).toBe(200)
  expect(asAccepted(retry).duplicate).toBe(true)
  expect(asAccepted(retry).position, 'an idempotent retry repeats the position').toBe(2)

  // ---- same key, different content ----------------------------------------
  const conflict = await postEvent(
    statusEvent(IDS.accepted, { status: 'blocked', note: 'Different content, same key.' }),
  )
  expect(conflict.status, JSON.stringify(conflict.body)).toBe(409)
  expect(asProblem(conflict).code).toBe('client_event_id_conflict')
})

test('1 · the simulator retry and conflict scenarios answer as the contract promises', async () => {
  const retry = await runSimulator({ scenario: 'retry', speed: 0 })
  expect(retry.projectId).toBe(RETRY_PROJECT)
  expect(retry.eventsSent).toBe(3)
  expect(retry.created).toBe(2)
  expect(retry.duplicates).toBe(1)
  expect(retry.conflicts).toBe(0)
  // Two distinct events; the redelivery must not have appended a third.
  expect(retry.endPosition).toBe(2)

  const [, first, redelivery] = retry.events
  expect(first?.status).toBe(201)
  expect(redelivery?.status).toBe(200)
  expect(
    redelivery?.position,
    'the redelivery must repeat the position of the original',
  ).toBe(first?.position)

  const conflict = await runSimulator({ scenario: 'conflict', speed: 0 })
  expect(conflict.projectId).toBe(CONFLICT_PROJECT)
  expect(conflict.created).toBe(2)
  expect(conflict.duplicates).toBe(0)
  expect(conflict.conflicts).toBe(1)
  expect(conflict.endPosition).toBe(2)
  expect(conflict.events.at(-1)?.status).toBe(409)
  expect(conflict.events.at(-1)?.position).toBeNull()
})

test('1 · the projections show the accepted content and nothing that was refused', async ({
  page,
}) => {
  // --- the validation project ----------------------------------------------
  await page.goto(`/projects/${VALIDATION_PROJECT}`)
  await expect(page.getByTestId('pane-run-agents')).toBeVisible()

  const validationStatus = page.getByTestId(`agent-status-${VALIDATION_AGENT}`)
  await expect(validationStatus).toBeVisible()
  // `working` from the accepted event — never `exploded` (schema refusal) and
  // never `blocked` (the conflicting redelivery).
  await expect(validationStatus).toHaveAttribute('data-status', 'working')
  await expect(validationStatus).toContainText('Accepted after two refusals.')

  // The refused event named an agent that never started. If it had reached a
  // projection there would be a second row.
  await expect(page.locator('[data-testid^="agent-row-"]')).toHaveCount(1)
  await expect(page.getByTestId('agent-row-agent-that-never-started')).toHaveCount(0)

  const validationProject = await getJson(`/api/v1/projects/${VALIDATION_PROJECT}`)
  expect(validationProject.status).toBe(200)

  // --- the simulator's conflict project ------------------------------------
  await page.goto(`/projects/${CONFLICT_PROJECT}`)
  const conflictStatus = page.getByTestId('agent-status-orchestrator-conflict')
  await expect(conflictStatus).toBeVisible()
  await expect(conflictStatus).toHaveAttribute('data-status', 'working')
  await expect(conflictStatus).toContainText('Original content.')
  await expect(conflictStatus).not.toContainText('Different content')

  // --- the simulator's retry project ---------------------------------------
  await page.goto(`/projects/${RETRY_PROJECT}`)
  const retryStatus = page.getByTestId('agent-status-orchestrator-retry')
  await expect(retryStatus).toBeVisible()
  await expect(retryStatus).toHaveAttribute('data-status', 'working')
  await expect(page.locator('[data-testid^="agent-row-"]')).toHaveCount(1)
})
