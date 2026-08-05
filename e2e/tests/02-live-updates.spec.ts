import { expect, test } from '@playwright/test'

import { asAccepted, bootstrapEvent, postEvent } from '../src/api.js'
import {
  MAIN_BOOTSTRAP_AGENT,
  MAIN_BOOTSTRAP_RUN,
  MAIN_PROJECT,
  MAIN_RUN,
} from '../src/config.js'
import { showWholeModel } from '../src/canvas.js'
import { installLiveObserver } from '../src/liveObserver.js'
import { startSimulator, type SimulatorSummary } from '../src/simulator.js'

/**
 * Mandatory check 3 — live SSE updates for planned, active, applied and removed.
 *
 * This file also runs the representative sequence that checks 2, 4, 5, 6 and 8
 * read afterwards, and it is the only place that may: the `full` scenario
 * expects an empty project, and it is sent exactly once.
 *
 * **Why the states have to be watched live.** A stream opened without a cursor
 * starts at the live tail (`liveOnly`, ADR 0006), so `aktiv`,
 * `kürzlich angewandt` and `entfernt` describe what *this tab saw happen*
 * (ADR 0010). After a reload they legitimately start empty. Asserting them after
 * the run would therefore assert nothing at all — the last test below turns that
 * exact property into the anti-vacuum guard for the ones above it.
 *
 * **Why the cockpit is opened before the first reported event.** The stream of a
 * project that does not exist yet is `404`, and the client would then back off
 * exponentially and race the run. A bootstrap run opens the project first, so
 * the connection is `live` before position one and nothing is missed by luck.
 */

const BOOTSTRAP_ID = '22222222-0000-4000-8000-000000000001'

/** Filled by the first test and read by the second. */
let summary: SimulatorSummary | null = null

test.describe.configure({ mode: 'serial' })

test('3 · every live change state is observed while the run is happening', async ({ page }) => {
  const opened = await postEvent(
    bootstrapEvent({
      clientEventId: BOOTSTRAP_ID,
      projectId: MAIN_PROJECT,
      runId: MAIN_BOOTSTRAP_RUN,
      agentId: MAIN_BOOTSTRAP_AGENT,
      displayName: 'Acceptance bootstrap',
      assignedTask:
        'Open the project so the cockpit is connected before the representative run starts.',
    }),
  )
  expect(opened.status, JSON.stringify(opened.body)).toBe(201)
  expect(asAccepted(opened).position).toBe(1)

  await page.addInitScript(installLiveObserver)
  await page.goto(`/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}`)

  // The connection must be live *before* the first reported event, otherwise
  // "observed live" would be a coincidence.
  await expect(page.getByTestId('live-connection-state')).toHaveAttribute(
    'data-state',
    'live',
  )

  // Anti-vacuum guard: nothing has been watched yet, so every state is zero.
  const beforeRun = await page.evaluate(() => window.__e2eLive.maxCounts)
  expect(
    Object.values(beforeRun).reduce((sum, value) => sum + value, 0),
    'no change state may be reported before the run started',
  ).toBe(0)

  // `--speed 1` keeps the simulator's pauses, so the transient states are on
  // screen long enough to be genuinely observable rather than inferred.
  const simulator = startSimulator({ scenario: 'full', speed: 1 })

  // The architecture snapshot is the first thing the run publishes, and the
  // canvas opens it on its top levels only (#34). The states below land on
  // components two and three levels down, so the whole model is opened here —
  // once, before any of them arrive — and stays open for the rest of the run.
  await expect(page.getByTestId('architecture-canvas')).toBeVisible({ timeout: 120_000 })
  await showWholeModel(page)

  // The applied removal is the last of the four states to appear; waiting for it
  // means the run reached its "Applied changes" phase with the page open.
  await expect
    .poll(async () => (await page.evaluate(() => window.__e2eLive.maxCounts)).removed, {
      timeout: 240_000,
      message: 'the removed state never appeared while the run was being watched',
    })
    .toBeGreaterThan(0)

  summary = await simulator.done
  expect(summary.projectId).toBe(MAIN_PROJECT)
  expect(summary.runId).toBe(MAIN_RUN)
  expect(summary.conflicts).toBe(0)
  expect(summary.duplicates).toBe(0)
  expect(summary.created).toBe(summary.eventsSent)
  expect(summary.eventsSent).toBeGreaterThanOrEqual(60)
  // Position 1 is the bootstrap event, so the run ends one above its own count.
  expect(summary.endPosition).toBe(summary.eventsSent + 1)

  // The last proposal of the run arrives after the applied changes; waiting for
  // its node means the page processed the whole stream. It is two levels down,
  // so the whole model has to be open for it to be drawn (#34).
  await showWholeModel(page)
  await expect(
    page.getByTestId('canvas-node-shop-platform.orders.domain.rounding'),
  ).toBeVisible()

  const observed = await page.evaluate(() => window.__e2eLive)

  expect(observed.samples, 'the in-page observer must have run').toBeGreaterThan(10)
  expect(observed.connectionStates).toContain('live')

  // ---- the four states ----------------------------------------------------
  expect(observed.maxCounts.planned, 'geplant').toBeGreaterThan(0)
  expect(observed.maxCounts.active, 'aktiv').toBeGreaterThan(0)
  expect(observed.maxCounts.recently_applied, 'kürzlich angewandt').toBeGreaterThan(0)
  expect(observed.maxCounts.removed, 'entfernt').toBeGreaterThan(0)
  expect(observed.maxTotal).toBeGreaterThan(0)

  // ---- a planned removal is yellow, not red (ADR 0010) --------------------
  // Asserted structurally: the state of an announced removal is `planned`, and
  // what tells it apart from a planned addition is the word `entfernen` plus
  // `data-operation`, never the hue.
  const plannedRemoval = observed.marks['planned|remove']
  expect(
    plannedRemoval,
    `no planned removal was rendered; observed marks: ${Object.keys(observed.marks).join(', ')}`,
  ).toBeTruthy()
  expect(plannedRemoval?.state).toBe('planned')
  expect(plannedRemoval?.label).toBe('geplant')
  expect(plannedRemoval?.borderStyle).toBe('dashed')
  expect(plannedRemoval?.text).toContain('entfernen')

  const plannedAddition = observed.marks['planned|add']
  expect(plannedAddition).toBeTruthy()
  expect(plannedAddition?.text).toContain('hinzufügen')
  // Same phase, same border style — only the word differs.
  expect(plannedAddition?.borderStyle).toBe(plannedRemoval?.borderStyle)

  // ---- an applied removal is a different state entirely -------------------
  const appliedRemoval = Object.values(observed.marks).find(
    (mark) => mark.state === 'removed',
  )
  expect(appliedRemoval, 'the applied removal must render the `removed` state').toBeTruthy()
  expect(appliedRemoval?.label).toBe('entfernt')
  expect(appliedRemoval?.borderStyle).toBe('dotted')

  const applied = Object.values(observed.marks).find(
    (mark) => mark.state === 'recently_applied',
  )
  expect(applied?.label).toBe('kürzlich angewandt')
  expect(applied?.borderStyle).toBe('solid')

  const active = Object.values(observed.marks).find((mark) => mark.state === 'active')
  expect(active?.label).toBe('aktiv')
  expect(active?.borderStyle).toBe('double')

  // ---- the removed element stays on the canvas as evidence ----------------
  expect(observed.ghostComponentIds).toContain(
    'shop-platform.orders.domain.legacy-tax-rates',
  )

  // ---- proposals never entered the applied model --------------------------
  expect(observed.maxOverlayNodeCount).toBeGreaterThan(0)
  const canvas = page.getByTestId('architecture-canvas')
  await expect(canvas).toHaveAttribute('data-node-count', '17')
  await expect(canvas).toHaveAttribute('data-edge-count', '11')
})

test('3 · after a reload the watched states start empty again — which is why they had to be watched', async ({
  page,
}) => {
  expect(summary, 'the representative run must have completed').not.toBeNull()

  await page.addInitScript(installLiveObserver)
  await page.goto(`/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}`)
  await expect(page.getByTestId('live-connection-state')).toHaveAttribute(
    'data-state',
    'live',
  )
  await expect(page.getByTestId('architecture-canvas')).toBeVisible()
  // The pending proposals come back from the read API's `activeChanges`.
  await showWholeModel(page)
  await expect(
    page.getByTestId('canvas-node-shop-platform.orders.domain.rounding'),
  ).toBeVisible()

  // `planned` is served by the read API and therefore survives a reload …
  await expect(page.getByTestId('change-counter-planned')).not.toHaveAttribute(
    'data-count',
    '0',
  )

  // … while the three states the read API cannot express start empty. If the
  // assertions of the previous test could have been satisfied by a reload, this
  // is where that would show.
  for (const state of ['active', 'recently_applied', 'removed']) {
    await expect(
      page.getByTestId(`change-counter-${state}`),
      `${state} must be empty after a reload — it is a statement about what was watched`,
    ).toHaveAttribute('data-count', '0')
  }

  // The ghost is gone with it: the removed component is simply absent.
  await expect(
    page.getByTestId('canvas-node-shop-platform.orders.domain.legacy-tax-rates'),
  ).toHaveCount(0)
})
