import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

import { postEvent } from '../src/api.js'
import { runSimulator } from '../src/simulator.js'

const TESTER = 'subagent-test-engineer'
const TAX = 'shop-platform.orders.domain.tax'

async function assertDetails(page: Page, originalUrl: string) {
  const row = page.getByTestId(`agent-row-${TESTER}`)
  const name = row.getByRole('button', { name: 'Test Engineer', exact: true })
  const arrow = page.getByTestId(`agent-detail-toggle-${TESTER}`)
  await expect(name).toHaveAttribute('aria-expanded', 'true')
  await expect(arrow).toHaveAttribute('aria-expanded', 'true')
  const detailId = await name.getAttribute('aria-controls')
  expect(detailId).not.toBeNull()
  expect(await arrow.getAttribute('aria-controls')).toBe(detailId)
  const details = page.locator(`[id="${detailId}"]`)
  await expect(details).toBeVisible()
  await expect(details.getByText(TESTER, { exact: true })).toBeVisible()
  const progress = page.getByTestId(`agent-progress-${TESTER}`)
  await expect(progress).toBeVisible()
  await expect(progress).toHaveAttribute('data-progress-form', 'counted')
  await expect(progress).toHaveAttribute('data-progress-scope', 'own_task')
  await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  await expect(page.getByTestId(`agent-outcome-${TESTER}`)).toHaveAttribute('data-outcome', 'completed')
  await expect(name).toBeFocused()
  await expect(page).toHaveURL(originalUrl)
  await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
}

test('agent name activation opens meaningful details without changing component context', async ({ page }, testInfo) => {
  const project = `agent-name-details-${randomUUID().slice(0, 8)}`
  const run = 'run-agent-name-details'
  // Keep the run open so an accepted later root status report can prove that
  // the tester's explicit disclosure survives live projection refetches.
  const summary = await runSimulator({ scenario: 'full', projectId: project, runId: run, speed: 0, finish: false })
  expect(summary.created).toBe(summary.eventsSent)
  expect(summary.conflicts).toBe(0)
  for (const language of ['de', 'en'] as const) {
    await page.goto(`/projects/${project}/runs/${run}?component=${TAX}`)
    await page.getByTestId(`language-option-${language}`).click()
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
    await expect(page.getByTestId('live-connection-state')).toHaveAttribute('data-state', 'live')
    const originalUrl = page.url()
    const row = page.getByTestId(`agent-row-${TESTER}`)
    const name = row.getByRole('button', { name: 'Test Engineer', exact: true })
    const arrow = page.getByTestId(`agent-detail-toggle-${TESTER}`)
    await expect(arrow).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId(`agent-progress-${TESTER}`)).toHaveCount(0)

    await name.click()
    await assertDetails(page, originalUrl)
    await expect(page.getByTestId(`agent-progress-${TESTER}`)).toBeInViewport()
    await name.click()
    await assertDetails(page, originalUrl)
    await page.screenshot({ path: testInfo.outputPath(`agent-name-click-${language}.png`) })
    // A bottom row reveals progress immediately; lower details remain in the
    // pane's scrollport. Reach the complete ID through normal scrolling and
    // prove that the page, focus and selected component did not move with it.
    const fullId = row.getByText(TESTER, { exact: true })
    await fullId.scrollIntoViewIfNeeded()
    await expect(fullId).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
    await assertDetails(page, originalUrl)
    await page.screenshot({ path: testInfo.outputPath(`agent-name-details-scrolled-${language}.png`) })

    await arrow.click()
    await expect(arrow).toHaveAttribute('aria-expanded', 'false')
    await expect(name).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId(`agent-progress-${TESTER}`)).toHaveCount(0)
    await name.focus()
    await name.press('Enter')
    await assertDetails(page, originalUrl)

    const liveNote = `Details remain open while the root reports another update (${language}).`
    const update = await postEvent({
      schemaVersion: '1.0', clientEventId: randomUUID(), projectId: project, runId: run,
      agentId: 'orchestrator-root', parentAgentId: null, occurredAt: new Date().toISOString(),
      type: 'agent.status_reported', payload: { status: 'idle', note: liveNote },
    })
    expect(update.status, JSON.stringify(update.body)).toBe(201)
    await expect(page.getByTestId('agent-status-note-orchestrator-root')).toHaveText(liveNote)
    await assertDetails(page, originalUrl)
    await page.screenshot({ path: testInfo.outputPath(`agent-name-enter-live-${language}.png`) })

    await arrow.click()
    await expect(name).toHaveAttribute('aria-expanded', 'false')
    await name.focus()
    await name.press('Space')
    await assertDetails(page, originalUrl)
  }
})
