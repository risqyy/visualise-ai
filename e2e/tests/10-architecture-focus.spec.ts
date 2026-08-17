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
    }
  })

  expect(geometry.toolbarMinimap, `${label}: toolbar/minimap overlap`).toBe(false)
  expect(geometry.controlsAttribution, `${label}: zoom controls/attribution overlap`).toBe(false)

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
      if ((await page.getByTestId('pane-rail-right').count()) === 0) {
        const inspectorToggle = page.locator('header button[aria-expanded]').last()
        await inspectorToggle.click()
      }
      await expect(page.getByTestId('pane-rail-right')).toBeVisible()
      const before = await paneSnapshot(page)
      const urlBefore = page.url()
      const fitBefore = Number(
        await page.getByTestId('architecture-canvas').getAttribute('data-fit-view-count'),
      )

      const focus = page.getByTestId('canvas-toggle-architecture-focus')
      await focus.click()
      await expect(page.getByTestId('pane-rail-left')).toBeVisible()
      await expect(page.getByTestId('pane-rail-right')).toBeVisible()
      await expect(focus).toHaveAttribute('aria-pressed', 'true')
      await expect
        .poll(async () =>
          Number(
            await page.getByTestId('architecture-canvas').getAttribute('data-fit-view-count'),
          ),
        )
        .toBeGreaterThan(fitBefore)
      expect(page.url()).toBe(urlBefore)
      const fitAfterFocus = Number(
        await page.getByTestId('architecture-canvas').getAttribute('data-fit-view-count'),
      )

      await focus.click()
      await expect(focus).toHaveAttribute('aria-pressed', 'false')
      await expect(page.getByTestId('pane-rail-right')).toBeVisible()
      await expect(page.getByTestId('pane-run-agents')).toBeVisible()
      await expect
        .poll(async () =>
          Number(
            await page.getByTestId('architecture-canvas').getAttribute('data-fit-view-count'),
          ),
        )
        .toBeGreaterThan(fitAfterFocus)
      expect(await paneSnapshot(page)).toEqual(before)
      await expect(page.getByTestId('inspector-context')).toHaveAttribute(
        'data-component-id',
        'shop-platform.orders.domain.tax',
      )
    }
  })
}
