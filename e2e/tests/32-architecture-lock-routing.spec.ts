import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

import { connectMcp, writeIdentity } from '../src/mcp.js'
import { panIntoCanvas, showWholeModel } from '../src/canvas.js'

const BUNDLE = 'rel:route-source~>route-target'
const components = [
  { componentId: 'route-group', name: 'Order processing', kind: 'system', parentComponentId: null },
  { componentId: 'route-source', name: 'Orders API', kind: 'service', parentComponentId: 'route-group' },
  { componentId: 'route-target', name: 'Order processor', kind: 'service', parentComponentId: 'route-group' },
  { componentId: 'route-upstream', name: 'Incoming requests', kind: 'service', parentComponentId: null },
  { componentId: 'route-obstacle', name: 'Independent publisher', kind: 'service', parentComponentId: null },
  { componentId: 'route-other', name: 'Independent subscriber', kind: 'service', parentComponentId: null },
]
const relationship = (relationshipId: string, sourceComponentId: string, targetComponentId: string) => ({
  relationshipId, sourceComponentId, targetComponentId, kind: 'dependency', protocol: 'HTTP', operation: relationshipId,
})
const relationships = [
  relationship('route-incoming', 'route-upstream', 'route-source'),
  ...['route-one', 'route-two', 'route-three'].map((id) => relationship(id, 'route-source', 'route-target')),
  relationship('route-self', 'route-source', 'route-source'),
  relationship('route-independent', 'route-obstacle', 'route-other'),
  relationship('route-crossing', 'route-upstream', 'route-other'),
]

async function fixture() {
  const mcp = await connectMcp()
  const project = `lock-routing-${randomUUID().slice(0, 8)}`
  const identity = () => writeIdentity(project, 'routing-run', 'routing-author')
  let revision = 0
  async function mutate(operations: Record<string, unknown>[]) {
    const receipt = await mcp.call('visualise_model_mutate', { ...identity(), expectedModelRevision: revision, operations })
    revision = receipt.modelRevision as number
  }
  try {
    await mcp.call('visualise_context_open', { ...identity(), role: 'orchestrator', displayName: 'Routing author', assignedTask: 'Report architecture for lock and route acceptance' })
    await mutate([
      ...components.map((component) => ({ op: 'component.add', component })),
      ...relationships.map((item) => ({ op: 'relationship.add', relationship: item })),
    ])
    return { mcp, mutate, project, revision: () => revision, url: `/projects/${project}/runs/routing-run` }
  } catch (error) {
    await mcp.close()
    throw error
  }
}

async function settled(page: Page) {
  const canvas = page.getByTestId('architecture-canvas')
  if (await canvas.count()) await expect(canvas).toHaveAttribute('data-layouting', 'false')
  let previous = '', matches = 0
  await expect.poll(async () => {
    const current = await page.locator('.react-flow__viewport').getAttribute('style') ?? ''
    matches = current === previous ? matches + 1 : 0
    previous = current
    return matches
  }, { intervals: [100] }).toBeGreaterThanOrEqual(2)
  return previous
}

const positions = (page: Page) => page.locator('.react-flow__node').evaluateAll((nodes) =>
  nodes.map((node) => [node.getAttribute('data-id'), (node as HTMLElement).style.transform]),
)

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, button: 'left' | 'middle' = 'left') {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button })
  // Establish native drag before the larger movement; XYFlow starts its drag
  // subject on the first move, which otherwise loses one interpolated step.
  await page.mouse.move(from.x + 1, from.y + 1)
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up({ button })
  await settled(page)
}

async function toolbar(page: Page, open: boolean) {
  const toggle = page.getByTestId('canvas-toggle-tools')
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', String(open))
  await settled(page)
}

/** Use actual SVG curve geometry after CSS transforms, including rounded bends.
 * Open containers permit boundary crossings but their painted header is blocked.
 * Even terminal bodies are checked: only the four-pixel handle contact is skipped.
 */
async function assertClearRoutes(page: Page, context: string) {
  const geometry = await page.evaluate(() => {
    const obstacles = [...document.querySelectorAll<HTMLElement>('.react-flow__node [data-component-id]')].map((element) => {
      const open = element.dataset.compound === 'true' && element.dataset.collapsed !== 'true'
      const painted = open ? element.firstElementChild! : element
      const rect = painted.getBoundingClientRect()
      return { id: `${element.dataset.componentId}${open ? ':header' : ''}`, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    })
    const paths = [...document.querySelectorAll<SVGPathElement>('path[data-relationship-kind]')]
    const violations: string[] = []
    const annotationViolations: string[] = []
    let samples = 0
    for (const path of paths) {
      const matrix = path.getScreenCTM()
      if (!matrix) throw new Error('Relationship has no screen matrix')
      const zoom = Math.hypot(matrix.a, matrix.b)
      const length = path.getTotalLength()
      for (let offset = 4 / zoom; offset < length - 4 / zoom; offset += 1 / zoom) {
        const point = path.getPointAtLength(offset).matrixTransform(matrix)
        samples += 1
        for (const box of obstacles) {
          if (point.x > box.left + 1 && point.x < box.right - 1 && point.y > box.top + 1 && point.y < box.bottom - 1) {
            const violation = `${path.dataset.testid} crosses ${box.id}`
            if (!violations.includes(violation)) violations.push(violation)
          }
        }
      }
    }
    // Annotation leaders are drawn paths too. Their entire painted route must
    // avoid bodies; there is no component-port exemption for a label connector.
    for (const leader of document.querySelectorAll<SVGGeometryElement>('[data-label-annotation="true"] line, [data-label-annotation="true"] path')) {
      const matrix = leader.getScreenCTM()
      if (!matrix) throw new Error('Annotation has no screen matrix')
      const zoom = Math.hypot(matrix.a, matrix.b)
      const length = leader.getTotalLength()
      for (let offset = 0; offset <= length; offset += 1 / zoom) {
        const point = leader.getPointAtLength(offset).matrixTransform(matrix)
        for (const box of obstacles) {
          if (point.x > box.left + 1 && point.x < box.right - 1 && point.y > box.top + 1 && point.y < box.bottom - 1) {
            const violation = `${leader.closest('[data-label-for]')?.getAttribute('data-label-for')} crosses ${box.id}`
            if (!annotationViolations.includes(violation)) annotationViolations.push(violation)
          }
        }
      }
    }
    return { samples, paths: paths.length, obstacles: obstacles.length, violations, annotationViolations }
  })
  expect(geometry.paths, context).toBeGreaterThanOrEqual(5)
  expect(geometry.obstacles, context).toBe(components.length)
  expect(geometry.samples, context).toBeGreaterThan(100)
  expect(geometry.violations, context).toEqual([])
  expect(geometry.annotationViolations, `${context}: label leaders must also avoid component bodies and headers`).toEqual([])
}

async function moveObstacleAcrossRoute(page: Page, orientation: 'top-down' | 'left-right') {
  // Make a legitimate route corridor wider through a user drag first. ELK's
  // default row gap is deliberately too small to drop another card into it.
  const downstream = page.locator('.react-flow__node[data-id="route-other"]')
  await panIntoCanvas(page, downstream)
  const downstreamBox = await downstream.boundingBox()
  if (!downstreamBox) throw new Error('Downstream node is missing')
  const start = { x: downstreamBox.x + downstreamBox.width / 2, y: downstreamBox.y + downstreamBox.height / 2 }
  await drag(page, start, { x: start.x + (orientation === 'left-right' ? 240 : 0), y: start.y + (orientation === 'top-down' ? 120 : 0) })
  const obstacle = page.locator('.react-flow__node[data-id="route-obstacle"]')
  await panIntoCanvas(page, obstacle)
  const movement = await page.evaluate(() => {
    const obstacle = document.querySelector<HTMLElement>('.react-flow__node[data-id="route-obstacle"]')!
    const box = obstacle.getBoundingClientRect()
    const pane = document.querySelector('.react-flow__pane')!.getBoundingClientRect()
    const zoom = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a
    const clearance = 36 * zoom
    const others = [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .filter((node) => node !== obstacle).map((node) => node.getBoundingClientRect())
    const paths = [...document.querySelectorAll<SVGPathElement>('path[data-relationship-kind]')]
      .filter((path) => !path.dataset.testid?.includes('route-obstacle'))
      .sort((a, b) => b.getTotalLength() - a.getTotalLength())
    for (const path of paths) {
      const matrix = path.getScreenCTM()!
      const length = path.getTotalLength()
      for (let fraction = 0.15; fraction < 0.9; fraction += 0.05) {
        const point = path.getPointAtLength(length * fraction).matrixTransform(matrix)
        const target = { left: point.x - box.width / 2, right: point.x + box.width / 2, top: point.y - box.height / 2, bottom: point.y + box.height / 2 }
        if (target.left < pane.left + 12 || target.right > pane.right - 12 || target.top < pane.top + 12 || target.bottom > pane.bottom - 12) continue
        if (others.some((other) => target.left < other.right + clearance && target.right > other.left - clearance && target.top < other.bottom + clearance && target.bottom > other.top - clearance)) continue
        return { start: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, end: { x: point.x, y: point.y }, pathId: path.dataset.testid!, before: path.getAttribute('d'), zoom, target, others: others.map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })) }
      }
    }
    throw new Error('Fixture must expose a visible route gap large enough to move the unrelated obstacle without overlapping components')
  })
  const previousPositions = await positions(page)
  await drag(page, movement.start, movement.end)
  expect(await positions(page), `real drag must move the unrelated component: ${JSON.stringify(movement)}`).not.toEqual(previousPositions)
  await expect(page.getByTestId(movement.pathId), 'route not incident to dragged component must be recomputed').not.toHaveAttribute('d', movement.before ?? '')
}

test('32 · the visual lock freezes navigation while selection and live reporting remain usable in both languages', async ({ page }, testInfo) => {
  const model = await fixture()
  try {
    for (const [language, width] of [['de', 1280], ['en', 1920]] as const) {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 1080 })
      await page.goto(model.url)
      await page.getByTestId(`language-option-${language}`).click()
      await expect(page.getByTestId('architecture-canvas')).toHaveAttribute('data-node-count', '6')
      await showWholeModel(page)
      await settled(page)
      const lock = page.getByTestId('canvas-toggle-lock')
      await expect(lock).toHaveAttribute('aria-pressed', 'false')
      const source = page.locator('.react-flow__node[data-id="route-source"]')
      const movable = page.locator('.react-flow__node[data-id="route-obstacle"]')
      await panIntoCanvas(page, movable)
      const sourceBox = await movable.boundingBox()
      if (!sourceBox) throw new Error('Source has no rectangle')
      const point = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }
      const initialPositions = await positions(page)
      // Establish an actual temporary node position so Reset also has to obey lock.
      await drag(page, point, { x: point.x - 20, y: point.y - 15 })
      expect(await positions(page)).not.toEqual(initialPositions)
      await toolbar(page, true)
      const minimapToggle = page.getByTestId('canvas-toggle-minimap')
      if (await minimapToggle.getAttribute('aria-pressed') === 'false') await minimapToggle.click()
      await lock.focus()
      await page.keyboard.press('Space')
      await expect(lock).toHaveAttribute('aria-pressed', 'true')
      await expect(lock).toHaveAccessibleName(language === 'de' ? /sperr|gesperrt/i : /lock/i)
      const camera = await settled(page)
      const frozen = await positions(page)
      for (const id of ['canvas-fit-view', 'canvas-reset-positions', 'canvas-layout-top-down', 'canvas-layout-left-right', 'node-disclosure-route-group']) {
        await expect(page.getByTestId(id), id).toBeDisabled()
      }
      for (const selector of ['.react-flow__controls-zoomin', '.react-flow__controls-zoomout']) await expect(page.locator(selector)).toBeDisabled()
      const currentBox = await movable.boundingBox()
      if (!currentBox) throw new Error('Source disappeared')
      const current = { x: currentBox.x + currentBox.width / 2, y: currentBox.y + currentBox.height / 2 }
      await drag(page, current, { x: current.x + 50, y: current.y + 30 })
      expect(await settled(page), 'locked node drag preserves camera').toBe(camera)
      const paneBox = await page.locator('.react-flow__pane').boundingBox()
      if (!paneBox) throw new Error('Canvas has no pane')
      const panePoint = { x: paneBox.x + paneBox.width / 2, y: paneBox.y + paneBox.height / 2 }
      await drag(page, current, { x: current.x + 55, y: current.y + 40 }, 'middle')
      expect(await settled(page), 'locked middle-button drag over a node preserves camera').toBe(camera)
      await page.mouse.move(panePoint.x, panePoint.y)
      await page.mouse.wheel(0, -180)
      await page.mouse.dblclick(panePoint.x, panePoint.y)
      expect(await settled(page), 'locked wheel and double click preserve camera').toBe(camera)
      const minimap = page.locator('.react-flow__minimap')
      await expect(minimap).toBeVisible()
      const mini = await minimap.boundingBox()
      if (!mini) throw new Error('Minimap has no rectangle')
      await drag(page, { x: mini.x + 30, y: mini.y + 30 }, { x: mini.x + 100, y: mini.y + 70 })
      await page.mouse.wheel(0, -180)
      expect(await settled(page)).toBe(camera)
      expect(await positions(page)).toEqual(frozen)

      await source.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'route-source')
      await expect(page.getByTestId(`edge-path-${BUNDLE}`)).toHaveAttribute('data-component-related', 'true')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      expect(await page.locator('.react-flow__node:focus').count()).toBe(1)
      await page.getByTestId('canvas-component-search').click()
      await page.getByTestId('canvas-component-search-input').fill('Orders API')
      await page.getByTestId('canvas-component-search-input').press('Enter')
      await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'route-source')
      expect(await settled(page)).toBe(camera)
      expect(await positions(page)).toEqual(frozen)
      const beforeRead = await model.mcp.call('visualise_model_read', { contractVersion: '2.0.0', projectId: model.project })
      expect(beforeRead.modelRevision, 'viewer actions must not change reported model').toBe(model.revision())
      await model.mutate([{ op: 'component.update', componentId: 'route-source', set: { name: `Orders API ${language}` } }])
      await expect(page.getByTestId('inspector-context')).toContainText(`Orders API ${language}`)
      await expect(lock).toHaveAttribute('aria-pressed', 'true')
      expect(await settled(page)).toBe(camera)
      await page.screenshot({ path: testInfo.outputPath(`architecture-locked-${language}-${width}.png`) })
      await lock.focus()
      await page.keyboard.press('Enter')
      await expect(lock).toHaveAttribute('aria-pressed', 'false')
      expect(await positions(page), 'unlock preserves temporary layout').toEqual(frozen)
      await page.locator('.react-flow__controls-zoomin').click()
      expect(await settled(page), 'unlock restores camera navigation').not.toBe(camera)
      await model.mutate([{ op: 'component.update', componentId: 'route-source', set: { name: 'Orders API' } }])
    }
  } finally { await model.mcp.close() }
})

test('32 · rendered routes avoid component bodies and compound headers in both orientations and native export', async ({ page }, testInfo) => {
  const model = await fixture()
  try {
    for (const orientation of ['top-down', 'left-right'] as const) {
      await page.goto(model.url)
      await expect(page.getByTestId('architecture-canvas')).toHaveAttribute('data-node-count', '6')
      await showWholeModel(page)
      await toolbar(page, true)
      await page.getByTestId(`canvas-layout-${orientation}`).click()
      await expect(page.getByTestId('architecture-canvas')).toHaveAttribute('data-layout-orientation', orientation)
      await toolbar(page, false)
      await settled(page)
      await assertClearRoutes(page, `interactive ${orientation} bundled`)
      const bundle = page.getByTestId(`edge-bundle-${BUNDLE}`)
      await bundle.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('path[data-relationship-kind]')).toHaveCount(relationships.length)
      await assertClearRoutes(page, `interactive ${orientation} expanded`)
      for (const item of relationships) await expect(page.getByTestId(`edge-path-${item.relationshipId === 'route-one' || item.relationshipId === 'route-two' || item.relationshipId === 'route-three' ? item.relationshipId : `rel:${item.sourceComponentId}~>${item.targetComponentId}`}`)).toHaveAttribute('marker-end', /.+/)
      await page.screenshot({ path: testInfo.outputPath(`architecture-routes-${orientation}.png`) })
      const rejectedBefore = await positions(page)
      const obstacleBox = await page.getByTestId('canvas-node-route-obstacle').boundingBox()
      const upstreamBox = await page.getByTestId('canvas-node-route-upstream').boundingBox()
      if (!obstacleBox || !upstreamBox) throw new Error('Root nodes are missing')
      await drag(page,
        { x: obstacleBox.x + obstacleBox.width / 2, y: obstacleBox.y + obstacleBox.height / 2 },
        { x: upstreamBox.x + upstreamBox.width / 2, y: upstreamBox.y + upstreamBox.height / 2 },
      )
      expect(await positions(page), 'overlapping drop restores the last clear component positions').toEqual(rejectedBefore)
      await moveObstacleAcrossRoute(page, orientation)
      await assertClearRoutes(page, `interactive ${orientation} moved unrelated obstacle`)
      await page.screenshot({ path: testInfo.outputPath(`architecture-moved-obstacle-${orientation}.png`) })
      await page.getByTestId('canvas-reset-positions').click()
      await settled(page)
      const group = page.getByTestId('canvas-node-route-group')
      await panIntoCanvas(page, group)
      const header = await group.locator(':scope > div').first().boundingBox()
      const childBefore = await page.getByTestId('canvas-node-route-source').boundingBox()
      if (!header || !childBefore) throw new Error('Compound or descendant is missing')
      const headerPoint = { x: header.x + header.width / 2, y: header.y + header.height / 2 }
      await drag(page, headerPoint, { x: headerPoint.x - 15, y: headerPoint.y - 15 })
      const childAfter = await page.getByTestId('canvas-node-route-source').boundingBox()
      expect(childAfter?.x, 'moving compound moves descendant in absolute coordinates').not.toBe(childBefore.x)
      await assertClearRoutes(page, `interactive ${orientation} moved compound descendants`)

      // The native renderer's supported public entry receives the same reported
      // fixture, just as the backend sends an immutable snapshot to Chromium.
      await page.goto('/render.html')
      const result = await page.evaluate(async (snapshot) => {
        const render = (window as unknown as { visualiseRender: (value: unknown, settings: unknown) => Promise<{ visibleIds: { relationshipIds: string[] } }> }).visualiseRender
        return render(snapshot, { viewport: { width: 1920, height: 1080, pixelRatio: 1 }, detailLevel: 'full' })
      }, {
        model: { components, relationships },
        view: { viewId: 'route-view', name: 'Route review', kind: 'architecture', selection: { mode: 'all' }, orientation: orientation === 'left-right' ? 'left-to-right' : orientation, collapsedComponentIds: [] },
        viewRevision: 1,
      })
      expect(result.visibleIds.relationshipIds.length).toBeGreaterThan(0)
      await expect(page.locator('path[data-relationship-kind]')).toHaveCount(relationships.length)
      await assertClearRoutes(page, `native ${orientation} expanded`)
      await page.screenshot({ path: testInfo.outputPath(`architecture-native-routes-${orientation}.png`) })
    }
    const current = await model.mcp.call('visualise_model_read', { contractVersion: '2.0.0', projectId: model.project })
    expect(current.modelRevision, 'local drag and routing do not mutate the reported model').toBe(model.revision())
  } finally { await model.mcp.close() }
})
