import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { runSimulator } from '../src/simulator.js'

const TAX = 'shop-platform.orders.domain.tax'
const TARGETS = ['run-agents', 'architecture', 'inspector'] as const

/** Reset only the browser's traversal origin after setup clicks, not app state. */
async function startKeyboardAtDocument(page: Page) {
  await page.evaluate(() => {
    const previous = document.body.getAttribute('tabindex')
    document.body.setAttribute('tabindex', '-1')
    document.body.focus({ preventScroll: true })
    if (previous === null) document.body.removeAttribute('tabindex')
    else document.body.setAttribute('tabindex', previous)
  })
}

async function paintsAtCenter(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return box.width > 1 && box.height > 1 && element.contains(
      document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
    )
  })
}

async function setPanes(page: Page, language: 'de' | 'en', expanded: boolean) {
  const header = page.getByRole('banner')
  for (const name of [language === 'de' ? 'Run- und Agent-Bereich' : 'Runs and agents', 'Inspector']) {
    const toggle = header.getByRole('button', { name, exact: true })
    if (await toggle.getAttribute('aria-expanded') !== String(expanded)) await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded))
  }
}

async function activateSkip(page: Page, targetIndex: number, originalUrl: string) {
  await startKeyboardAtDocument(page)
  for (const target of TARGETS) {
    expect(await paintsAtCenter(page.locator(`a[href="#workspace-${target}-heading"]`)),
      'skip links do not cover the workspace before keyboard focus').toBe(false)
  }
  // The destination is reached with at most three Tab presses and one Enter.
  for (let index = 0; index <= targetIndex; index += 1) {
    await page.keyboard.press('Tab')
    const link = page.locator(`a[href="#workspace-${TARGETS[index]}-heading"]`)
    await expect(link).toBeFocused()
    await expect(link).toBeInViewport({ ratio: 1 })
    expect(await paintsAtCenter(link), 'focused skip link is visibly painted').toBe(true)
  }
  await page.keyboard.press('Enter')
  const target = TARGETS[targetIndex]!
  const heading = page.locator(`#workspace-${target}-heading`)
  await expect(heading).toBeFocused()
  await expect(heading).toHaveJSProperty('tagName', 'H2')
  await expect(heading).toBeInViewport({ ratio: 1 })
  expect(await paintsAtCenter(heading), 'destination heading is unobstructed').toBe(true)
  await expect(page).toHaveURL(originalUrl)
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
  const pane = page.getByTestId(`pane-${target}`)
  await page.keyboard.press('Tab')
  expect(await pane.evaluate((element) => element.contains(document.activeElement)),
    `the next Tab enters ${target}, without traversing the previous panes`).toBe(true)
  expect(await page.evaluate(() => document.activeElement?.matches('button, a[href], input, select, [role="tab"], [role="button"]')),
    'the destination provides an operable next control').toBe(true)
}

test('workspace skip links expose its landmarks and preserve graph keyboard navigation', async ({ page }, testInfo) => {
  const project = `workspace-skip-${randomUUID().slice(0, 8)}`
  const run = 'run-workspace-skip'
  const seeded = await runSimulator({ scenario: 'full', projectId: project, runId: run, speed: 0, finish: false })
  expect(seeded.created).toBe(seeded.eventsSent)
  expect(seeded.conflicts).toBe(0)
  await page.setViewportSize({ width: 1280, height: 720 })
  const url = `/projects/${project}/runs/${run}?component=${TAX}`

  for (const language of ['de', 'en'] as const) {
    await page.goto(url)
    await page.getByTestId(`language-option-${language}`).click()
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
    await expect(page.locator('a[href="#workspace-inspector-heading"]')).toHaveCount(1, { timeout: 3_000 })
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(project)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(run)
    await expect.poll(() => page.title()).toContain(project)
    await expect.poll(() => page.title()).toContain(run)
    await setPanes(page, language, true)
    const markdown = page.getByTestId('feedback-entry').getByTestId('safe-markdown')
    await expect(markdown.locator('h1, h2, h3, h4')).toHaveCount(0)
    expect(await markdown.locator('h5, h6').count()).toBeGreaterThan(1)
    await expect(markdown.locator('h5, h6').first()).toHaveJSProperty('tagName', 'H5')
    await expect(page.getByTestId('run-state').locator('h3')).toHaveCount(1)

    for (const mode of ['standard', 'collapsed', 'architecture-focus', 'deep-focus'] as const) {
      for (let index = 0; index < TARGETS.length; index += 1) {
        await page.goto(`${url}${mode === 'deep-focus' ? '&focus=diffs' : ''}`)
        await expect(page.getByTestId('architecture-canvas')).toBeVisible()
        if (mode === 'deep-focus') {
          await expect(page.getByTestId('deep-focus-banner')).toBeVisible()
          await expect(page.getByTestId('pane-run-agents')).toHaveCount(0)
        } else {
          await setPanes(page, language, true)
        }
        if (mode === 'collapsed') await setPanes(page, language, false)
        if (mode === 'architecture-focus') {
          await page.getByTestId('canvas-toggle-architecture-focus').click()
          await expect(page.getByTestId('canvas-toggle-architecture-focus')).toHaveAttribute('aria-pressed', 'true')
        }
        const originalUrl = page.url()
        await activateSkip(page, index, originalUrl)
        if (mode === 'architecture-focus') {
          await expect(page.getByTestId('canvas-toggle-architecture-focus')).toHaveAttribute('aria-pressed', String(TARGETS[index] === 'architecture'))
        }
        if (mode === 'deep-focus') await expect(page.getByTestId('deep-focus-banner')).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath(`skip-${mode}-${TARGETS[index]}-${language}.png`) })
      }
    }

    await page.goto(url)
    await setPanes(page, language, true)
    await expect(page.getByTestId('architecture-canvas')).toBeVisible()
    // Enter through the existing roving graph Tab stop, then exercise real
    // spatial arrow navigation and Enter selection after the new skip links.
    await page.getByTestId('canvas-fit-view').focus()
    let firstNode: string | null = null
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await page.keyboard.press('Shift+Tab')
      firstNode = await page.evaluate(() => document.activeElement?.matches('.react-flow__node')
        ? document.activeElement.getAttribute('data-id') : null)
      if (firstNode) break
    }
    expect(firstNode, 'the existing graph Tab stop remains reachable').not.toBeNull()
    let nextNode = firstNode
    for (const direction of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
      await page.keyboard.press(direction)
      nextNode = await page.evaluate(() => document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') ?? null)
      expect(nextNode).not.toBeNull()
      if (nextNode !== firstNode) break
    }
    expect(nextNode, 'a spatial arrow moves to another node').not.toBe(firstNode)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', nextNode!)
    expect(new URL(page.url()).searchParams.get('component')).toBe(nextNode)
    expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
    await page.screenshot({ path: testInfo.outputPath(`skip-graph-navigation-${language}.png`) })
  }
})
