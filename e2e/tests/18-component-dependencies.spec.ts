import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

import { connectMcp, writeIdentity } from '../src/mcp.js'
import { showWholeModel } from '../src/canvas.js'

const BUNDLE = 'rel:dependency-hub~>dependency-consumer'
const LONG_OPERATION = 'POST /architecture/dependencies/with-an-intentionally-long-reported-operation-that-must-remain-accessible-without-covering-neighbouring-labels'
const BADGES = '[data-testid^="edge-label-"], [data-testid^="edge-bundle-"], [data-testid^="edge-collapse-"]'
const mainPaths = (page: Page) => page.locator('path[data-relationship-kind]')

async function fixture() {
  const mcp = await connectMcp()
  const project = `dependency-${randomUUID().slice(0, 8)}`
  const run = 'dependency-run'
  const identity = () => writeIdentity(project, run, 'dependency-author')
  let revision = 0
  async function mutate(operations: Record<string, unknown>[]) {
    const receipt = await mcp.call('visualise_model_mutate', { ...identity(), expectedModelRevision: revision, operations })
    revision = receipt.modelRevision as number
  }
  const component = (id: string, name: string, parentComponentId: string | null = null) => ({
    op: 'component.add', component: { componentId: id, name, kind: id === 'dependency-group' ? 'system' : 'service', parentComponentId },
  })
  const relationship = (id: string, source: string, target: string) => ({
    op: 'relationship.add', relationship: {
      relationshipId: id, sourceComponentId: source, targetComponentId: target,
      kind: 'dependency', protocol: 'HTTP', operation: `${LONG_OPERATION}/${id}`,
    },
  })
  try {
    await mcp.call('visualise_context_open', { ...identity(), role: 'orchestrator', displayName: 'Dependency author', assignedTask: 'Describe dependency highlighting acceptance' })
    await mutate([
      component('dependency-group', 'Order processing'),
      component('dependency-hub', 'Orders API', 'dependency-group'),
      component('dependency-consumer', 'Order processor', 'dependency-group'),
      component('dependency-upstream', 'Incoming requests'),
      component('dependency-other-source', 'Independent publisher'),
      component('dependency-other-target', 'Independent subscriber'),
      relationship('incoming-edge', 'dependency-upstream', 'dependency-hub'),
      ...['bundle-one', 'bundle-two', 'bundle-three'].map((id) => relationship(id, 'dependency-hub', 'dependency-consumer')),
      relationship('self-edge', 'dependency-hub', 'dependency-hub'),
      relationship('unrelated-edge', 'dependency-other-source', 'dependency-other-target'),
    ])
    return { mcp, project, identity, mutate, revision: () => revision, url: `/projects/${project}/runs/${run}` }
  } catch (error) {
    await mcp.close()
    throw error
  }
}

async function stableCamera(page: Page) {
  let previous = '', matches = 0
  await expect.poll(async () => {
    const current = await page.locator('.react-flow__viewport').getAttribute('style') ?? ''
    matches = current === previous ? matches + 1 : 0
    previous = current
    return matches
  }, { intervals: [100] }).toBeGreaterThanOrEqual(2)
  return previous
}

async function ready(page: Page, count = '6') {
  const canvas = page.getByTestId('architecture-canvas')
  await expect(canvas).toHaveAttribute('data-node-count', count)
  await expect(canvas).toHaveAttribute('data-layouting', 'false')
  await stableCamera(page)
  return canvas
}

async function standardZoom(page: Page) {
  const canvas = page.getByTestId('architecture-canvas')
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const zoom = Number(await canvas.getAttribute('data-canvas-zoom'))
    if (zoom >= 1 && zoom < 1.15) return
    if (zoom >= 1.15) {
      await page.locator('.react-flow__controls-zoomout').click()
    } else if (zoom < 0.9) {
      await page.locator('.react-flow__controls-zoomin').click()
    } else {
      const box = await canvas.boundingBox()
      if (!box) throw new Error('Canvas has no browser rectangle')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -20)
    }
    await stableCamera(page)
  }
  throw new Error(`Could not reach standard readable zoom: ${await canvas.getAttribute('data-canvas-zoom')}`)
}

async function fullDetailZoom(page: Page) {
  const canvas = page.getByTestId('architecture-canvas')
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (Number(await canvas.getAttribute('data-canvas-zoom')) >= 2.4) break
    await page.locator('.react-flow__controls-zoomin').click()
    await stableCamera(page)
  }
  expect(Number(await canvas.getAttribute('data-canvas-zoom'))).toBeGreaterThanOrEqual(2.4)
  await expect(page.getByTestId('canvas-node-dependency-hub')).toHaveAttribute('data-detail-level', 'full')
}

/** The bounded visible text must remain inside its painted background and
 * pointer target, including at high zoom where CSS transforms used to let it
 * escape. Read real screen geometry rather than the declared max-width alone.
 */
async function assertBoundedBadgeText(page: Page) {
  const badges = await page.locator(BADGES).evaluateAll((elements) => elements.map((element) => {
    const visual = element.querySelector('.canvas-flow-hit-area-visual') ?? element
    const text = visual.getBoundingClientRect()
    const target = element.getBoundingClientRect()
    const zoom = Number.parseFloat(getComputedStyle(element).getPropertyValue('--vai-canvas-zoom'))
    return {
      id: element.getAttribute('data-testid'), width: text.width, zoom,
      overflow: Math.max(target.left - text.left, text.right - target.right, target.top - text.top, text.bottom - target.bottom),
    }
  }))
  expect(badges.length).toBeGreaterThanOrEqual(2)
  for (const badge of badges) {
    expect(badge.zoom, `${badge.id}: measured zoom`).toBeGreaterThan(0)
    expect(badge.width / badge.zoom, `${badge.id}: graph-space text width`).toBeLessThanOrEqual(220.5)
    expect(badge.overflow, `${badge.id}: text outside its visible button`).toBeLessThanOrEqual(0.5)
  }
}

/** Real painted badge boxes, including their CSS transforms and truncation.
 * DOM text ranges would include the deliberately clipped part of long strings.
 * Include off-screen labels too: panning must not reveal an existing collision.
 */
async function assertNoLabelCollisions(page: Page, label: string) {
  const geometry = await page.evaluate((badgeSelector) => {
    const rectangle = (element: Element, id: string) => {
      const box = element.getBoundingClientRect()
      return { id, x: box.x, y: box.y, width: box.width, height: box.height }
    }
    const badges = [...document.querySelectorAll(badgeSelector)].map((element) =>
      rectangle(element.querySelector('.canvas-flow-hit-area-visual') ?? element, element.getAttribute('data-testid') ?? 'badge'),
    )
    const overlays = [...document.querySelectorAll('[data-testid^="overlay-mark-relationship-"]')].map((element) =>
      rectangle(element, element.getAttribute('data-testid') ?? 'overlay'),
    )
    const titles = [...document.querySelectorAll('.react-flow__node [data-testid="node-name"]')].map((element) =>
      rectangle(element, `title:${element.closest('.react-flow__node')?.getAttribute('data-id')}`),
    )
    const labels = [...badges, ...overlays].filter((box) => box.width > 0 && box.height > 0)
    const overlaps: string[] = []
    const intersects = (a: typeof labels[number], b: typeof labels[number]) =>
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 &&
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5
    for (let i = 0; i < labels.length; i += 1) {
      for (const other of [...labels.slice(i + 1), ...titles]) {
        if (intersects(labels[i]!, other)) overlaps.push(`${labels[i]!.id} overlaps ${other.id}`)
      }
    }
    return { badges, titles, overlaps }
  }, BADGES)
  expect(geometry.badges.length, `${label}: must measure rendered edge labels`).toBeGreaterThanOrEqual(2)
  expect(geometry.titles.length, `${label}: must measure rendered node titles`).toBeGreaterThanOrEqual(4)
  expect(geometry.overlaps, `${label}: actual browser rectangles`).toEqual([])
}

/** Sample the painted curve in screen coordinates. A self dependency must go
 * around its component, including its rounded bends, in either orientation.
 * Only the small endpoint/handle contact is exempt from this check.
 */
async function assertSelfLoopOutsideNode(page: Page, componentId: string) {
  const loop = page.getByTestId(`edge-path-rel:${componentId}~>${componentId}`)
  await expect(loop).toBeAttached()
  const geometry = await loop.evaluate((element, id) => {
    const path = element as SVGPathElement
    const node = document.querySelector(`.react-flow__node[data-id="${id}"]`)
    const matrix = path.getScreenCTM()
    if (!node || !matrix) throw new Error('Missing self-loop geometry')
    const box = node.getBoundingClientRect()
    const length = path.getTotalLength()
    const zoom = Math.hypot(matrix.a, matrix.b)
    const violations: { x: number; y: number }[] = []
    let samples = 0
    for (let offset = 4 / zoom; offset < length - 4 / zoom; offset += 1 / zoom) {
      const point = path.getPointAtLength(offset).matrixTransform(matrix)
      samples += 1
      if (point.x > box.left + 1 && point.x < box.right - 1 &&
          point.y > box.top + 1 && point.y < box.bottom - 1) {
        violations.push({ x: point.x, y: point.y })
      }
    }
    return { samples, violations: violations.slice(0, 5) }
  }, componentId)
  expect(geometry.samples, 'must sample the actual visible self-loop curve').toBeGreaterThan(20)
  expect(geometry.violations, 'self-loop must not cross its own component').toEqual([])
}

/** Label connectors are annotations, not additional dependency arrows. Their
 * route endpoint must attach to their own relationship's nearest segment.
 * Comparing rendered curves also catches a long leader back to an obsolete
 * preferred label position after collision avoidance moved the badge.
 */
async function assertLabelAnnotations(page: Page, relationships: {
  relationshipId: string; sourceComponentId: string; targetComponentId: string
}[]) {
  const annotations = await page.locator('[data-label-annotation="true"]').evaluateAll((elements, reported) => elements.map((element) => {
    const owner = element.getAttribute('data-label-for') ?? ''
    const line = element.querySelector('line')
    if (!line) throw new Error(`Missing annotation line for ${owner}`)
    const relationshipId = owner.replace(/^(edge-label-|overlay-mark-relationship-)/, '')
    const relationship = reported.find((candidate) => candidate.relationshipId === relationshipId)
    const pathId = owner.startsWith('edge-bundle-') || owner.startsWith('edge-collapse-')
      ? owner.replace(/^edge-(bundle|collapse)-/, 'edge-path-')
      : document.querySelector(`[data-testid="edge-path-${relationshipId}"]`)
        ? `edge-path-${relationshipId}`
        : relationship
          ? `edge-path-rel:${relationship.sourceComponentId}~>${relationship.targetComponentId}`
          : null
    const path = pathId ? document.querySelector<SVGPathElement>(`[data-testid="${pathId}"]`) : null
    const lineMatrix = line.getScreenCTM()
    const pathMatrix = path?.getScreenCTM()
    if (!path || !lineMatrix || !pathMatrix) throw new Error(`Cannot find owned route for ${owner}`)
    const zoom = Math.hypot(pathMatrix.a, pathMatrix.b)
    const point = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(lineMatrix)
    const anchor = point(line.x1.baseVal.value, line.y1.baseVal.value)
    const label = point(line.x2.baseVal.value, line.y2.baseVal.value)
    let anchorDistance = Infinity, closestLabelDistance = Infinity
    const length = path.getTotalLength()
    for (let offset = 0; offset <= length; offset += 0.5 / zoom) {
      const onPath = path.getPointAtLength(offset).matrixTransform(pathMatrix)
      anchorDistance = Math.min(anchorDistance, Math.hypot(onPath.x - anchor.x, onPath.y - anchor.y))
      closestLabelDistance = Math.min(closestLabelDistance, Math.hypot(onPath.x - label.x, onPath.y - label.y))
    }
    const style = getComputedStyle(line)
    return {
      owner, zoom, anchorDistance,
      excessLength: Math.hypot(anchor.x - label.x, anchor.y - label.y) - closestLabelDistance,
      markerStart: style.markerStart, markerEnd: style.markerEnd,
      dash: style.strokeDasharray, width: Number.parseFloat(style.strokeWidth),
      opacity: Number.parseFloat(style.strokeOpacity),
    }
  }), relationships)
  expect(annotations.length, 'dense fixture must exercise displaced-label annotations').toBeGreaterThan(0)
  for (const annotation of annotations) {
    expect(annotation.markerStart, annotation.owner).toBe('none')
    expect(annotation.markerEnd, annotation.owner).toBe('none')
    expect(annotation.dash, annotation.owner).toBe('none')
    expect(annotation.width, annotation.owner).toBeLessThanOrEqual(1)
    expect(annotation.opacity, annotation.owner).toBeLessThanOrEqual(0.3)
    // Cosmetic rounded corners deviate slightly from the underlying polyline.
    expect(annotation.anchorDistance / annotation.zoom, annotation.owner).toBeLessThanOrEqual(5)
    expect(annotation.excessLength / annotation.zoom, annotation.owner).toBeLessThanOrEqual(5)
  }
}

test('18 · component selection highlights incoming, outgoing, bundled and self relationships without changing the model or camera', async ({ page, request }) => {
  const model = await fixture()
  try {
    await page.goto(model.url)
    const canvas = await ready(page)
    await showWholeModel(page)
    await standardZoom(page)
    const hub = page.locator('.react-flow__node[data-id="dependency-hub"]')
    const incoming = page.getByTestId('edge-path-rel:dependency-upstream~>dependency-hub')
    const outgoing = page.getByTestId(`edge-path-${BUNDLE}`)
    const self = page.getByTestId('edge-path-rel:dependency-hub~>dependency-hub')
    const unrelated = page.getByTestId('edge-path-rel:dependency-other-source~>dependency-other-target')
    const initialStroke = await incoming.evaluate((element) => getComputedStyle(element).stroke)
    const before = await stableCamera(page)
    const fitCount = await canvas.getAttribute('data-fit-view-count')
    const positions = () => page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('data-id'), (node as HTMLElement).style.transform]))
    const initialPositions = await positions()
    await hub.click()
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'dependency-hub')
    for (const path of [incoming, outgoing, self]) {
      await expect(path).toHaveAttribute('data-component-related', 'true')
      await expect(path).toHaveCSS('opacity', '1')
      await expect.poll(() => path.evaluate((element) => getComputedStyle(element).stroke)).not.toBe(initialStroke)
      await expect(path).toHaveAttribute('marker-end', /-selected/)
    }
    await expect(unrelated).toHaveCSS('opacity', '0.25')
    await expect(page.locator(`${BADGES.split(', ').map((selector) => `${selector}[aria-current="true"]`).join(', ')}`)).toHaveCount(0)
    expect(await stableCamera(page)).toBe(before)
    expect(await canvas.getAttribute('data-fit-view-count')).toBe(fitCount)
    expect(await positions()).toEqual(initialPositions)

    // The bundle control changes presentation, while all three represented
    // dependencies remain highlighted and no relationship becomes selected.
    await page.getByTestId(`edge-bundle-${BUNDLE}`).focus()
    await page.keyboard.press('Enter')
    for (const id of ['bundle-one', 'bundle-two', 'bundle-three']) {
      await expect(page.getByTestId(`edge-path-${id}`)).toHaveAttribute('data-component-related', 'true')
      await expect(page.getByTestId(`edge-label-${id}`)).not.toHaveAttribute('aria-current', 'true')
    }
    const consumer = page.locator('.react-flow__node[data-id="dependency-consumer"]')
    await consumer.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'dependency-consumer')
    await expect(incoming).toHaveCSS('opacity', '0.25')
    await expect(self).toHaveCSS('opacity', '0.25')
    await expect(page.getByTestId('edge-path-bundle-two')).toHaveCSS('opacity', '1')
    await page.keyboard.press('Escape')
    await expect(page.locator('path[data-relationship-kind][data-component-related="true"]')).toHaveCount(0)
    for (const path of await mainPaths(page).all()) await expect(path).toHaveCSS('opacity', '1')

    const label = page.getByTestId('edge-label-bundle-one')
    await label.focus()
    await page.keyboard.press('Enter')
    await expect(label).toHaveAttribute('aria-current', 'true')
    await expect(page.getByTestId('inspector-relationship-context')).toHaveAttribute('data-relationship-id', 'bundle-one')
    await expect(page.getByTestId('inspector-relationship-context')).toContainText(`${LONG_OPERATION}/bundle-one`)
    await page.keyboard.press('Escape')
    await expect(label).not.toHaveAttribute('aria-current', 'true')
    const current = await model.mcp.call('visualise_model_read', { contractVersion: '2.0.0', projectId: model.project })
    expect(current.modelRevision).toBe(model.revision())

    // A saved view excluding the selected component must not dim its entire
    // unrelated graph, even though selection remains in the URL/history.
    await hub.focus()
    await page.keyboard.press('Enter')
    await model.mcp.call('visualise_view_put', { ...model.identity(), expectedModelRevision: model.revision(), expectedViewRevision: 0, view: {
      viewId: 'independent-view', name: 'Independent pair', kind: 'architecture', orientation: 'top-down', collapsedComponentIds: [],
      selection: { mode: 'explicit', scope: { componentIds: ['dependency-other-source', 'dependency-other-target'], relationshipIds: ['unrelated-edge'] } },
    } })
    await page.getByTestId('architecture-view-selector').selectOption('independent-view')
    await ready(page, '2')
    await expect(unrelated).toHaveCSS('opacity', '1')
    await expect(unrelated).not.toHaveAttribute('data-component-related', 'true')
    await page.getByTestId('architecture-view-selector').selectOption('')
    await ready(page)
    await hub.focus()
    if (!page.url().includes('component=dependency-hub')) await page.keyboard.press('Enter')
    await model.mutate([
      ...['incoming-edge', 'bundle-one', 'bundle-two', 'bundle-three', 'self-edge'].map((relationshipId) => ({ op: 'relationship.remove', relationshipId })),
      { op: 'component.remove', componentId: 'dependency-hub' },
    ])
    // Recent removal overlays are intentionally shown before their event-count
    // expiry. Once the selected node disappears, unrelated edges recover.
    for (let i = 0; i < 8; i += 1) await model.mutate([{ op: 'component.update', componentId: 'dependency-upstream', set: { description: `After removal ${i}` } }])
    await expect(hub).toHaveCount(0)
    await expect(unrelated).toHaveCSS('opacity', '1')
    const history = await request.get(`/api/v1/projects/${model.project}/components/dependency-hub/history`)
    expect(history.ok()).toBe(true)
  } finally { await model.mcp.close() }
})

for (const language of ['de', 'en'] as const) {
  for (const orientation of ['top-down', 'left-right'] as const) {
    test(`18 · long relationship labels do not overlap in ${language}, ${orientation}, folded, unfolded or collapsed`, async ({ page }, testInfo) => {
      const model = await fixture()
      try {
        // A real explicit work scope adds persistent active-work marks. Their
        // rectangles participate in the same collision check as the labels.
        await model.mcp.call('visualise_work_scope_set', { ...model.identity(), scope: {
          componentIds: [], relationshipIds: ['incoming-edge', 'bundle-one', 'bundle-two', 'bundle-three', 'self-edge', 'unrelated-edge'],
        } })
        await page.goto(model.url)
        await ready(page)
        await page.getByTestId(`language-option-${language}`).click()
        await expect(page.locator('html')).toHaveAttribute('lang', language)
        await page.getByTestId(`canvas-layout-${orientation}`).click()
        await showWholeModel(page)
        await standardZoom(page)
        await expect(page.getByTestId(`edge-bundle-${BUNDLE}`)).toBeAttached()
        await expect(page.getByTestId('overlay-mark-relationship-incoming-edge')).toHaveAttribute('data-work-state', 'active')
        expect(await page.locator('[data-testid^="overlay-mark-relationship-"]').count()).toBeGreaterThanOrEqual(4)
        await assertNoLabelCollisions(page, 'folded')
        await assertSelfLoopOutsideNode(page, 'dependency-hub')

        const selectedHub = page.locator('.react-flow__node[data-id="dependency-hub"]')
        await selectedHub.focus()
        await page.keyboard.press('Enter')
        await page.screenshot({ path: testInfo.outputPath(`dependencies-folded-selected-${language}-${orientation}.png`), fullPage: true })
        await page.keyboard.press('Escape')

        await page.getByTestId(`edge-bundle-${BUNDLE}`).focus()
        await page.keyboard.press('Enter')
        const label = page.getByTestId('edge-label-bundle-one')
        await expect(label).toBeAttached()
        await expect(page.locator('[data-testid^="overlay-mark-relationship-"]')).toHaveCount(6)
        await assertNoLabelCollisions(page, 'unfolded')
        const before = await label.locator('.canvas-flow-hit-area-visual').boundingBox()
        await label.focus()
        await expect(label).toHaveAccessibleName(new RegExp(`${LONG_OPERATION}/bundle-one`))
        await assertNoLabelCollisions(page, 'focused long text')
        const focused = await label.locator('.canvas-flow-hit-area-visual').boundingBox()
        expect(before).not.toBeNull()
        expect(focused).not.toBeNull()
        expect(focused!.width).toBeLessThanOrEqual(before!.width + 0.5)
        await page.keyboard.press('Enter')
        await expect(label).toHaveAttribute('aria-current', 'true')
        await assertNoLabelCollisions(page, 'selected long text')
        const box = await label.boundingBox()
        expect(box!.width).toBeGreaterThanOrEqual(31.99)
        expect(box!.height).toBeGreaterThanOrEqual(31.99)
        await page.keyboard.press('Escape')
        await page.screenshot({ path: testInfo.outputPath(`dependencies-${language}-${orientation}.png`), fullPage: true })

        // Zoom changes readability, not the number of dependency arrows.
        // Every member remains explicitly reachable with the keyboard.
        await page.getByTestId(`edge-collapse-${BUNDLE}`).focus()
        await page.keyboard.press('Enter')
        await expect(page.getByTestId(`edge-bundle-${BUNDLE}`)).toBeAttached()
        await fullDetailZoom(page)
        await expect(page.getByTestId(`edge-bundle-${BUNDLE}`)).toBeAttached()
        await expect(page.getByTestId(`edge-path-${BUNDLE}`)).toBeAttached()
        await expect(mainPaths(page)).toHaveCount(4)
        await expect(page.getByTestId('edge-path-bundle-three')).toHaveCount(0)
        await assertNoLabelCollisions(page, 'folded at high zoom')
        await assertSelfLoopOutsideNode(page, 'dependency-hub')
        await page.getByTestId(`edge-bundle-${BUNDLE}`).focus()
        await page.keyboard.press('Enter')
        await expect(mainPaths(page)).toHaveCount(6)
        await expect(page.getByTestId('edge-label-bundle-three')).toBeAttached()
        await assertNoLabelCollisions(page, 'explicit full-detail expansion at high zoom')
        await assertBoundedBadgeText(page)
        await label.focus()
        await page.keyboard.press('Enter')
        await expect(label).toHaveAttribute('aria-current', 'true')
        await assertNoLabelCollisions(page, 'selected long label at high zoom')
        await assertBoundedBadgeText(page)
        await page.keyboard.press('Escape')
        await page.screenshot({ path: testInfo.outputPath(`dependencies-high-zoom-${language}-${orientation}.png`), fullPage: true })

        // Collapsed containers represent their incident external dependencies.
        await page.getByTestId('node-disclosure-dependency-group').focus()
        await page.keyboard.press('Enter')
        await ready(page)
        await expect(page.locator('.react-flow__node')).toHaveCount(4)
        await standardZoom(page)
        const group = page.locator('.react-flow__node[data-id="dependency-group"]')
        await group.focus()
        await page.keyboard.press('Enter')
        await expect(page.getByTestId('edge-path-rel:dependency-upstream~>dependency-group')).toHaveAttribute('data-component-related', 'true')
        await assertNoLabelCollisions(page, 'collapsed container')
      } finally { await model.mcp.close() }
    })
  }
}

for (const orientation of ['top-down', 'left-to-right'] as const) {
  test(`18 · native full-detail export keeps dense long labels apart in ${orientation}`, async ({ page }, testInfo) => {
    const nodes = ['native-upstream', 'native-hub', 'native-consumer', 'native-other']
    const relationship = (id: string, source: string, target: string) => ({
      relationshipId: id, sourceComponentId: source, targetComponentId: target,
      kind: 'dependency', protocol: 'HTTP', operation: `${LONG_OPERATION}/${id}`,
    })
    const relationships = [
      ...Array.from({ length: 6 }, (_, index) => relationship(`native-bundle-${index}`, 'native-hub', 'native-consumer')),
      relationship('native-incoming', 'native-upstream', 'native-hub'),
      relationship('native-self', 'native-hub', 'native-hub'),
      relationship('native-downstream', 'native-consumer', 'native-other'),
      relationship('native-crossing', 'native-upstream', 'native-other'),
    ]
    const snapshot = {
      model: {
        components: nodes.map((id) => ({ componentId: id, name: id, kind: 'service', parentComponentId: null })),
        relationships,
      },
      view: { viewId: 'native-dependencies', name: 'Dense dependencies', kind: 'architecture', selection: { mode: 'all' }, orientation, collapsedComponentIds: [] },
      viewRevision: 1,
    }
    await page.goto('/render.html')
    const result = await page.evaluate(async (captured) => {
      const render = (window as unknown as { visualiseRender: (snapshot: unknown, settings: unknown) => Promise<{ visibleIds: { componentIds: string[]; relationshipIds: string[] }; clipped: boolean }> }).visualiseRender
      return render(captured, { viewport: { width: 1920, height: 1080, pixelRatio: 1 }, detailLevel: 'full' })
    }, snapshot)
    expect(result.visibleIds.relationshipIds.length).toBeGreaterThan(0)
    await expect(page.locator('.react-flow__node')).toHaveCount(4)
    await expect(mainPaths(page)).toHaveCount(relationships.length)
    await expect(page.getByTestId('edge-label-native-bundle-5')).toBeAttached()
    await assertNoLabelCollisions(page, `native full-detail ${orientation}`)
    await assertSelfLoopOutsideNode(page, 'native-hub')
    await assertLabelAnnotations(page, relationships)
    await assertBoundedBadgeText(page)
    await page.screenshot({ path: testInfo.outputPath(`native-dependencies-${orientation}.png`) })
  })
}
