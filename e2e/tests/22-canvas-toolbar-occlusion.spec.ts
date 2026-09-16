import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

import { showWholeModel } from '../src/canvas.js'
import { probeControls, formatControlReports } from '../src/controls.js'
import { runSimulator } from '../src/simulator.js'

const ENTRIES = [
  { id: 'browser', name: 'Operator Browser' },
  { id: 'visualise-ai.repository-provider', name: 'Repository Provider' },
] as const

async function settled(page: Page) {
  await expect(page.getByTestId('architecture-canvas')).toHaveAttribute('data-layouting', 'false')
  let previous = '', matches = 0
  await expect.poll(async () => {
    const current = await page.locator('.react-flow__viewport').getAttribute('style') ?? ''
    matches = previous === current ? matches + 1 : 0
    previous = current
    return matches
  }, { intervals: [100] }).toBeGreaterThanOrEqual(2)
}

async function assertLabelUnobscured(page: Page, componentId: string, stage: string) {
  const node = page.getByTestId(`canvas-node-${componentId}`)
  await expect(node).toBeAttached()
  // Read geometry only: clicking, focusing or scrollIntoView could conceal an
  // incorrect initial camera by moving the target before it is inspected.
  const geometry = await node.evaluate((element) => {
    const canvas = element.closest('.react-flow')
    if (!canvas) throw new Error('Node is not inside the actual React Flow drawing surface')
    const canvasBox = canvas.getBoundingClientRect()
    const label = element.querySelector('[data-testid="node-name"]')
    if (!label) throw new Error(`Expected readable node label; actual detail level is ${element.getAttribute('data-detail-level')}`)
    const box = label.getBoundingClientRect()
    const reportBox = (rect: DOMRect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    const failures: string[] = []
    let characters = 0
    const checkPoint = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y)
      if (!hit || !element.contains(hit)) failures.push(`covered by ${hit?.getAttribute('data-testid') ?? hit?.className ?? 'viewport edge'}`)
    }
    const inside = (rect: DOMRect) => rect.left >= canvasBox.left - 0.5 && rect.right <= canvasBox.right + 0.5 &&
      rect.top >= canvasBox.top - 0.5 && rect.bottom <= canvasBox.bottom + 0.5 &&
      rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
    if (!inside(box) || box.width <= 0 || box.height <= 0) failures.push('label outside visible canvas')
    checkPoint(box.x + box.width / 2, box.y + box.height / 2)
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      for (let index = 0; index < (text.textContent?.length ?? 0); index += 1) {
        if (!/\S/u.test(text.textContent![index]!)) continue
        const range = document.createRange()
        range.setStart(text, index)
        range.setEnd(text, index + 1)
        const character = range.getBoundingClientRect()
        if (!inside(character) || character.left < box.left - 0.5 || character.right > box.right + 0.5) failures.push('text is clipped')
        checkPoint(character.x + character.width / 2, character.y + character.height / 2)
        characters += 1
      }
    }
    return { canvas: reportBox(canvasBox), label: reportBox(box), characters, failures: [...new Set(failures)] }
  })
  expect(geometry.characters, `${stage}: ${componentId} has reported text`).toBeGreaterThan(0)
  expect(geometry.failures, `${stage}: ${componentId} ${JSON.stringify(geometry)}`).toEqual([])
}

async function assertMapNodeUnobscured(page: Page, componentId: string) {
  const node = page.getByTestId(`canvas-node-${componentId}`)
  await expect(node).toBeAttached()
  const geometry = await node.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const surface = element.closest('.react-flow')!.getBoundingClientRect()
    const points = [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]]
    return {
      inside: box.width > 0 && box.height > 0 && box.left >= surface.left && box.right <= surface.right &&
        box.top >= surface.top && box.bottom <= surface.bottom && box.left >= 0 && box.top >= 0 &&
        box.right <= innerWidth && box.bottom <= innerHeight,
      hits: points.map(([x, y]) => {
        const hit = document.elementFromPoint(box.x + box.width * x!, box.y + box.height * y!)
        return hit !== null && element.contains(hit)
      }),
    }
  })
  expect(geometry.inside, `${componentId}: map glyph inside drawing surface`).toBe(true)
  expect(geometry.hits.every(Boolean), `${componentId}: unobscured map glyph hit points`).toBe(true)
}

async function assertPrimaryControls(page: Page) {
  const reports = await probeControls(page, [
    { name: 'search', selector: '[data-testid="canvas-component-search"]' },
    { name: 'whole map', selector: '[data-testid="canvas-fit-view"]' },
    { name: 'readable overview', selector: '[data-testid="canvas-back-to-overview"]' },
    { name: 'architecture focus', selector: '[data-testid="canvas-toggle-architecture-focus"]' },
    { name: 'secondary tools', selector: '[data-testid="canvas-toggle-tools"]' },
    { name: 'zoom in', selector: '.react-flow__controls-zoomin' },
    { name: 'zoom out', selector: '.react-flow__controls-zoomout' },
  ])
  expect(reports.every((entry) => entry.found && entry.rendered && entry.insideViewport && entry.unobstructed), formatControlReports(reports)).toBe(true)
}

async function inspectToolDock(page: Page) {
  const toggle = page.getByTestId('canvas-toggle-tools')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('canvas-layout-top-down')).not.toBeVisible()
  const before = await page.locator('.react-flow').boundingBox()
  expect(before).not.toBeNull()
  expect(before!.height, 'closed tools leave a useful drawing surface at 1280 × 720').toBeGreaterThan(300)
  const canvas = page.getByTestId('architecture-canvas')
  const cameraBefore = await page.locator('.react-flow__viewport').getAttribute('style')
  const fitCountBefore = await canvas.getAttribute('data-fit-view-count')
  expect(cameraBefore).not.toBeNull()
  expect(fitCountBefore).not.toBeNull()
  async function assertCameraAfterResize(open: boolean) {
    // Observe both the painted dimensions and React Flow's reported resize
    // before checking camera state. An assertion against the previous size
    // would pass before the resize-triggered fit had a chance to run.
    await expect.poll(() => page.evaluate(({ initialHeight, isOpen }) => {
      const surface = document.querySelector('.react-flow')!.getBoundingClientRect()
      const canvasElement = document.querySelector('[data-testid="architecture-canvas"]')!
      const reportedWidth = Number(canvasElement.getAttribute('data-surface-width'))
      const reportedHeight = Number(canvasElement.getAttribute('data-surface-height'))
      const resized = isOpen ? surface.height < initialHeight - 1 : Math.abs(surface.height - initialHeight) < 1
      return resized && Math.abs(reportedWidth - surface.width) < 1 && Math.abs(reportedHeight - surface.height) < 1
    }, { initialHeight: before!.height, isOpen: open }), {
      message: `${open ? 'opening' : 'closing'} tools must finish the actual drawing-surface resize`,
    }).toBe(true)
    await settled(page)
    await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', cameraBefore!)
    await expect(canvas).toHaveAttribute('data-fit-view-count', fitCountBefore!)
  }
  await assertPrimaryControls(page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await assertCameraAfterResize(true)
  const reports = await probeControls(page, [
    { name: 'top-down orientation', selector: '[data-testid="canvas-layout-top-down"]' },
    { name: 'left-right orientation', selector: '[data-testid="canvas-layout-left-right"]' },
    { name: 'minimap toggle', selector: '[data-testid="canvas-toggle-minimap"]' },
  ])
  expect(reports.every((entry) => entry.found && entry.rendered && entry.insideViewport && entry.unobstructed), formatControlReports(reports)).toBe(true)
  const minimapToggle = page.getByTestId('canvas-toggle-minimap')
  if ((await minimapToggle.getAttribute('aria-pressed')) !== 'true') await minimapToggle.click()
  await expect(page.locator('.react-flow__minimap')).toBeVisible()
  const geometry = await page.evaluate(() => {
    const flow = document.querySelector('.react-flow')!.getBoundingClientRect()
    return ['[data-testid="canvas-primary-actions"]', '[data-testid="canvas-layout-top-down"]',
      '[data-testid="canvas-layout-left-right"]', '[data-testid="canvas-toggle-minimap"]', '.react-flow__minimap', '.react-flow__controls']
      .map((selector) => {
        const element = document.querySelector(selector)!
        const box = element.getBoundingClientRect()
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        return { selector, overlapsDrawing: box.left < flow.right && box.right > flow.left && box.top < flow.bottom && box.bottom > flow.top,
          insideViewport: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
          unobscured: hit !== null && element.contains(hit) }
      })
  })
  expect(geometry.every((entry) => !entry.overlapsDrawing && entry.insideViewport && entry.unobscured), JSON.stringify(geometry)).toBe(true)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.react-flow__minimap')).not.toBeVisible()
  await assertCameraAfterResize(false)
}

async function enterGraph(page: Page) {
  await page.getByTestId('canvas-fit-view').focus()
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await page.keyboard.press('Shift+Tab')
    const id = await page.evaluate(() => document.activeElement?.matches('.react-flow__node') ? document.activeElement.getAttribute('data-id') : null)
    if (id !== null) return id
  }
  throw new Error('Tab navigation did not enter the graph')
}

test('canvas navigation keeps entry labels clear of toolbar and other controls', async ({ page }, testInfo) => {
  const project = `toolbar-occlusion-${randomUUID().slice(0, 8)}`
  const run = 'run-canvas-occlusion'
  const summary = await runSimulator({ scenario: 'self', projectId: project, runId: run, speed: 0 })
  expect(summary.created).toBe(summary.eventsSent)
  expect(summary.conflicts).toBe(0)
  await page.setViewportSize({ width: 1280, height: 720 })
  for (const language of ['de', 'en'] as const) {
    await page.goto(`/projects/${project}/runs/${run}`)
    await page.getByTestId(`language-option-${language}`).click()
    await settled(page)
    await page.screenshot({ path: testInfo.outputPath(`canvas-initial-${language}.png`) })
    for (const entry of ENTRIES) await assertLabelUnobscured(page, entry.id, `${language}: initial`)
    await assertPrimaryControls(page)
    await inspectToolDock(page)
    for (const entry of ENTRIES) await assertLabelUnobscured(page, entry.id, `${language}: closed tools`)

    await showWholeModel(page)
    await settled(page)
    // Explicit Whole Map may fall below the established text floor and show
    // shapes only. Those actual map glyphs must still be clear and selectable.
    for (const entry of ENTRIES) await assertMapNodeUnobscured(page, entry.id)
    await assertPrimaryControls(page)
    await page.screenshot({ path: testInfo.outputPath(`canvas-whole-map-${language}.png`) })

    await page.getByTestId('canvas-back-to-overview').click()
    await settled(page)

    const canvas = page.getByTestId('architecture-canvas')
    for (const entry of ENTRIES) {
      const zoom = await canvas.getAttribute('data-canvas-zoom')
      await page.getByTestId('canvas-component-search').click()
      const input = page.getByTestId('canvas-component-search-input')
      await input.fill(entry.name)
      await expect(page.getByTestId('canvas-component-search-result')).toHaveCount(1)
      await input.press('Enter')
      await expect(page.getByTestId('canvas-component-search-dialog')).toHaveCount(0)
      await settled(page)
      await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', entry.id)
      await assertLabelUnobscured(page, entry.id, `${language}: search`)
      await expect(canvas).toHaveAttribute('data-canvas-zoom', zoom ?? '')
    }

    // Increase scale so an actual keyboard transition has to pan. Focus enters
    // through the real roving Tab stop; graph targets are never focused by JS.
    for (let step = 0; step < 5 && Number(await canvas.getAttribute('data-canvas-zoom')) < 0.9; step += 1) {
      await page.locator('.react-flow__controls-zoomin').click()
      await settled(page)
    }
    await enterGraph(page)
    await settled(page)
    const zoom = await canvas.getAttribute('data-canvas-zoom')
    let transitions = 0, panned = false
    for (const direction of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
      const beforeId = await page.evaluate(() => document.activeElement?.getAttribute('data-id'))
      const beforeCamera = await page.locator('.react-flow__viewport').getAttribute('style')
      await page.keyboard.press(direction)
      await settled(page)
      const focusedId = await page.evaluate(() => document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') ?? null)
      expect(focusedId).not.toBeNull()
      if (focusedId === beforeId) continue
      transitions += 1
      panned ||= beforeCamera !== await page.locator('.react-flow__viewport').getAttribute('style')
      await assertLabelUnobscured(page, focusedId!, `${language}: keyboard ${direction}`)
      await expect(canvas).toHaveAttribute('data-canvas-zoom', zoom ?? '')
    }
    expect(transitions, 'real arrow transitions inspected').toBeGreaterThanOrEqual(2)
    expect(panned, 'keyboard navigation exercises a camera pan').toBe(true)
    await assertPrimaryControls(page)
    await page.screenshot({ path: testInfo.outputPath(`canvas-keyboard-${language}.png`) })
  }
})

async function assertAllMapBounds(page: Page) {
  const geometry = await page.locator('.react-flow').evaluate((surface) => {
    const drawing = surface.getBoundingClientRect()
    const nodes = [...surface.querySelectorAll('.react-flow__node')]
    const boxes = nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { id: node.getAttribute('data-id'), left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        inside: box.width > 0 && box.height > 0 && box.left >= drawing.left && box.right <= drawing.right &&
          box.top >= drawing.top && box.bottom <= drawing.bottom }
    })
    const viewport = surface.querySelector('.react-flow__viewport')!
    const actualZoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a
    const reportedZoom = Number(surface.closest('[data-testid="architecture-canvas"]')!.getAttribute('data-canvas-zoom'))
    return { drawing: { left: drawing.left, top: drawing.top, right: drawing.right, bottom: drawing.bottom },
      boxes, actualZoom, reportedZoom }
  })
  expect(geometry.boxes.length, 'full self model including its proposal is rendered').toBe(29)
  expect(geometry.boxes.filter((box) => !box.inside), `every map node must fit actual drawing bounds: ${JSON.stringify(geometry.drawing)}`).toEqual([])
  expect(Math.abs(geometry.actualZoom - geometry.reportedZoom), 'native React Flow transform matches the published four-decimal zoom').toBeLessThanOrEqual(0.000051)
  return geometry.actualZoom
}

test('whole map can fit below the former zoom floor and native zoom controls preserve that fit', async ({ page }, testInfo) => {
  const project = `small-map-fit-${randomUUID().slice(0, 8)}`
  const run = 'run-small-map-fit'
  const summary = await runSimulator({ scenario: 'self', projectId: project, runId: run, speed: 0 })
  expect(summary.created).toBe(summary.eventsSent)
  expect(summary.conflicts).toBe(0)
  await page.setViewportSize({ width: 1280, height: 660 })
  await page.goto(`/projects/${project}/runs/${run}`)
  await settled(page)
  await showWholeModel(page)
  await settled(page)
  const fittedZoom = await assertAllMapBounds(page)
  expect(fittedZoom, 'small drawing surface exercises the previous 0.12 clamp').toBeLessThan(0.12)
  expect(fittedZoom).toBeGreaterThan(0)
  await page.screenshot({ path: testInfo.outputPath('canvas-small-whole-map.png') })

  const readNativeZoom = () => page.locator('.react-flow__viewport').evaluate((viewport) =>
    new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a,
  )
  await page.locator('.react-flow__controls-zoomin').click()
  await settled(page)
  expect(await readNativeZoom(), 'native zoom-in changes the fitted scale').toBeGreaterThan(fittedZoom * 1.1)
  await page.locator('.react-flow__controls-zoomout').click()
  await settled(page)
  expect(await assertAllMapBounds(page), 'native zoom-out returns to the complete fitted map').toBeCloseTo(fittedZoom, 6)
  await page.screenshot({ path: testInfo.outputPath('canvas-small-map-after-native-zoom.png') })
})
