import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { connectMcp, writeIdentity } from '../src/mcp.js'
import { attachMeasurements } from '../src/measurements.js'
import { BASE_URL } from '../src/config.js'

// Browser-level regression of the actual dedicated production entry. These
// descriptors are injected like the backend's detached CDP value; no UI store,
// REST fetch or user session participates in the render.
test('native full-detail rendering reports only the painted members of a clipped bundle', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 240 })
  await page.goto('/render.html')
  const snapshot = {
    model: {
      components: [
        { componentId: 'aaa', name: 'Independent', kind: 'service', parentComponentId: null },
        { componentId: 'bbb', name: 'Source', kind: 'service', parentComponentId: null },
        { componentId: 'ccc', name: 'Target', kind: 'service', parentComponentId: null },
      ],
      relationships: Array.from({ length: 12 }, (_, i) => ({
        relationshipId: `edge-${String(i).padStart(2, '0')}`, sourceComponentId: 'bbb', targetComponentId: 'ccc', kind: 'dependency',
      })),
    },
    view: { viewId: 'view-all', name: 'All', kind: 'architecture', selection: { mode: 'all' }, orientation: 'top-down', collapsedComponentIds: [] },
    viewRevision: 1,
  }
  const result = await page.evaluate(async (captured) => {
    const render = (window as unknown as { visualiseRender: (snapshot: unknown, settings: unknown) => Promise<{ visibleIds: { componentIds: string[]; relationshipIds: string[] }; clipped: boolean }> }).visualiseRender
    return render(captured, { viewport: { width: 320, height: 240, pixelRatio: 1 }, detailLevel: 'full' })
  }, snapshot)
  expect(result.clipped).toBe(true)
  expect(result.visibleIds.relationshipIds.length).toBeGreaterThan(0)
  expect(result.visibleIds.relationshipIds.length).toBeLessThan(12)
  await expect(page.locator('.react-flow__node')).toHaveCount(3)
  await expect(page.locator('path[data-relationship-kind]')).toHaveCount(12)
  await page.screenshot({ path: testInfo.outputPath('native-clipped-bundle.png') })
})

test('native render supports empty scope and never requests domain endpoints', async ({ page }, testInfo) => {
  const domainRequests: string[] = []
  page.on('request', (request) => { if (/\/(api|mcp)\b/.test(new URL(request.url()).pathname)) domainRequests.push(request.url()) })
  await page.goto('/render.html')
  const result = await page.evaluate(async () => {
    const render = (window as unknown as { visualiseRender: (snapshot: unknown, settings: unknown) => Promise<{ visibleIds: { componentIds: string[]; relationshipIds: string[] }; clipped: boolean }> }).visualiseRender
    return render({
      model: { components: [], relationships: [] },
      view: { viewId: 'empty-view', name: 'Empty', kind: 'architecture', selection: { mode: 'all' }, orientation: 'left-to-right', collapsedComponentIds: [] },
      viewRevision: 1,
    }, { viewport: { width: 1920, height: 1080, pixelRatio: 1 }, detailLevel: 'readable' })
  })
  expect(result.visibleIds).toEqual({ componentIds: [], relationshipIds: [] })
  expect(result.clipped).toBe(false)
  expect(domainRequests).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('native-empty.png') })
})

test('native renderer preserves native fallback geometry for valid self relationships', async ({ page }, testInfo) => {
  await page.goto('/render.html')
  const result = await page.evaluate(async () => {
    const render = (window as unknown as { visualiseRender: (snapshot: unknown, settings: unknown) => Promise<{ visibleIds: { componentIds: string[]; relationshipIds: string[] }; clipped: boolean }> }).visualiseRender
    return render({
      model: {
        components: [{ componentId: 'self-service', name: 'Self service', kind: 'service', parentComponentId: null }],
        relationships: [{ relationshipId: 'self-relationship', sourceComponentId: 'self-service', targetComponentId: 'self-service', kind: 'dependency' }],
      },
      view: { viewId: 'self-view', name: 'Self', kind: 'architecture', selection: { mode: 'all' }, orientation: 'top-down', collapsedComponentIds: [] },
      viewRevision: 1,
    }, { viewport: { width: 1920, height: 1080, pixelRatio: 1 }, detailLevel: 'standard' })
  })
  expect(result.visibleIds).toEqual({ componentIds: ['self-service'], relationshipIds: ['self-relationship'] })
  expect(result.clipped).toBe(false)
  await expect(page.locator('path[data-relationship-kind]')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('native-self-relationship.png') })
})

test('official MCP client reads a real native PNG without a user page, handles exact revisions and preserves a later user camera', async ({ browser }, testInfo) => {
  const mcp = await connectMcp()
  const project = `mcp-render-${randomUUID().slice(0, 8)}`
  const identity = () => writeIdentity(project, 'render-run', 'render-root')
  const read = { contractVersion: '2.0.0', projectId: project }
  const view = { viewId: 'review-view', name: 'Review', kind: 'architecture', selection: { mode: 'all' }, orientation: 'top-down', collapsedComponentIds: [] }
  const args = { ...read, viewId: view.viewId, expectedModelRevision: 1, expectedViewRevision: 1,
    viewport: { width: 800, height: 600, pixelRatio: 2 }, detailLevel: 'standard' }
  const samples: number[] = []
  async function render(input = args) {
    const started = performance.now()
    const result = await mcp.client.callTool({ name: 'visualise_view_render', arguments: input })
    samples.push(performance.now() - started)
    if (result.isError) throw new Error(JSON.stringify(result.structuredContent))
    const images = (result.content as { type: string; mimeType?: string; data?: string }[]).filter((content) => content.type === 'image')
    expect(images).toHaveLength(1)
    expect(images[0]?.mimeType).toBe('image/png')
    const png = Buffer.from(images[0]!.data!, 'base64')
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(png.readUInt32BE(16)).toBe(input.viewport.width * input.viewport.pixelRatio)
    expect(png.readUInt32BE(20)).toBe(input.viewport.height * input.viewport.pixelRatio)
    expect(png.length).toBeLessThanOrEqual(4 * 1024 * 1024)
    const metadata = result.structuredContent as Record<string, unknown>
    expect(metadata).toMatchObject({ projectId: project, viewId: view.viewId, modelRevision: input.expectedModelRevision, viewRevision: input.expectedViewRevision, viewport: input.viewport, detailLevel: input.detailLevel, byteLength: png.length, mimeType: 'image/png' })
    expect(metadata.visibleIds).toEqual({ componentIds: ['gateway-api', 'worker'], relationshipIds: ['gateway-worker'] })
    expect(metadata.clipped).toBe(false)
    return { png, metadata }
  }
  try {
    expect(mcp.catalogue.tools.map((tool) => tool.name)).toContain('visualise_view_render')
    await mcp.call('visualise_context_open', { ...identity(), role: 'orchestrator', displayName: 'Render root', assignedTask: 'Inspect and correct architecture' })
    await mcp.call('visualise_model_mutate', { ...identity(), expectedModelRevision: 0, operations: [
      { op: 'component.add', component: { componentId: 'gateway-api', name: 'Long reported gateway name', kind: 'service', parentComponentId: null } },
      { op: 'component.add', component: { componentId: 'worker', name: 'Worker', kind: 'service', parentComponentId: null } },
      { op: 'relationship.add', relationship: { relationshipId: 'gateway-worker', sourceComponentId: 'gateway-api', targetComponentId: 'worker', kind: 'dependency' } },
    ] })
    const saved = await mcp.call('visualise_view_put', { ...identity(), expectedModelRevision: 1, expectedViewRevision: 0, view })
    const model = await mcp.call('visualise_model_read', read)
    const savedView = await mcp.call('visualise_view_get', { ...read, viewId: view.viewId })
    expect(model.modelRevision).toBe(savedView.modelRevision)
    // No user page exists for this first request; only the backend can draw it.
    expect(browser.contexts().flatMap((context) => context.pages())).toHaveLength(0)
    const first = await render()
    expect(first.metadata.projectPosition).toBe(saved.projectPosition)
    await writeFile(testInfo.outputPath('mcp-native-before.png'), first.png)

    const corrected = await mcp.call('visualise_model_mutate', { ...identity(), expectedModelRevision: 1,
      operations: [{ op: 'component.update', componentId: 'gateway-api', set: { name: 'Gateway' } }] })
    const stale = await mcp.client.callTool({ name: 'visualise_view_render', arguments: args })
    expect(stale.isError).toBe(true)
    expect(stale.structuredContent).toMatchObject({ code: 'revision_conflict', currentModelRevision: 2, currentViewRevision: 1 })
    expect((stale.content as { type: string }[]).some((item) => item.type === 'image')).toBe(false)
    const unknown = await mcp.client.callTool({ name: 'visualise_view_render', arguments: { ...args, expectedModelRevision: 2, viewId: 'unknown-view' } })
    expect(unknown.isError).toBe(true)
    expect(unknown.structuredContent).toMatchObject({ code: 'view_not_found' })
    const invalidReference = await mcp.client.callTool({ name: 'visualise_model_mutate', arguments: {
      ...identity(), expectedModelRevision: 2, operations: [{ op: 'relationship.add', relationship: { relationshipId: 'invalid-edge', sourceComponentId: 'gateway-api', targetComponentId: 'missing-component', kind: 'dependency' } }],
    } })
    expect(invalidReference.isError).toBe(true)
    expect(invalidReference.structuredContent).toMatchObject({ code: 'reference_invalid' })

    const page = await browser.newPage({ baseURL: BASE_URL, viewport: { width: 1920, height: 1080 } })
    try {
      await page.goto(`/projects/${project}/runs/render-run`)
      const canvas = page.getByTestId('architecture-canvas')
      await expect(canvas).toHaveAttribute('data-node-count', '2')
      await expect(canvas).toHaveAttribute('data-layouting', 'false')
      await page.locator('.react-flow__node[data-id="gateway-api"]').click()
      await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'gateway-api')
      const camera = await page.locator('.react-flow__viewport').getAttribute('style')
      const url = page.url()
      const second = await render({ ...args, expectedModelRevision: 2 })
      expect(second.metadata.projectPosition).toBe(corrected.projectPosition)
      expect(second.png.equals(first.png)).toBe(false)
      expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(camera)
      expect(page.url()).toBe(url)
      await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'gateway-api')
      await writeFile(testInfo.outputPath('mcp-native-after.png'), second.png)
    } finally { await page.close() }
    await mcp.call('visualise_view_put', { ...identity(), expectedModelRevision: 2, expectedViewRevision: 1, view: { ...view, orientation: 'left-to-right' } })
    const staleView = await mcp.client.callTool({ name: 'visualise_view_render', arguments: { ...args, expectedModelRevision: 2 } })
    expect(staleView.isError).toBe(true)
    expect(staleView.structuredContent).toMatchObject({ code: 'revision_conflict', currentModelRevision: 2, currentViewRevision: 2 })
    await render({ ...args, expectedModelRevision: 2, expectedViewRevision: 2 })
    await mcp.call('visualise_work_report', { ...identity(), report: { action: 'run_finish', outcome: 'completed', summary: 'Native image checked and gateway label corrected' } })
    await attachMeasurements(testInfo, browser, 'native-render-measurements', samples, { measurement: 'successful MCP image call roundtrip', model: { components: 2, relationships: 1 }, viewport: args.viewport, detailLevel: args.detailLevel })
  } finally { await mcp.close() }
})
