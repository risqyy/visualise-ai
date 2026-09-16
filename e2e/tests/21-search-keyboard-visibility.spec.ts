import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

import { runSimulator } from '../src/simulator.js'

const INPUT = 'canvas-component-search-input'
const RESULT = 'canvas-component-search-result'
const TRIGGER = 'canvas-component-search'
const DIALOG = 'canvas-component-search-dialog'
const CLOSE = 'canvas-component-search-close'

async function openSearch(page: Page) {
  const trigger = page.getByTestId(TRIGGER)
  await trigger.focus()
  await trigger.press('Enter')
  const input = page.getByTestId(INPUT)
  await expect(input).toBeFocused()
  await input.fill('visualise-ai')
  await expect(page.getByTestId(RESULT)).toHaveCount(28)
  await expect(input).toHaveAttribute('aria-expanded', 'true')
  return input
}

async function assertActiveVisible(page: Page, index: number) {
  const input = page.getByTestId(INPUT)
  const active = page.getByTestId(RESULT).nth(index)
  const id = await active.getAttribute('id')
  expect(id).not.toBeNull()
  await expect(input).toHaveAttribute('aria-activedescendant', id!)
  await expect(active).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-testid="canvas-component-search-result"][aria-selected="true"]')).toHaveCount(1)
  // No locator action on the option: Playwright must not scroll the broken
  // implementation into view before these geometry assertions get a chance.
  await expect.poll(() => active.evaluate((element) => {
    const list = element.closest('[role="listbox"]') as HTMLElement | null
    if (!list) return false
    const box = element.getBoundingClientRect()
    const clip = list.getBoundingClientRect()
    const left = clip.left + list.clientLeft
    const top = clip.top + list.clientTop
    return box.width > 0 && box.height > 0 &&
      box.left >= left - 0.5 && box.right <= left + list.clientWidth + 0.5 &&
      box.top >= top - 0.5 && box.bottom <= top + list.clientHeight + 0.5 &&
      box.left >= 0 && box.right <= window.innerWidth &&
      box.top >= 0 && box.bottom <= window.innerHeight
  }), { message: `active result ${index} must be inside the list's clipping bounds and viewport` }).toBe(true)
  await expect(page.getByTestId(DIALOG)).toBeInViewport({ ratio: 1 })
  await expect(page.getByTestId(CLOSE)).toBeInViewport({ ratio: 1 })
  await page.getByTestId(CLOSE).click({ trial: true })
  await expect(input).toBeFocused()
  return active.getAttribute('data-component-id')
}

async function assertInputFocusVisible(page: Page) {
  const input = page.getByTestId(INPUT)
  await expect(input).toBeFocused()
  const styles = await input.evaluate((element) => [element, element.parentElement!].map((candidate) => {
    const style = getComputedStyle(candidate)
    return { outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), shadow: style.boxShadow }
  }))
  expect(styles.some((style) =>
    (style.outline !== 'none' && style.outlineWidth > 0) ||
    (style.shadow !== 'none' && !/^(?:rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(?:, )?)+$/.test(style.shadow)),
  ), `focused search input or wrapper needs a visible focus indicator: ${JSON.stringify(styles)}`).toBe(true)
}

test('search keeps keyboard-active results visible and reachable in a small workspace', async ({ page }, testInfo) => {
  const project = `keyboard-search-${randomUUID().slice(0, 8)}`
  const run = 'run-search'
  const summary = await runSimulator({ scenario: 'self', projectId: project, runId: run, speed: 0 })
  expect(summary.created).toBe(summary.eventsSent)
  expect(summary.duplicates).toBe(0)
  expect(summary.conflicts).toBe(0)
  await page.setViewportSize({ width: 1280, height: 720 })

  for (const language of ['de', 'en'] as const) {
    for (const mode of ['standard', 'diff-focus'] as const) {
      await page.goto(`/projects/${project}/runs/${run}?component=visualise-ai.frontend.api${mode === 'diff-focus' ? '&focus=diffs' : ''}`)
      await page.getByTestId(`language-option-${language}`).click()
      await expect(page.getByTestId('architecture-canvas')).toHaveAttribute('data-layouting', 'false')
      if (mode === 'diff-focus') await expect(page.getByTestId('deep-focus-banner')).toBeVisible()
      const selectedIds: string[] = []
      for (const index of [0, 14, 27]) {
        const input = await openSearch(page)
        await assertInputFocusVisible(page)
        for (let step = 0; step < index; step += 1) await input.press('ArrowDown')
        const selectedId = await assertActiveVisible(page, index)
        expect(selectedId).not.toBeNull()
        selectedIds.push(selectedId!)
        if (index > 0) await page.screenshot({ path: testInfo.outputPath(`search-${language}-${mode}-${index === 14 ? 'middle' : 'last'}.png`) })
        await input.press('Enter')
        await expect(page.getByTestId(DIALOG)).toHaveCount(0)
        await expect.poll(() => new URL(page.url()).searchParams.get('component')).toBe(selectedId)
        await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', selectedId!)
      }
      expect(new Set(selectedIds).size).toBe(3)

      const input = await openSearch(page)
      await assertActiveVisible(page, 0)
      await input.press('ArrowUp')
      await assertActiveVisible(page, 27)
      await input.press('ArrowDown')
      await assertActiveVisible(page, 0)
      const selectedBeforeEscape = new URL(page.url()).searchParams.get('component')
      await input.press('Escape')
      await expect(page.getByTestId(DIALOG)).toHaveCount(0)
      await expect(page.getByTestId(TRIGGER)).toBeFocused()
      expect(new URL(page.url()).searchParams.get('component')).toBe(selectedBeforeEscape)

      await openSearch(page)
      await page.getByTestId(CLOSE).focus()
      await page.getByTestId(CLOSE).press('Escape')
      await expect(page.getByTestId(DIALOG)).toHaveCount(0)
      await expect(page.getByTestId(TRIGGER)).toBeFocused()
      expect(new URL(page.url()).searchParams.get('component')).toBe(selectedBeforeEscape)
    }
  }
})
