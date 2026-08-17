import { expect, test, type Page } from '@playwright/test'

import { MAIN_PROJECT, MAIN_RUN } from '../src/config.js'
import { formatControlReports, probeControls, type ControlProbe } from '../src/controls.js'

const WORKSPACE_URL = `/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}?component=${encodeURIComponent(
  'shop-platform.orders.domain.tax',
)}`

const FOCUS_CONTROLS: ControlProbe[] = [
  { name: 'architecture focus', selector: '[data-testid="canvas-toggle-architecture-focus"]' },
  { name: 'fit view', selector: '[data-testid="canvas-fit-view"]' },
  { name: 'minimap toggle', selector: '[data-testid="canvas-toggle-minimap"]' },
  { name: 'zoom in', selector: '.react-flow__controls-zoomin' },
  { name: 'zoom out', selector: '.react-flow__controls-zoomout' },
]

async function chooseLanguage(page: Page, language: 'de' | 'en'): Promise<void> {
  await page.getByTestId(`language-option-${language}`).click()
  await expect(page.locator('html')).toHaveAttribute('lang', language)
}

async function paneSnapshot(page: Page) {
  return page.evaluate(() => {
    const readPane = (id: string) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return {
        width: Math.round(rect.width),
        rail: element.querySelector('[data-testid^="pane-rail-"]') !== null,
      }
    }
    return {
      left: readPane('workspace-left'),
      center: readPane('workspace-center'),
      right: readPane('workspace-right'),
    }
  })
}

async function assertOverlayGeometry(page: Page, label: string): Promise<void> {
  const geometry = await page.evaluate(() => {
    const selectors = [
      '[data-testid="canvas-component-search"]',
      '[data-testid="canvas-toggle-architecture-focus"]',
      '[data-testid="canvas-fit-view"]',
      '[data-testid="canvas-toggle-minimap"]',
      '.architecture-toolbar',
      '.react-flow__minimap',
      '.react-flow__controls',
      '.react-flow__attribution',
    ]
    const rects = Object.fromEntries(
      selectors.map((selector) => {
        const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
        return [
          selector,
          rect === undefined
            ? null
            : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        ]
      }),
    )
    const intersects = (a: typeof rects[string], b: typeof rects[string]) =>
      a !== null &&
      b !== null &&
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top
    return {
      rects,
      toolbarMinimap: intersects(
        rects['.architecture-toolbar'] ?? null,
        rects['.react-flow__minimap'] ?? null,
      ),
      controlsAttribution: intersects(
        rects['.react-flow__controls'] ?? null,
        rects['.react-flow__attribution'] ?? null,
      ),
      toolbarOverflow:
        (() => {
          const toolbar = document.querySelector<HTMLElement>('.architecture-toolbar')
          return toolbar === null || toolbar.scrollWidth > toolbar.clientWidth + 1
        })(),
      toolbarControlOutside: (() => {
        const toolbar = document.querySelector<HTMLElement>('.architecture-toolbar')
        if (toolbar === null) return true
        const toolbarRect = toolbar.getBoundingClientRect()
        return Array.from(toolbar.querySelectorAll('button')).some((button) => {
          const rect = button.getBoundingClientRect()
          return (
            rect.left < toolbarRect.left ||
            rect.right > toolbarRect.right ||
            rect.top < toolbarRect.top ||
            rect.bottom > toolbarRect.bottom
          )
        })
      })(),
    }
  })

  expect(geometry.toolbarMinimap, `${label}: toolbar/minimap overlap`).toBe(false)
  expect(geometry.controlsAttribution, `${label}: zoom controls/attribution overlap`).toBe(false)
  expect(geometry.toolbarOverflow, `${label}: wrapped toolbar overflows its surface`).toBe(false)
  expect(
    geometry.toolbarControlOutside,
    `${label}: wrapped toolbar control escapes its surface`,
  ).toBe(false)

  const reports = await probeControls(page, FOCUS_CONTROLS)
  const broken = reports.filter(
    (report) => !report.found || !report.rendered || !report.insideViewport || !report.unobstructed,
  )
  expect(
    broken.length === 0,
    `${label}: focus/overlay controls are not operable:\n${formatControlReports(reports)}`,
  ).toBe(true)
}

for (const language of ['de', 'en'] as const) {
  test(`architecture focus preserves panes and context in ${language}`, async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1920, height: 1080 },
    ] as const) {
      await page.setViewportSize(viewport)
      await page.goto(WORKSPACE_URL)
      await expect(page.getByTestId('architecture-canvas')).toBeVisible()
      await expect(page.getByTestId('inspector-context')).toHaveAttribute(
        'data-component-id',
        'shop-platform.orders.domain.tax',
      )
      await chooseLanguage(page, language)
      await expect(page.getByTestId('architecture-canvas')).toHaveAttribute(
        'data-layouting',
        'false',
      )

      await assertOverlayGeometry(page, `${language} @ ${viewport.width}`)

      // Start from a non-default arrangement: architecture focus must restore
      // an already collapsed inspector, not just the default three-pane split.
      const inspectorToggle = page.getByRole('button', { name: 'Inspector', exact: true })
      if ((await inspectorToggle.getAttribute('aria-expanded')) !== 'false') {
        await inspectorToggle.click()
      }
      await expect(inspectorToggle).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('pane-rail-right')).toBeVisible()
      const before = await paneSnapshot(page)
      const urlBefore = page.url()
      const surfaceBefore = Number(
        await page.getByTestId('architecture-canvas').getAttribute('data-surface-width'),
      )
      const fitBefore = Number(
        await page.getByTestId('architecture-canvas').getAttribute('data-fit-view-count'),
      )

      const focus = page.getByTestId('canvas-toggle-architecture-focus')
      await focus.click()
      await expect(page.getByTestId('pane-rail-left')).toBeVisible()
      await expect(page.getByTestId('pane-rail-right')).toBeVisible()
      await expect(focus).toHaveAttribute('aria-pressed', 'true')
      // Observe the surface resize first so a fit from the old geometry cannot
      // satisfy the transition assertion.
      await expect
        .poll(async () =>
          Number(
            await page.getByTestId('architecture-canvas').getAttribute('data-surface-width'),
          ),
        )
        .not.toBe(surfaceBefore)
      await expect
        .poll(async () =>
          Number(
            await page.getByTestId('architecture-canvas').getAttribute('data-fit-view-count'),
          ),
        )
        .toBe(fitBefore + 1)

      const focusedGeometry = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLElement>('[data-testid="architecture-canvas"]')
        if (canvas === null) return null
        const canvasRect = canvas.getBoundingClientRect()
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'))
          .map((node) => node.getBoundingClientRect())
          .map((rect) => ({
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          }))
        return {
          canvas: {
            left: canvasRect.left,
            top: canvasRect.top,
            right: canvasRect.right,
            bottom: canvasRect.bottom,
          },
          nodes,
        }
      })
      expect(focusedGeometry).not.toBeNull()
      expect(
        focusedGeometry?.nodes.every(
          (node) =>
            node.left >= focusedGeometry.canvas.left - 1 &&
            node.top >= focusedGeometry.canvas.top - 1 &&
            node.right <= focusedGeometry.canvas.right + 1 &&
            node.bottom <= focusedGeometry.canvas.bottom + 1,
        ),
      ).toBe(true)
      expect(page.url()).toBe(urlBefore)
      const fitAfterFocus = Number(
        await page.getByTestId('architecture-canvas').getAttribute('data-fit-view-count'),
      )

      await focus.click()
      await expect(focus).toHaveAttribute('aria-pressed', 'false')
      await expect(inspectorToggle).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('pane-rail-right')).toBeVisible()
      await expect(page.getByTestId('pane-run-agents')).toBeVisible()
      await expect
        .poll(async () =>
          Number(
            await page.getByTestId('architecture-canvas').getAttribute('data-fit-view-count'),
          ),
        )
        .toBe(fitAfterFocus + 1)
      expect(await paneSnapshot(page)).toEqual(before)
      await expect(page.getByTestId('inspector-context')).toHaveAttribute(
        'data-component-id',
        'shop-platform.orders.domain.tax',
      )
    }
  })
}

test('architecture focus overlays and graph controls stay keyboard-operable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(WORKSPACE_URL)
  await expect(page.getByTestId('architecture-canvas')).toBeVisible()

  const canvas = page.getByTestId('architecture-canvas')
  // The deep link reveals the selected component's ancestors, so the orders
  // container is already open on a fresh page. Establish the keyboard test's
  // state explicitly instead of assuming the initial disclosure rule wins.
  const disclosure = page.getByTestId('node-disclosure-shop-platform.orders')
  await expect(disclosure).toBeVisible()
  if ((await disclosure.getAttribute('aria-expanded')) !== 'false') {
    await disclosure.focus()
    await page.keyboard.press('Enter')
  }
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  await expect(canvas).toHaveAttribute('data-layouting', 'false')

  const focus = page.getByTestId('canvas-toggle-architecture-focus')
  const fitBefore = Number(await canvas.getAttribute('data-fit-view-count'))
  await focus.focus()
  await expect(focus).toBeFocused()
  await page.keyboard.press('Space')
  await expect(focus).toHaveAttribute('aria-pressed', 'true')
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(async () => Number(await canvas.getAttribute('data-fit-view-count'))).toBe(
    fitBefore + 1,
  )

  // The same control is the keyboard exit path, and one transition means one
  // explicit fit even while the panel resize is settling.
  const fitAfterEnter = Number(await canvas.getAttribute('data-fit-view-count'))
  await page.keyboard.press('Space')
  await expect(focus).toHaveAttribute('aria-pressed', 'false')
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(async () => Number(await canvas.getAttribute('data-fit-view-count'))).toBe(
    fitAfterEnter + 1,
  )

  const minimapToggle = page.getByTestId('canvas-toggle-minimap')
  await minimapToggle.focus()
  await expect(minimapToggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(minimapToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(minimapToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.react-flow__minimap')).toHaveCount(1)

  // Relationship labels are also buttons. Activating one from the keyboard
  // must produce the same URL-backed inspector context as a pointer click.
  await page.getByTestId('canvas-fit-view').click()
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if ((await canvas.getAttribute('data-detail-level')) === 'full') break
    await page.locator('.react-flow__controls-zoomin').click()
  }
  const relationship = page.getByTestId('edge-label-rel-orders-publishes-order-created')
  await expect(relationship).toBeVisible()
  await relationship.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/relationship=rel-orders-publishes-order-created/)
  await expect(page.getByTestId('inspector-relationship-context')).toBeVisible()
})
