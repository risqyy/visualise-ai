import { expect, test, type Page } from '@playwright/test'

import { BASE_URL, MAIN_PROJECT, MAIN_RUN } from '../src/config.js'
import { showWholeModel } from '../src/canvas.js'

/**
 * Issue #59 — canvas actions keep a usable screen-space target while the
 * drawing surface zooms. The visual glyphs stay compact; these measurements
 * intentionally use the actual interactive elements and their browser boxes.
 */

const VIEWPORT = { width: 1920, height: 1080 } as const
const DESKTOP_TARGET = 32
const COARSE_TARGET = 44
const CANVAS_URL = `/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}`

const TOOLBAR_ACTIONS = [
  '[data-testid="canvas-component-search"]',
  '[data-testid="canvas-fit-view"]',
  '[data-testid="canvas-layout-top-down"]',
  '[data-testid="canvas-layout-left-right"]',
  '[data-testid="canvas-toggle-minimap"]',
] as const

async function openCanvas(page: Page): Promise<void> {
  await page.goto(CANVAS_URL)
  await expect(page.getByTestId('architecture-canvas')).toHaveAttribute(
    'data-layouting',
    'false',
  )
  await showWholeModel(page)
}

async function zoomAtLeast(page: Page, minimum: number): Promise<void> {
  const zoomIn = page.locator('.react-flow__controls-zoomin')
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const zoom = Number(await page.getByTestId('architecture-canvas').getAttribute('data-canvas-zoom'))
    if (zoom >= minimum) return
    await zoomIn.click()
  }
  await expect
    .poll(async () =>
      Number(await page.getByTestId('architecture-canvas').getAttribute('data-canvas-zoom')),
    )
    .toBeGreaterThanOrEqual(minimum)
}

async function assertTarget(
  page: Page,
  selector: string,
  minimum: number,
  label: string,
): Promise<void> {
  const target = page.locator(selector).first()
  await expect(target, `${label}: target is missing`).toBeVisible()
  const box = await target.boundingBox()
  expect(box, `${label}: target has no browser box`).not.toBeNull()
  expect(box!.width, `${label}: width`).toBeGreaterThanOrEqual(minimum)
  expect(box!.height, `${label}: height`).toBeGreaterThanOrEqual(minimum)
}

/**
 * At map zoom, single relationships intentionally have no HTML label: the
 * transparent SVG interaction path is the relationship action instead. Its
 * browser box is route-shaped, so the effective radial target is measured from
 * its computed stroke width after applying the live canvas zoom.
 */
async function assertRelationshipAction(
  page: Page,
  minimum: number,
  label: string,
): Promise<void> {
  const button = page
    .locator(
      '[data-testid^="edge-bundle-"], [data-testid^="edge-label-"], [data-testid^="edge-collapse-"]',
    )
    .first()
  if ((await button.count()) > 0) {
    await assertTarget(
      page,
      '[data-testid^="edge-bundle-"], [data-testid^="edge-label-"], [data-testid^="edge-collapse-"]',
      minimum,
      label,
    )
    return
  }

  const interactionPath = page.locator('.react-flow__edge-interaction').first()
  await expect(interactionPath, `${label}: no interactive edge path`).toBeAttached()
  const measurement = await interactionPath.evaluate((element) => {
    const canvas = document.querySelector('[data-testid="architecture-canvas"]')
    const zoom = Number.parseFloat(
      canvas ? window.getComputedStyle(canvas).getPropertyValue('--vai-canvas-zoom') : '1',
    )
    const strokeWidth = Number.parseFloat(window.getComputedStyle(element).strokeWidth)
    const rect = element.getBoundingClientRect()
    return {
      width: rect.width,
      height: rect.height,
      effectiveStrokeWidth: strokeWidth * zoom,
    }
  })
  expect(measurement.effectiveStrokeWidth, `${label}: effective edge hit width`).toBeGreaterThanOrEqual(
    minimum,
  )
  expect(
    Math.max(measurement.width, measurement.height),
    `${label}: edge path has no measurable browser box`,
  ).toBeGreaterThan(0)
}

async function assertCanvasTargets(page: Page, minimum: number, zoomLabel: string) {
  for (const selector of TOOLBAR_ACTIONS) {
    await assertTarget(page, selector, minimum, `${zoomLabel} toolbar ${selector}`)
  }
  await assertTarget(
    page,
    '.react-flow__controls-zoomin',
    minimum,
    `${zoomLabel} zoom in`,
  )
  await assertTarget(
    page,
    '.react-flow__controls-zoomout',
    minimum,
    `${zoomLabel} zoom out`,
  )
  await assertTarget(
    page,
    '[data-testid^="node-disclosure-"]',
    minimum,
    `${zoomLabel} disclosure`,
  )
  await assertRelationshipAction(
    page,
    minimum,
    `${zoomLabel} relationship action`,
  )
}

async function assertRelationshipActionsDoNotOverlap(page: Page): Promise<void> {
  const overlaps = await page.evaluate(() => {
    const boxes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid^="edge-bundle-"], [data-testid^="edge-label-"], [data-testid^="edge-collapse-"]',
      ),
    )
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          id: element.getAttribute('data-testid') ?? '<unknown>',
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        }
      })
      .filter((box) => box.right > box.left && box.bottom > box.top)

    const result: string[] = []
    for (let index = 0; index < boxes.length; index += 1) {
      const first = boxes[index]
      if (!first) continue
      for (let next = index + 1; next < boxes.length; next += 1) {
        const second = boxes[next]
        if (!second) continue
        const horizontal = Math.min(first.right, second.right) - Math.max(first.left, second.left)
        const vertical = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
        if (horizontal > 0 && vertical > 0) result.push(`${first.id} overlaps ${second.id}`)
      }
    }
    return result
  })
  expect(overlaps, 'independent relationship actions must not overlap').toEqual([])
}

async function viewportTransform(page: Page): Promise<string> {
  return page.locator('.react-flow__viewport').evaluate((element) => element.getAttribute('style') ?? '')
}

test('10 · canvas hit areas stay measurable at several zoom levels for fine and coarse pointers', async ({
  browser,
}) => {
  for (const pointer of [
    { name: 'fine', hasTouch: false, minimum: DESKTOP_TARGET },
    { name: 'coarse', hasTouch: true, minimum: COARSE_TARGET },
  ] as const) {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: VIEWPORT,
      isMobile: false,
      hasTouch: pointer.hasTouch,
    })
    const page = await context.newPage()
    try {
      await openCanvas(page)
      await expect
        .poll(() => page.evaluate(() => window.matchMedia('(pointer: coarse)').matches))
        .toBe(pointer.hasTouch)

      for (const [zoomLabel, minimumZoom] of [
        ['map', 0],
        ['readable', 0.93],
        ['full', 1.15],
      ] as const) {
        if (zoomLabel === 'map') {
          await page.getByTestId('canvas-fit-view').click()
        } else {
          await zoomAtLeast(page, minimumZoom)
        }
        await assertCanvasTargets(page, pointer.minimum, `${pointer.name} ${zoomLabel}`)
      }

      await assertRelationshipActionsDoNotOverlap(page)

      // The generous hit areas must stay controls, not become a drag/pan
      // gesture. Disclosure relayouts the graph but never moves the camera;
      // selecting a relationship must not move it either.
      const canvas = page.getByTestId('architecture-canvas')
      const beforeTransform = await viewportTransform(page)
      const beforeFitCount = await canvas.getAttribute('data-fit-view-count')
      const disclosure = page.locator('[data-testid^="node-disclosure-"]').first()
      const wasExpanded = (await disclosure.getAttribute('aria-expanded')) === 'true'
      await disclosure.click()
      await expect(disclosure).toHaveAttribute('aria-expanded', wasExpanded ? 'false' : 'true')
      await expect(canvas).toHaveAttribute('data-layouting', 'false')
      await expect(canvas).toHaveAttribute('data-fit-view-count', beforeFitCount ?? '')
      expect(await viewportTransform(page)).toBe(beforeTransform)

      const relationship = page
        .locator(
          '[data-testid^="edge-bundle-"], [data-testid^="edge-label-"], [data-testid^="edge-collapse-"]',
        )
        .first()
      await relationship.click()
      await expect(canvas).toHaveAttribute('data-fit-view-count', beforeFitCount ?? '')
      expect(await viewportTransform(page)).toBe(beforeTransform)
    } finally {
      await context.close()
    }
  }
})
