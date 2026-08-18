import { expect, test, type Page } from '@playwright/test'

import { asAccepted, bootstrapEvent, postEvent } from '../src/api.js'
import { showWholeModel } from '../src/canvas.js'
import { startSimulator } from '../src/simulator.js'

const SELF_KEYBOARD_PROJECT = 'visualise-ai-self-keyboard'
const SELF_KEYBOARD_RUN = 'run-e2e-self-keyboard'
const SELF_KEYBOARD_BOOTSTRAP_RUN = 'run-e2e-self-keyboard-bootstrap'
const SELF_KEYBOARD_BOOTSTRAP_AGENT = 'e2e-self-keyboard-bootstrap-orchestrator'
const SELF_KEYBOARD_BOOTSTRAP_EVENT_ID = '33333333-0000-4000-8000-000000000003'

test('12 · the self run supports a complete spatial keyboard walk and safe focus fallback', async ({
  page,
}) => {
  const opened = await postEvent(
    bootstrapEvent({
      clientEventId: SELF_KEYBOARD_BOOTSTRAP_EVENT_ID,
      projectId: SELF_KEYBOARD_PROJECT,
      runId: SELF_KEYBOARD_BOOTSTRAP_RUN,
      agentId: SELF_KEYBOARD_BOOTSTRAP_AGENT,
      displayName: 'Self keyboard acceptance bootstrap',
    }),
  )
  expect(opened.status, JSON.stringify(opened.body)).toBe(201)
  expect(asAccepted(opened).position).toBe(1)

  await page.goto(`/projects/${SELF_KEYBOARD_PROJECT}/runs/${SELF_KEYBOARD_RUN}`)
  const canvas = page.getByTestId('architecture-canvas')
  await expect(page.getByTestId('live-connection-state')).toHaveAttribute(
    'data-state',
    'live',
  )
  const simulator = startSimulator({
    scenario: 'self',
    projectId: SELF_KEYBOARD_PROJECT,
    runId: SELF_KEYBOARD_RUN,
    speed: 0,
  })
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-layouting', 'false')
  const summary = await simulator.done
  expect(summary.projectId).toBe(SELF_KEYBOARD_PROJECT)
  expect(summary.runId).toBe(SELF_KEYBOARD_RUN)
  expect(summary.conflicts).toBe(0)
  expect(summary.duplicates).toBe(0)
  await showWholeModel(page)

  const nodeIds = await page.locator('.react-flow__node').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-id') ?? '').filter(Boolean),
  )
  expect(nodeIds.length).toBeGreaterThan(10)
  await expect(page.locator('.react-flow__node[tabindex="0"]')).toHaveCount(1)
  await expect(page.locator('.react-flow__edge[tabindex="-1"]')).toHaveCount(
    await page.locator('.react-flow__edge').count(),
  )

  const entryId = await enterGraphWithKeyboard(page)
  await expect(page.locator('.react-flow__node[tabindex="0"]')).toHaveAttribute(
    'data-id',
    entryId,
  )
  const orientation = (await canvas.getAttribute('data-layout-orientation')) as
    | 'top-down'
    | 'left-right'
  const visited = new Set<string>([entryId])
  const geometry = await page.locator('.react-flow__node').evaluateAll((elements) =>
    elements.map((element, order) => {
      const rect = element.getBoundingClientRect()
      return {
        id: element.getAttribute('data-id') ?? '',
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        order,
      }
    }),
  )
  const pathsFromEntry = spatialPaths(geometry, entryId, orientation)
  const keyboardReachable = new Set(pathsFromEntry.keys())
  let current = entryId

  // The walk starts at the one real Tab entry and reaches every visible node
  // through actual Arrow transitions. When the next target is not directly
  // reachable from the current node, the deterministic route returns to the
  // canonical entry using arrows before taking the entry-to-target route. No
  // target is focused by the test harness, and every transition is asserted
  // against the same rendered rectangles used by the application.
  for (const target of nodeIds) {
    if (target === entryId) continue
    const path = pathsFromEntry.get(target)
    expect(path, `canonical entry cannot reach visible target ${target}`).toBeDefined()
    let route = spatialPaths(geometry, current, orientation).get(target)
    if (route === undefined) {
      const toEntry = spatialPaths(geometry, current, orientation).get(entryId)
      expect(toEntry, `focused node ${current} cannot return to canonical entry`).toBeDefined()
      route = [...(toEntry ?? []), ...(path ?? [])]
    }
    let currentNode = current
    for (const direction of route) {
      await page.keyboard.press(direction)
      const next = await page.evaluate(() =>
        document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
      )
      expect(next).not.toBeNull()
      const expected = spatialNext(geometry, currentNode, direction, orientation)
      expect(
        next,
        `target=${target} source=${currentNode} direction=${direction} expected=${expected ?? currentNode}`,
      ).toBe(expected ?? currentNode)
      currentNode = next!
    }
    current = currentNode
    expect(current).toBe(target)
    visited.add(target)
    await expect(page.locator('.react-flow__node[tabindex="0"]')).toHaveCount(1)
  }
  expect([...visited].sort()).toEqual([...nodeIds].sort())
  expect([...keyboardReachable].sort()).toEqual([...nodeIds].sort())

  // At a larger zoom the model extends beyond the pane. An arrow transition
  // into an off-screen neighbour must pan while preserving the scale.
  await page.reload()
  await expect(page.getByTestId('live-connection-state')).toHaveAttribute('data-state', 'live')
  await expect(canvas).toBeVisible()
  await expect(canvas).toHaveAttribute('data-layouting', 'false')
  await showWholeModel(page)
  const zoomIn = page.locator('.react-flow__controls-zoomin')
  for (let index = 0; index < 8; index += 1) await zoomIn.click()
  // Re-enter through the composite's real Tab entry. The following arrow must
  // prove the explicit focus-camera path, rather than inheriting a viewport
  // already centred on a programmatically focused node.
  expect(await enterGraphWithKeyboard(page)).toBe(entryId)
  const zoomBefore = await canvas.getAttribute('data-canvas-zoom')
  const viewportBefore = await page.locator('.react-flow__viewport').getAttribute('style')
  let panned = false
  for (const direction of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'] as const) {
    const before = await page.locator('.react-flow__viewport').getAttribute('style')
    await page.keyboard.press(direction)
    try {
      await page.waitForFunction(
        (previous) => document.querySelector('.react-flow__viewport')?.getAttribute('style') !== previous,
        before,
        { timeout: 1_500 },
      )
      panned = true
      break
    } catch {
      // This direction may have no candidate. Try the next direction from
      // the node selected by the real handler.
    }
  }
  expect(viewportBefore).not.toBeNull()
  expect(panned, 'an off-screen arrow target should pan the viewport').toBe(true)
  await expect(canvas).toHaveAttribute('data-canvas-zoom', zoomBefore ?? '')

  // Removing the focused child through its parent's native disclosure control
  // leaves one valid roving entry and never leaves focus on a vanished node.
  const focusedChild = 'visualise-ai.frontend.canvas'
  const parent = 'visualise-ai.frontend'
  const focusedChildNode = page.locator(`.react-flow__node[data-id="${focusedChild}"]`)
  await focusedChildNode.focus()
  expect(
    await page.evaluate(
      () => document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
    ),
  ).toBe(focusedChild)
  // HTMLElement.click() dispatches React's action without moving focus to the
  // disclosure button, so the focused child is still the node removed by the
  // following relayout.
  await page.getByTestId(`node-disclosure-${parent}`).evaluate((element) => {
    ;(element as HTMLButtonElement).click()
  })
  await expect(canvas).toHaveAttribute('data-layouting', 'false')
  await expect(focusedChildNode).toHaveCount(0)
  const parentNode = page.locator(`.react-flow__node[data-id="${parent}"]`)
  await expect(parentNode).toHaveAttribute('tabindex', '0')
  await expect(page.locator('.react-flow__node[tabindex="0"]')).toHaveCount(1)
  expect(
    await page.evaluate(
      () => document.activeElement?.closest('.react-flow__node')?.getAttribute('data-id') ?? null,
    ),
  ).toBe(parent)
})

async function enterGraphWithKeyboard(page: Page): Promise<string> {
  // Start from the canvas fit control, which is outside the composite. Shift+
  // Tab then re-enters the current roving node through the browser's real tab
  // order; no graph target is focused by the test harness.
  await page.getByTestId('canvas-fit-view').focus()
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await page.keyboard.press('Shift+Tab')
    const nodeId = await page.evaluate(() => {
      const active = document.activeElement
      return active?.matches('.react-flow__node') ? active.getAttribute('data-id') : null
    })
    if (nodeId !== null) return nodeId
  }
  throw new Error('Keyboard Tab sequence did not enter the architecture graph')
}

interface SpatialBox {
  id: string
  x: number
  y: number
  width: number
  height: number
  order: number
}

type SpatialKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

function spatialPaths(
  boxes: readonly SpatialBox[],
  source: string,
  orientation: 'top-down' | 'left-right',
): Map<string, SpatialKey[]> {
  const directions: SpatialKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
  const paths = new Map<string, SpatialKey[]>([[source, []]])
  const queue = [source]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    const currentPath = paths.get(current)
    if (currentPath === undefined) continue
    for (const direction of directions) {
      const next = spatialNext(boxes, current, direction, orientation)
      if (next === null || paths.has(next)) continue
      paths.set(next, [...currentPath, direction])
      queue.push(next)
    }
  }
  return paths
}

function spatialNext(
  boxes: readonly SpatialBox[],
  currentId: string,
  direction: SpatialKey,
  orientation: 'top-down' | 'left-right',
): string | null {
  const current = boxes.find((box) => box.id === currentId)
  if (!current) return null
  const center = (box: SpatialBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
  const currentCenter = center(current)
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight'
  const sign = direction === 'ArrowLeft' || direction === 'ArrowUp' ? -1 : 1
  const candidates = boxes
    .filter((box) => box.id !== current.id)
    .map((box) => {
      const candidateCenter = center(box)
      const primaryDelta =
        (horizontal ? candidateCenter.x : candidateCenter.y) -
        (horizontal ? currentCenter.x : currentCenter.y)
      if (primaryDelta * sign <= 0) return null
      const secondaryDelta = Math.abs(
        (horizontal ? candidateCenter.y : candidateCenter.x) -
          (horizontal ? currentCenter.y : currentCenter.x),
      )
      return {
        box,
        primary: Math.abs(primaryDelta),
        secondary: secondaryDelta,
        score: Math.abs(primaryDelta) + secondaryDelta * 2,
        reading: orientation === 'top-down' ? candidateCenter.x : candidateCenter.y,
      }
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
  candidates.sort(
    (left, right) =>
      left.score - right.score ||
      left.primary - right.primary ||
      left.secondary - right.secondary ||
      left.reading - right.reading ||
      left.box.id.localeCompare(right.box.id) ||
      left.box.order - right.box.order,
  )
  return candidates[0]?.box.id ?? null
}
