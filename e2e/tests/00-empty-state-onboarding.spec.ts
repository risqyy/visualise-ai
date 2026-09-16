import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { getJson } from '../src/api.js'
import { showWholeModel } from '../src/canvas.js'
import { runSimulator } from '../src/simulator.js'

const GUIDE = 'https://github.com/risqyy/visualise-ai/blob/develop/docs/getting-started.md'
const TAX = 'shop-platform.orders.domain.tax'

async function expectReachable(page: Page, element: Locator) {
  await expect(element).toBeInViewport({ ratio: 1 })
  expect(await element.evaluate((target) => {
    const box = target.getBoundingClientRect()
    return target.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  })).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

// The suite deliberately runs numbered files on one worker. Global setup
// creates an empty real PostgreSQL database; this test runs before any event
// ingestion. A populated reused stack must fail instead of mocking emptiness.
test('a fresh empty instance offers keyboard-reachable agent and demo setup help', async ({ page }, testInfo) => {
  const projects = await getJson('/api/v1/projects')
  expect(projects.status).toBe(200)
  expect(projects.body).toMatchObject({ projects: [] })
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport)
    for (const language of ['de', 'en'] as const) {
      await page.goto('/projects')
      await page.getByTestId(`language-option-${language}`).click()
      const main = page.getByRole('main')
      await expect(main).toContainText(language === 'de' ? 'Noch keine Projekte gemeldet' : 'No projects reported yet')
      await expect(main).toContainText(language === 'de'
        ? 'Dieses Cockpit beobachtet die von Agenten gemeldete Arbeit. Noch hat kein Agent ein Projekt gemeldet.'
        : 'This cockpit observes work reported by agents. No agent has reported a project yet.')
      await expect(main).not.toContainText('/api/v1/events')
      const connect = main.getByRole('link', { name: language === 'de' ? 'Agent verbinden' : 'Connect agent', exact: true })
      const demo = main.getByRole('link', { name: language === 'de' ? 'Demo einrichten' : 'Set up demo', exact: true })
      await expect(connect).toHaveAttribute('href', `${GUIDE}#connect-an-agent`)
      await expect(demo).toHaveAttribute('href', `${GUIDE}#set-up-the-demo`)
      await expect(main.getByRole('link')).toHaveCount(2)
      // The last language control precedes both ordinary links in tab order.
      await page.getByTestId('language-option-en').focus()
      await page.keyboard.press('Tab')
      await expect(connect).toBeFocused()
      await expectReachable(page, connect)
      await page.keyboard.press('Tab')
      await expect(demo).toBeFocused()
      await expectReachable(page, demo)
      await page.keyboard.press('Shift+Tab')
      await expect(connect).toBeFocused()
      await page.screenshot({ path: testInfo.outputPath(`empty-projects-${language}-${viewport.width}.png`) })
    }
  }
  // Reading help and changing language cannot create a project or start work.
  expect((await getJson('/api/v1/projects')).body).toMatchObject({ projects: [] })
})

test('the empty inspector explains component selection and the suggested action opens evidence', async ({ page }, testInfo) => {
  const project = `empty-inspector-${randomUUID().slice(0, 8)}`
  const run = 'run-empty-inspector'
  const seeded = await runSimulator({ scenario: 'full', projectId: project, runId: run, speed: 0, finish: true })
  expect(seeded.created).toBe(seeded.eventsSent)
  expect(seeded.conflicts).toBe(0)
  for (const language of ['de', 'en'] as const) {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto(`/projects/${project}/runs/${run}`)
    await page.getByTestId(`language-option-${language}`).click()
    const inspector = page.getByTestId('pane-inspector')
    await expect(inspector).toContainText(language === 'de' ? 'Keine Komponente ausgewählt' : 'No component selected')
    await expect(inspector).toContainText(language === 'de'
      ? 'Wählen Sie eine Komponente in der Architektur'
      : 'Select a component in the architecture')
    await expect(inspector).not.toContainText(/URL|component=/)
    await expect(page.getByTestId('inspector-context')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`empty-inspector-${language}.png`) })
    await showWholeModel(page)
    await page.getByTestId(`canvas-node-${TAX}`).click()
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
    await expect(page.getByTestId('feedback-entry')).toHaveCount(1)
    await expect(page.getByTestId('unified-diff')).toHaveCount(3)
    await expect(inspector).not.toContainText(language === 'de' ? 'Keine Komponente ausgewählt' : 'No component selected')
  }
})
