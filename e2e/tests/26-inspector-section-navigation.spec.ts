import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { postEvent } from '../src/api.js'
import { runSimulator } from '../src/simulator.js'

const TAX = 'shop-platform.orders.domain.tax'
const TARGETS = ['feedback', 'diffs', 'risks', 'problems'] as const

async function assertInsideInspector(target: Locator, scrollport: Locator) {
  await expect(target).toBeInViewport({ ratio: 1 })
  const box = await target.boundingBox()
  const clip = await scrollport.boundingBox()
  expect(box).not.toBeNull()
  expect(clip).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(clip!.y - 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(clip!.y + clip!.height + 1)
  expect(box!.x).toBeGreaterThanOrEqual(clip!.x - 1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(clip!.x + clip!.width + 1)
}

async function assertNavigationAvailable(page: Page) {
  for (const target of TARGETS) {
    const button = page.getByTestId(`inspector-jump-${target}`)
    await expect(button).toBeInViewport({ ratio: 1 })
    expect(await button.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    }), `${target} navigation is unobstructed`).toBe(true)
  }
}

test('inspector counts navigate to complete evidence in one action after long feedback', async ({ page }, testInfo) => {
  const project = `inspector-navigation-${randomUUID().slice(0, 8)}`
  const run = 'run-inspector-navigation'
  const seeded = await runSimulator({ scenario: 'full', projectId: project, runId: run, speed: 0, finish: false })
  expect(seeded.created).toBe(seeded.eventsSent)
  expect(seeded.conflicts).toBe(0)
  const additionalFeedback = [1, 2].map((index) => ({
    id: `navigation-feedback-${index}`,
    title: `Navigation evidence ${index}`,
    paragraphs: Array.from({ length: 12 }, (_, paragraph) =>
      `Report ${index}, paragraph ${paragraph + 1}: The component preserves each reported calculation and its dependency evidence. Reviewers must be able to read this complete account before returning directly to diffs, risks and problems.`),
  }))
  for (const entry of additionalFeedback) {
    const accepted = await postEvent({
      schemaVersion: '1.0', clientEventId: randomUUID(), projectId: project, runId: run,
      agentId: 'orchestrator-root', parentAgentId: null, occurredAt: new Date().toISOString(),
      type: 'feedback.published', payload: {
        feedbackId: entry.id, componentIds: [TAX], format: 'markdown',
        title: entry.title, body: entry.paragraphs.join('\n\n'),
      },
    })
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201)
  }

  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size)
    for (const language of ['de', 'en'] as const) {
      await page.goto(`/projects/${project}/runs/${run}?component=${TAX}`)
      await page.getByTestId(`language-option-${language}`).click()
      await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
      await expect(page.getByTestId('feedback-entry')).toHaveCount(3)
      const originalUrl = page.url()
      const scrollport = page.getByTestId('inspector-scroll')
      await expect(page.getByTestId('inspector-jump-feedback')).toBeVisible({ timeout: 3_000 })
      await assertNavigationAvailable(page)
      for (const [target, count] of [['feedback', 3], ['diffs', 3], ['risks', 1], ['problems', 0]] as const) {
        await expect(page.getByTestId(`inspector-jump-${target}`)).toContainText(String(count))
      }
      // Plain paragraphs make the full reported text comparable byte-for-byte
      // after Markdown rendering, including both ends of each long report.
      for (const entry of additionalFeedback) {
        const article = page.locator(`[data-feedback-id="${entry.id}"]`)
        await expect(article.getByRole('heading', { level: 4 })).toHaveText(entry.title)
        expect(await article.getByTestId('safe-markdown').locator('p').allTextContents()).toEqual(entry.paragraphs)
      }
      expect(await scrollport.evaluate((element) => element.scrollHeight - element.clientHeight))
        .toBeGreaterThan(3_000)

      for (const target of TARGETS) {
        // Start each jump at the component head using real pane scrolling. No
        // target locator may scroll itself into view before these assertions.
        await scrollport.hover()
        await page.mouse.wheel(0, -100_000)
        await expect.poll(() => scrollport.evaluate((element) => element.scrollTop)).toBe(0)
        const jump = page.getByTestId(`inspector-jump-${target}`)
        await expect(jump).toHaveAttribute('aria-controls', `inspector-${target}-section`)
        if (target === 'diffs') {
          await jump.focus()
          await jump.press('Enter')
        } else {
          await jump.click()
        }
        const heading = page.locator(`#inspector-${target}-heading`)
        await expect(heading).toBeFocused()
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
        await assertInsideInspector(heading, scrollport)
        const section = page.locator(`#inspector-${target}-section`)
        if (target === 'feedback') {
          await assertInsideInspector(section.getByTestId('feedback-entry').first().getByRole('heading', { level: 4 }), scrollport)
          await assertInsideInspector(section.getByTestId('feedback-entry').first().getByTestId('safe-markdown').locator('p').first(), scrollport)
        } else if (target === 'diffs') {
          await assertInsideInspector(section.getByTestId('diff-group').first().getByRole('heading', { level: 4 }), scrollport)
          await assertInsideInspector(section.getByTestId('unified-diff').first().locator('[data-line-kind="hunk"] [data-reported]').first(), scrollport)
        } else if (target === 'risks') {
          await assertInsideInspector(section.getByTestId('risk-entry').first(), scrollport)
          await expect(section).toContainText('Orders priced before and after the change are not comparable. Nothing in this run checked historical orders.')
        } else {
          await expect(section.getByTestId('problem-entry')).toHaveCount(0)
          await assertInsideInspector(section.locator('p').first(), scrollport)
        }
        await assertNavigationAvailable(page)
        await expect(page).toHaveURL(originalUrl)
        await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
        await page.screenshot({ path: testInfo.outputPath(`inspector-${target}-${size.height}-${language}.png`) })
      }

      // The same compact navigation stays reachable after reading the very end
      // of an earlier long report, without collapsing or truncating its body.
      const lastParagraph = page.locator(`[data-feedback-id="${additionalFeedback[0]!.id}"]`)
        .getByTestId('safe-markdown').locator('p').last()
      await lastParagraph.scrollIntoViewIfNeeded()
      await assertInsideInspector(lastParagraph, scrollport)
      expect(await scrollport.evaluate((element) => element.scrollTop)).toBeGreaterThan(1_000)
      await assertNavigationAvailable(page)
      await page.getByTestId('inspector-jump-risks').click()
      await expect(page.locator('#inspector-risks-heading')).toBeFocused()
      await assertInsideInspector(page.getByTestId('risk-entry'), scrollport)

      await page.getByRole('tab', { name: language === 'de' ? 'Historie' : 'History', exact: true }).click()
      await expect(page.getByTestId('inspector-history')).toBeVisible()
      for (const target of TARGETS) await expect(page.getByTestId(`inspector-jump-${target}`)).toHaveCount(0)
      await page.goto(`${originalUrl}&focus=diffs`)
      await expect(page.getByTestId('deep-focus-banner')).toBeVisible()
      await expect(page.getByTestId('diff-groups')).toBeVisible()
      for (const target of TARGETS) await expect(page.getByTestId(`inspector-jump-${target}`)).toHaveCount(0)
    }
  }
})
