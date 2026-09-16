import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { runSimulator } from '../src/simulator.js'

const TAX = 'shop-platform.orders.domain.tax'

async function assertSelectedTab(options: {
  page: Page
  active: Locator
  inactive: Locator
  label: string
  history: boolean
  focus: 'diffs' | undefined
  path: string
}) {
  const { page, active, inactive, label, history, focus, path } = options
  await expect(active).toBeFocused()
  await expect(active).toHaveAttribute('aria-selected', 'true')
  await expect(active).toHaveAttribute('tabindex', '0')
  await expect(inactive).toHaveAttribute('aria-selected', 'false')
  await expect(inactive).toHaveAttribute('tabindex', '-1')
  const tabId = await active.getAttribute('id')
  const panelId = await active.getAttribute('aria-controls')
  const inactiveId = await inactive.getAttribute('id')
  const inactivePanelId = await inactive.getAttribute('aria-controls')
  expect(tabId).toBeTruthy()
  expect(panelId).toBeTruthy()
  expect(inactiveId).toBeTruthy()
  expect(inactivePanelId).toBeTruthy()
  expect(panelId).not.toBe(inactivePanelId)
  const panel = page.locator(`[id="${panelId}"]`)
  const inactivePanel = page.locator(`[id="${inactivePanelId}"]`)
  await expect(panel).toHaveAttribute('role', 'tabpanel')
  await expect(panel).toHaveAttribute('aria-labelledby', tabId!)
  await expect(panel).toHaveAccessibleName(label)
  await expect(panel).toBeVisible()
  await expect(inactivePanel).toHaveAttribute('role', 'tabpanel')
  await expect(inactivePanel).toHaveAttribute('aria-labelledby', inactiveId!)
  await expect(inactivePanel).toBeHidden()
  await expect(page.getByTestId('pane-inspector').locator('[role="tabpanel"]')).toHaveCount(2)
  // Selection changes only the evidence source. The component, run and
  // optional deep-focus context must survive every keyboard transition.
  await expect.poll(() => new URL(page.url()).searchParams.get('history')).toBe(history ? 'true' : null)
  const url = new URL(page.url())
  expect(url.pathname).toBe(path)
  expect(url.searchParams.get('component')).toBe(TAX)
  expect(url.searchParams.get('focus')).toBe(focus ?? null)
  await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
  await expect(page.getByTestId(history ? 'inspector-history' : 'inspector-current-run')).toBeVisible()
  if (focus) await expect(page.getByTestId('deep-focus-banner')).toBeVisible()
}

async function assertSingleTabStop(page: Page, tablist: Locator, active: Locator) {
  await active.press('Tab')
  expect(await tablist.evaluate((element) => element.contains(document.activeElement)),
    'Tab leaves the two-tab group in one keystroke').toBe(false)
  await page.keyboard.press('Shift+Tab')
  await expect(active).toBeFocused()
}

test('inspector source tabs cycle with the keyboard and identify their active panel', async ({ page }, testInfo) => {
  const project = `inspector-keyboard-tabs-${randomUUID().slice(0, 8)}`
  const run = 'run-keyboard-tabs'
  const seeded = await runSimulator({ scenario: 'full', projectId: project, runId: run, speed: 0, finish: false })
  expect(seeded.created).toBe(seeded.eventsSent)
  expect(seeded.conflicts).toBe(0)
  await page.setViewportSize({ width: 1280, height: 720 })
  const path = `/projects/${project}/runs/${run}`

  for (const language of ['de', 'en'] as const) {
    for (const focus of [undefined, 'diffs'] as const) {
      await page.goto(`${path}?component=${TAX}${focus ? `&focus=${focus}` : ''}`)
      await page.getByTestId(`language-option-${language}`).click()
      await expect(page.getByTestId('inspector-current-run')).toBeVisible()
      const runLabel = language === 'de' ? 'Ausgewählter Run' : 'Selected run'
      const historyLabel = language === 'de' ? 'Historie' : 'History'
      const tablist = page.getByRole('tablist', { name: language === 'de' ? 'Belegquelle' : 'Evidence source' })
      const runTab = tablist.getByRole('tab', { name: runLabel, exact: true })
      const historyTab = tablist.getByRole('tab', { name: historyLabel, exact: true })
      await expect(tablist.getByRole('tab')).toHaveCount(2)
      await runTab.focus()
      await runTab.press('ArrowRight')
      // This is the original regression: role="tab" alone did not implement
      // arrow navigation or automatic activation. Fail promptly on that build.
      await expect(historyTab).toBeFocused({ timeout: 3_000 })
      const assertHistory = () => assertSelectedTab({ page, active: historyTab, inactive: runTab, label: historyLabel, history: true, focus, path })
      const assertRun = () => assertSelectedTab({ page, active: runTab, inactive: historyTab, label: runLabel, history: false, focus, path })
      await assertHistory()
      await assertSingleTabStop(page, tablist, historyTab)
      await assertHistory()
      await page.screenshot({ path: testInfo.outputPath(`tabs-history-${focus ?? 'standard'}-${language}.png`) })

      await historyTab.press('ArrowRight')
      await assertRun()
      await runTab.press('ArrowLeft')
      await assertHistory()
      await historyTab.press('ArrowLeft')
      await assertRun()
      await runTab.press('End')
      await assertHistory()
      await historyTab.press('Home')
      await assertRun()
      await assertSingleTabStop(page, tablist, runTab)
      await assertRun()

      // Activation is automatic on focus. Enter and Space retain that active
      // source rather than submitting, scrolling the page or toggling it off.
      await runTab.press('Enter')
      await assertRun()
      await runTab.press('Space')
      await assertRun()
      expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
      await page.screenshot({ path: testInfo.outputPath(`tabs-run-${focus ?? 'standard'}-${language}.png`) })
    }
  }
})
