import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

import { bootstrapEvent, postEvent } from '../src/api.js'
import { connectMcp, writeIdentity } from '../src/mcp.js'

const COMPONENT = 'context-service'
const FIRST_RUN = 'run-earlier'
const SECOND_RUN = 'run-later'

/** A private project prevents the new current run from disturbing checks 2–6. */
async function fixture() {
  const mcp = await connectMcp()
  const project = `historical-context-${randomUUID().slice(0, 8)}`
  try {
    await mcp.call('visualise_context_open', {
      ...writeIdentity(project, FIRST_RUN, 'earlier-author'),
      role: 'orchestrator', displayName: 'Earlier author', assignedTask: 'Describe the project model',
    })
    await mcp.call('visualise_model_mutate', {
      ...writeIdentity(project, FIRST_RUN, 'earlier-author'),
      expectedModelRevision: 0,
      operations: [{ op: 'component.add', component: {
        componentId: COMPONENT, name: 'Shared project service', kind: 'service', parentComponentId: null,
      } }],
    })
    return {
      project,
      url: `/projects/${project}/runs/${FIRST_RUN}?component=${COMPONENT}`,
      async openRun(runId: string) {
        const result = await postEvent(bootstrapEvent({
          clientEventId: randomUUID(), projectId: project, runId,
          agentId: `${runId}-author`, occurredAt: new Date().toISOString(),
        }))
        expect(result.status, JSON.stringify(result.body)).toBe(201)
      },
    }
  } finally {
    await mcp.close()
  }
}

const copy = {
  de: {
    historical: 'Historischer Run', selected: 'Ausgewählter Run', current: 'Aktueller Run',
    pane: 'Run- und Agent-Bereich', connection: 'Verbindung: live',
    scope: 'Architektur: letzter geladener Projektstand. Inspector: Belege des ausgewählten Runs.',
  },
  en: {
    historical: 'Historical run', selected: 'Selected run', current: 'Current run',
    pane: 'Runs and agents', connection: 'Connection: live',
    scope: 'Architecture: latest loaded project model. Inspector: evidence from the selected run.',
  },
} as const

async function assertHistoricalContext(page: Page, language: keyof typeof copy, currentRun: string) {
  const text = copy[language]
  const banner = page.getByTestId('workspace-historical-run')
  const back = page.getByTestId('workspace-back-to-current-run')
  await expect(banner).toBeVisible()
  await expect(banner).toBeInViewport({ ratio: 1 })
  await expect(banner).toContainText(text.historical)
  await expect(back).toHaveAttribute('href', new RegExp(`/runs/${currentRun}(?:\\?|$)`))
  await expect(back).toBeInViewport({ ratio: 1 })
  // Trial click checks hit testing as well as visibility, without navigating.
  await back.click({ trial: true })
  await expect(page.getByTestId('architecture-temporal-scope')).toHaveText(text.scope)
  await expect(page.getByTestId('architecture-temporal-scope')).toBeInViewport({ ratio: 1 })
  await expect(page.getByTestId('live-connection-state')).toContainText(text.connection)
  await expect(page.getByRole('tab', { name: text.current, exact: true })).toHaveCount(0)
}

for (const language of ['de', 'en'] as const) {
  test(`historical context and return remain visible in every workspace layout (${language})`, async ({ page }, testInfo) => {
    const model = await fixture()
    await model.openRun(SECOND_RUN)
    // The supported smaller desktop width exposes header overflow hidden at 1920px.
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto(model.url)
    await page.getByTestId(`language-option-${language}`).click()
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-run-id', FIRST_RUN)
    await expect(page.getByRole('tab', { name: copy[language].selected, exact: true })).toHaveAttribute('aria-selected', 'true')
    await assertHistoricalContext(page, language, SECOND_RUN)

    const leftToggle = page.getByRole('button', { name: copy[language].pane, exact: true })
    await leftToggle.click()
    await expect(page.getByTestId('pane-rail-left')).toBeVisible()
    await expect(page.getByTestId('historical-run-banner')).toHaveCount(0)
    await assertHistoricalContext(page, language, SECOND_RUN)
    await page.screenshot({ path: testInfo.outputPath(`historical-collapsed-${language}.png`) })

    await leftToggle.click()
    await page.getByTestId('inspector-diffs').getByRole('button', { name: language === 'de' ? 'Deep Focus' : 'Deep focus', exact: true }).click()
    await expect(page.getByTestId('deep-focus-banner')).toBeVisible()
    await expect(page.getByTestId('pane-rail-left')).toBeVisible()
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-run-id', FIRST_RUN)
    await assertHistoricalContext(page, language, SECOND_RUN)
    await page.screenshot({ path: testInfo.outputPath(`historical-deep-focus-${language}.png`) })

    await page.keyboard.press('Escape')
    await page.getByTestId('canvas-toggle-architecture-focus').click()
    await expect(page.getByTestId('pane-rail-left')).toBeVisible()
    await expect(page.getByTestId('pane-rail-right')).toBeVisible()
    await assertHistoricalContext(page, language, SECOND_RUN)
    await page.getByTestId('workspace-back-to-current-run').click()
    await expect(page).toHaveURL(new RegExp(`/runs/${SECOND_RUN}(?:\\?|$)`))
    await expect(page.getByTestId('workspace-historical-run')).toHaveCount(0)
  })
}

test('a new run updates historical context while panes are closed without navigating away', async ({ page }) => {
  const model = await fixture()
  await page.goto(model.url)
  await page.getByTestId('language-option-en').click()
  await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-run-id', FIRST_RUN)
  await expect(page.getByTestId('live-connection-state')).toHaveAttribute('data-state', 'live')
  await expect(page.getByTestId('workspace-historical-run')).toHaveCount(0)
  await page.getByTestId('canvas-toggle-architecture-focus').click()
  await expect(page.getByTestId('pane-rail-left')).toBeVisible()
  await expect(page.getByTestId('pane-rail-right')).toBeVisible()
  const url = page.url()
  const documentToken = randomUUID()
  await page.evaluate((token) => { document.documentElement.dataset.contextDocument = token }, documentToken)

  await model.openRun(SECOND_RUN)
  await assertHistoricalContext(page, 'en', SECOND_RUN)
  await expect(page).toHaveURL(url)
  await expect(page.locator('html')).toHaveAttribute('data-context-document', documentToken)

  // A second arrival must retarget the same persistent return link, not leave
  // the link pointing at the run that was current when the banner first appeared.
  await model.openRun('run-latest')
  await assertHistoricalContext(page, 'en', 'run-latest')
  await expect(page).toHaveURL(url)
  await expect(page.locator('html')).toHaveAttribute('data-context-document', documentToken)
  await page.getByTestId('canvas-toggle-architecture-focus').click()
  await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-run-id', FIRST_RUN)
  await expect(page.getByRole('tab', { name: 'Selected run', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('workspace-back-to-current-run').click()
  await expect(page).toHaveURL(/\/runs\/run-latest(?:\?|$)/)
  await expect(page.getByTestId('workspace-historical-run')).toHaveCount(0)
})
