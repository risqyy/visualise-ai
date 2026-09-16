import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import axe from 'axe-core'

import { bootstrapEvent, postEvent } from '../src/api.js'
import { runSimulator } from '../src/simulator.js'

const TAX = 'shop-platform.orders.domain.tax'
const PRICING = 'shop-platform.orders.domain.pricing'
const LINE_KINDS = ['meta', 'hunk', 'context', 'addition', 'removal'] as const

type ContrastSample = { label: string; target: unknown; ratio: number; foreground: string; background: string; method: string }

/** Run the real browser rule against a scrolled, painted element. Missing or
 * indeterminate results are failures: a scan of no text cannot prove contrast. */
async function checkContrast(page: Page, target: Locator, label: string, minimumChecks: number): Promise<ContrastSample[]> {
  await target.scrollIntoViewIfNeeded()
  await expect(target).toBeVisible()
  await expect(target).toBeInViewport()
  await target.evaluate((element) => element.setAttribute('data-contrast-probe', 'active'))
  try {
    const result = await page.evaluate(async () => {
      const browserAxe = (window as typeof window & { axe: typeof axe }).axe
      const probe = document.querySelector('[data-contrast-probe="active"]')!
      const report = await browserAxe.run(probe, {
        runOnly: { type: 'rule', values: ['color-contrast'] },
        elementRef: true,
      })
      const withinProbe = (node: axe.NodeResult) => node.element != null && probe.contains(node.element)
      const incomplete = report.incomplete.flatMap((rule) => rule.nodes.filter(withinProbe))
      const fallback = incomplete.flatMap((node) => {
        const element = node.element
        const checks = [...node.any, ...node.all, ...node.none]
        if (!element?.closest('[data-testid="unified-diff"] td') ||
            checks.length !== 1 || !['shortTextContent', 'bgOverlap'].includes(checks[0]?.data?.messageKey as string) ||
            checks[0]?.data?.fgColor != null || checks[0]?.data?.bgColor != null) return []
        // Axe cannot resolve some transparent table-cell backgrounds. Only for
        // those unresolved diff cells, Chromium paints the actual CSS colors
        // into a pixel; no screenshot antialiasing or guessed backdrop enters
        // the WCAG luminance calculation. Unsupported paint fails explicitly.
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')!
        // Reject actual occlusion before accepting an axe background ambiguity.
        // Character rectangles avoid counting the empty part of a wide table
        // cell as evidence that its visible text was inspected.
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        let measuredCharacters = 0
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          for (let index = 0; index < (text.textContent?.length ?? 0); index += 1) {
            if (!/\S/u.test(text.textContent![index]!)) continue
            const range = document.createRange()
            range.setStart(text, index)
            range.setEnd(text, index + 1)
            const box = range.getBoundingClientRect()
            const topmost = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
            if (box.width <= 0 || box.height <= 0 || !topmost ||
                !element.contains(topmost)) throw new Error('Diff text is occluded or outside its scroll viewport')
            measuredCharacters += 1
          }
        }
        if (measuredCharacters === 0) throw new Error('No painted characters for contrast fallback')
        const ancestors: Element[] = []
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) ancestors.unshift(ancestor)
        for (const ancestor of ancestors) {
          const style = getComputedStyle(ancestor)
          if (style.opacity !== '1' || style.backgroundImage !== 'none' || style.mixBlendMode !== 'normal' ||
              style.filter !== 'none' || style.backdropFilter !== 'none' || style.textShadow !== 'none' || style.boxShadow !== 'none') {
            throw new Error('Unsupported paint in diff contrast fallback')
          }
          for (const pseudo of ['::before', '::after']) {
            const content = getComputedStyle(ancestor, pseudo).content
            if (content !== 'none' && content !== 'normal') throw new Error('Pseudo-element paint requires manual contrast analysis')
          }
          context.fillStyle = style.backgroundColor
          context.fillRect(0, 0, 1, 1)
        }
        const background = [...context.getImageData(0, 0, 1, 1).data]
        if (background[3] !== 255) throw new Error('No opaque background for diff-cell contrast')
        context.fillStyle = getComputedStyle(element).color
        context.fillRect(0, 0, 1, 1)
        const foreground = [...context.getImageData(0, 0, 1, 1).data]
        const luminance = (rgba: number[]) => rgba.slice(0, 3).reduce((sum, channel, index) => {
          const value = channel / 255
          return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!
        }, 0)
        const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b)
        return [{ node, sample: {
          target: node.target, ratio: (values[1]! + 0.05) / (values[0]! + 0.05),
          foreground: `rgba(${foreground.join(',')})`, background: `rgba(${background.join(',')})`,
          method: 'Chromium CSS composition: axe unresolved diff cell',
        } }]
      })
      return {
        violations: report.violations.flatMap((rule) => rule.nodes.filter(withinProbe)),
        incomplete: incomplete.filter((node) => !fallback.some((entry) => entry.node === node)),
        passes: [...fallback.map((entry) => entry.sample), ...report.passes.flatMap((rule) => rule.nodes.filter(withinProbe).flatMap((node) =>
          [...node.any, ...node.all, ...node.none]
            .filter((check) => check.id === 'color-contrast')
            .map((check) => ({
              target: node.target,
              ratio: check.data?.contrastRatio as number,
              foreground: check.data?.fgColor as string,
              background: check.data?.bgColor as string,
              method: 'axe color-contrast',
            })),
        ))],
      }
    })
    expect(result.violations, `${label}: color contrast violations`).toEqual([])
    expect(result.incomplete, `${label}: contrast must be measurable`).toEqual([])
    expect(result.passes.length, `${label}: actual measured text pairs`).toBeGreaterThanOrEqual(minimumChecks)
    for (const sample of result.passes) {
      expect(sample.ratio, `${label}: ${JSON.stringify(sample)}`).toBeGreaterThanOrEqual(4.5)
    }
    return result.passes.map((sample) => ({ label, ...sample }))
  } finally {
    await target.evaluate((element) => element.removeAttribute('data-contrast-probe'))
  }
}

test('small status, historical and diff text reaches 4.5:1 at relevant scroll positions', async ({ page }, testInfo) => {
  const project = `text-contrast-${randomUUID().slice(0, 8)}`
  const run = 'run-contrast-finished'
  const summary = await runSimulator({ scenario: 'full', projectId: project, runId: run, finish: true, speed: 0 })
  expect(summary.created).toBe(summary.eventsSent)
  expect(summary.conflicts).toBe(0)
  const newerRun = await postEvent(bootstrapEvent({
    clientEventId: randomUUID(), projectId: project, runId: 'run-contrast-newer',
    agentId: 'contrast-newer-author', occurredAt: new Date().toISOString(),
  }))
  expect(newerRun.status, JSON.stringify(newerRun.body)).toBe(201)

  const samples: ContrastSample[] = []
  const coveredKinds = new Set<string>()
  let checkedFiles = 0
  let checkedNumberedRows = 0
  for (const language of ['de', 'en'] as const) {
    await page.goto(`/projects/${project}/runs/${run}?component=${TAX}`)
    await page.getByTestId(`language-option-${language}`).click()
    await page.addScriptTag({ content: axe.source })
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-run-id', run)
    // Reloaded, finished evidence has no transient live states. Two open
    // proposals persist as planned; the three zero labels are still readable
    // status information, not disabled controls.
    for (const state of ['planned', 'active', 'recently_applied', 'removed']) {
      const counter = page.getByTestId(`change-counter-${state}`)
      const count = state === 'planned' ? '2' : '0'
      await expect(counter).toHaveAttribute('data-count', count)
      samples.push(...await checkContrast(page, counter, `${language}: count ${count} ${state}`, 2))
    }
    samples.push(...await checkContrast(page, page.getByTestId('historical-run-banner').locator('p').nth(1), `${language}: historical explanation`, 1))
    samples.push(...await checkContrast(page, page.getByTestId('architecture-temporal-scope'), `${language}: project model scope`, 1))
    await page.screenshot({ path: testInfo.outputPath(`text-contrast-standard-${language}.png`) })

    // Tax has long addition-only files; Pricing also exercises removed and
    // unchanged lines. Inspect each file separately, including both ends of
    // every non-empty line kind so inner and inspector scrollports both move.
    for (const component of [TAX, PRICING]) {
      await page.goto(`/projects/${project}/runs/${run}?component=${component}&focus=diffs`)
      await page.addScriptTag({ content: axe.source })
      await expect(page.getByTestId('diff-groups')).toBeVisible()
      await expect(page.getByTestId('deep-focus-banner')).toBeVisible()
      const files = page.getByTestId('unified-diff')
      const count = await files.count()
      expect(count, `${component}: representative diff files`).toBeGreaterThanOrEqual(component === TAX ? 2 : 1)
      for (let fileIndex = 0; fileIndex < count; fileIndex += 1) {
        const file = files.nth(fileIndex)
        const path = await file.getAttribute('data-file-path')
        samples.push(...await checkContrast(page, file.locator('figcaption'), `${language}: ${path} caption`, 3))
        checkedFiles += 1
        for (const kind of LINE_KINDS) {
          const rows = file.locator(`tr[data-line-kind="${kind}"]`)
          const indices = await rows.evaluateAll((elements) => elements.flatMap((element, index) => {
            const code = element.querySelector('td:last-child [data-reported]')?.textContent?.trim() ?? ''
            return /[\p{L}\p{N}]/u.test(code) ? [index] : []
          }))
          if (indices.length === 0) continue
          coveredKinds.add(`${language}:${kind}`)
          for (const index of new Set([indices[0]!, indices.at(-1)!])) {
            const row = rows.nth(index)
            const numberedCells = await row.locator('td').evaluateAll((cells) =>
              cells.slice(0, 2).flatMap((cell, index) => (cell.textContent?.trim().length ?? 0) > 0 ? [index] : []),
            )
            // Axe deliberately ignores punctuation-only code such as "+}".
            // Measure letters/numbers in code and each numbered gutter
            // separately so one passing cell cannot hide another missing one.
            samples.push(...await checkContrast(page, row.locator('td').last(), `${language}: ${path} ${kind}[${index}] code`, 1))
            for (const cellIndex of numberedCells) {
              samples.push(...await checkContrast(page, row.locator('td').nth(cellIndex), `${language}: ${path} ${kind}[${index}] gutter ${cellIndex}`, 1))
            }
            if (numberedCells.length > 0) checkedNumberedRows += 1
          }
        }
        await page.screenshot({ path: testInfo.outputPath(`text-contrast-${language}-${component === TAX ? 'tax' : 'pricing'}-${fileIndex}.png`) })
      }
    }
  }
  expect([...coveredKinds].sort()).toEqual(['de', 'en'].flatMap((language) => LINE_KINDS.map((kind) => `${language}:${kind}`)).sort())
  expect(checkedFiles).toBeGreaterThanOrEqual(6)
  expect(checkedNumberedRows).toBeGreaterThanOrEqual(8)
  await testInfo.attach('measured-text-contrast', {
    body: JSON.stringify({ minimum: 4.5, checkedFiles, checkedNumberedRows, samples }, null, 2),
    contentType: 'application/json',
  })
})
