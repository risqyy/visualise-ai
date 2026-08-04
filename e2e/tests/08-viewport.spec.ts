import { expect, test } from '@playwright/test'

import { ACCEPTANCE_VIEWPORT, MAIN_PROJECT, MAIN_RUN } from '../src/config.js'
import { formatControlReports, probeControls, type ControlProbe } from '../src/controls.js'

/**
 * Mandatory check 8 — no unintended horizontal page scrollbar and no covered
 * primary control at 1920 × 1080.
 *
 * "Not covered" is asked of the browser, not of the DOM: every control below has
 * to be rendered, lie inside the viewport, and be the element `elementFromPoint`
 * finds at its own centre. Existence in the DOM proves nothing — a pane that
 * overlaps a toolbar, or a control pushed past the right edge, still exists.
 */

const CONTROLS: ControlProbe[] = [
  { name: 'run selection (current run)', selector: `[data-testid="run-option-${MAIN_RUN}"]` },
  { name: 'agent filter', selector: 'input[aria-label="Agents filtern"]' },
  { name: 'pane toggle · run pane', selector: 'button[aria-label="Run- und Agent-Bereich"]' },
  { name: 'pane toggle · inspector', selector: 'button[aria-label="Inspector"]' },
  { name: 'canvas control · fit view', selector: '[data-testid="canvas-fit-view"]' },
  { name: 'canvas control · minimap toggle', selector: '[data-testid="canvas-toggle-minimap"]' },
  { name: 'canvas control · zoom in', selector: '.react-flow__controls-zoomin' },
  { name: 'canvas control · zoom out', selector: '.react-flow__controls-zoomout' },
  { name: 'inspector tab · current run', selector: '[role="tab"][aria-selected="true"]' },
  { name: 'inspector tab · history', selector: '[role="tab"][aria-selected="false"]' },
  { name: 'live connection badge', selector: '[data-testid="live-connection-state"]' },
]

test('8 · the page has no horizontal scrollbar and every primary control is operable', async ({
  page,
}) => {
  await page.goto(
    `/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}?component=${encodeURIComponent(
      'shop-platform.orders.domain.tax',
    )}`,
  )
  await expect(page.getByTestId('architecture-canvas')).toBeVisible()
  await expect(page.getByTestId('diff-groups')).toBeVisible()
  await expect(page.getByTestId('architecture-canvas')).toHaveAttribute(
    'data-layouting',
    'false',
  )

  // ---- the mandatory acceptance resolution --------------------------------
  const geometry = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentClientHeight: document.documentElement.clientHeight,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollHeight: document.body.scrollHeight,
    bodyClientHeight: document.body.clientHeight,
    rootHeight: Math.round(
      document.getElementById('root')?.getBoundingClientRect().height ?? -1,
    ),
  }))

  expect(geometry.innerWidth).toBe(ACCEPTANCE_VIEWPORT.width)
  expect(geometry.innerHeight).toBe(ACCEPTANCE_VIEWPORT.height)

  // The criterion of issue #14, verbatim.
  expect(
    geometry.documentScrollWidth,
    'the page must not scroll horizontally at 1920 × 1080',
  ).toBe(geometry.documentClientWidth)
  expect(geometry.bodyScrollWidth).toBe(geometry.bodyClientWidth)

  // A vertical scrollbar would take width away from the layout and reintroduce
  // the horizontal one, so the page must not scroll at all: the shell is exactly
  // one viewport tall and every pane owns its own scroll region.
  expect(geometry.bodyScrollHeight).toBe(geometry.bodyClientHeight)
  expect(geometry.rootHeight).toBe(ACCEPTANCE_VIEWPORT.height)
  expect(geometry.documentClientWidth).toBe(ACCEPTANCE_VIEWPORT.width)
  expect(geometry.documentClientHeight).toBe(ACCEPTANCE_VIEWPORT.height)

  // Nothing sticks out beyond the right edge, which is what would produce the
  // scrollbar in the first place.
  // Wide content is allowed — inside its own clipping or scrolling container.
  // A diff box, a markdown table and the React Flow canvas all extend past
  // their box on purpose. What must never happen is content sticking out of
  // the *page*, which is what would produce the scrollbar.
  const overflowing = await page.evaluate((limit) => {
    const containedByItsOwnScroller = (element: Element): boolean => {
      let ancestor = element.parentElement
      while (ancestor !== null && ancestor !== document.body) {
        const style = window.getComputedStyle(ancestor)
        if (style.overflowX !== 'visible' || style.overflow !== 'visible') {
          if (ancestor.getBoundingClientRect().right <= limit + 1) return true
        }
        ancestor = ancestor.parentElement
      }
      return false
    }

    const offenders: string[] = []
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.right <= limit + 1) continue
      if (containedByItsOwnScroller(element)) continue
      const testId = element.getAttribute('data-testid')
      offenders.push(
        `${element.tagName.toLowerCase()}${testId === null ? '' : `[${testId}]`} right=${Math.round(rect.right)}`,
      )
    }
    return offenders.slice(0, 12)
  }, ACCEPTANCE_VIEWPORT.width)
  expect(
    overflowing,
    'element extends past the right edge of the viewport without a clipping container',
  ).toEqual([])

  // ---- the primary controls ----------------------------------------------
  const reports = await probeControls(page, CONTROLS)
  const broken = reports.filter(
    (report) => !report.found || !report.rendered || !report.insideViewport || !report.unobstructed,
  )
  expect(
    broken.length === 0,
    `primary controls are not operable:\n${formatControlReports(reports)}`,
  ).toBe(true)
})

test('8 · content below the fold is reachable inside its own pane, not by scrolling the page', async ({
  page,
}) => {
  await page.goto(
    `/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}?component=${encodeURIComponent(
      'shop-platform.orders.domain.tax',
    )}`,
  )
  await expect(page.getByTestId('agent-row-subagent-reviewer')).toBeVisible()
  await expect(page.getByTestId('diff-groups')).toBeVisible()

  // Both side panes have more content than height — otherwise this test would
  // pass without there being anything below a fold.
  const regions = await page.evaluate(() => {
    const read = (element: Element | null) =>
      element === null
        ? null
        : { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }
    return {
      runPane: read(document.querySelector('[data-slot="scroll-area-viewport"]')),
      inspector: read(document.querySelector('[data-testid="inspector-scroll"]')),
    }
  })
  expect(regions.runPane).not.toBeNull()
  expect(regions.inspector).not.toBeNull()
  expect(regions.runPane!.scrollHeight).toBeGreaterThan(regions.runPane!.clientHeight)
  expect(regions.inspector!.scrollHeight).toBeGreaterThan(regions.inspector!.clientHeight)

  // The deepest agent row starts below the fold and is brought into view by
  // scrolling the pane — the page itself stays where it is.
  const before = await page.getByTestId('agent-row-subagent-reviewer').boundingBox()
  expect(before).not.toBeNull()
  expect(
    before!.y + before!.height,
    'the deepest agent row is expected to start below the fold',
  ).toBeGreaterThan(ACCEPTANCE_VIEWPORT.height)

  await page.getByTestId('agent-row-subagent-reviewer').scrollIntoViewIfNeeded()
  const after = await page.getByTestId('agent-row-subagent-reviewer').boundingBox()
  expect(after).not.toBeNull()
  expect(after!.y).toBeLessThan(ACCEPTANCE_VIEWPORT.height - 100)

  const pageOffset = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
  }))
  expect(pageOffset).toEqual({ x: 0, y: 0 })

  const reports = await probeControls(page, [
    {
      name: 'deepest agent row after scrolling its pane',
      selector: '[data-testid="agent-row-subagent-reviewer"]',
    },
  ])
  expect(
    reports.every((report) => report.rendered && report.insideViewport && report.unobstructed),
    `the deepest agent row is not reachable:\n${formatControlReports(reports)}`,
  ).toBe(true)
})

test('8 · collapsing and reopening the side panes never produces a scrollbar either', async ({
  page,
}) => {
  await page.goto(`/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}`)
  await expect(page.getByTestId('architecture-canvas')).toBeVisible()

  const scrolls = async (): Promise<boolean> =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )

  await page.getByRole('button', { name: 'Run- und Agent-Bereich' }).click()
  await expect(page.getByTestId('pane-rail-left')).toBeVisible()
  expect(await scrolls()).toBe(false)

  await page.getByRole('button', { name: 'Inspector' }).click()
  await expect(page.getByTestId('pane-rail-right')).toBeVisible()
  expect(await scrolls()).toBe(false)
  // The expand controls of both rails stay reachable.
  const rails = await probeControls(page, [
    { name: 'left rail expand', selector: '[data-testid="pane-rail-left"] button' },
    { name: 'right rail expand', selector: '[data-testid="pane-rail-right"] button' },
  ])
  expect(
    rails.every((report) => report.rendered && report.insideViewport && report.unobstructed),
    `collapsed rails are not operable:\n${formatControlReports(rails)}`,
  ).toBe(true)

  await page.locator('[data-testid="pane-rail-left"] button').click()
  await page.locator('[data-testid="pane-rail-right"] button').click()
  await expect(page.getByTestId('pane-run-agents')).toBeVisible()
  await expect(page.getByTestId('pane-inspector')).toBeVisible()
  expect(await scrolls()).toBe(false)
})
