import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { connectMcp, writeIdentity } from '../src/mcp.js'

test('15 · official MCP writes update the interactive canvas, preserve contributions and replay safely', async ({ page, context }, testInfo) => {
  const mcp = await connectMcp()
  const project = `mcp-canvas-${randomUUID().slice(0, 8)}`
  const run = 'run-canvas'
  const root = 'canvas-root'
  const child = 'canvas-worker'
  let revision = 0
  const identity = (agent = root) => writeIdentity(project, run, agent, agent === root ? null : root)
  async function mutate(operations: Record<string, unknown>[], agent = root) {
    const input = { ...identity(agent), expectedModelRevision: revision, operations }
    const receipt = await mcp.call('visualise_model_mutate', input)
    revision = receipt.modelRevision as number
    return { input, receipt }
  }
  const component = (id: string, name: string) => ({ componentId: id, name, kind: 'service', parentComponentId: null })
  const relationship = (id: string, target: string) => ({ relationshipId: id, sourceComponentId: 'mcp-api', targetComponentId: target, kind: 'dependency' })
  try {
    expect(mcp.catalogue.tools.map((one) => one.name)).toContain('visualise_model_mutate')
    await mcp.call('visualise_context_open', { ...identity(), role: 'orchestrator', displayName: 'Canvas root', assignedTask: 'Describe architecture' })
    await mcp.call('visualise_context_open', { ...identity(child), role: 'subagent', displayName: 'Canvas worker', assignedTask: 'Inspect shared elements' })
    await mutate([{ op: 'component.add', component: component('mcp-api', 'MCP API') }, { op: 'component.add', component: component('mcp-worker', 'MCP Worker') }, { op: 'relationship.add', relationship: relationship('api-worker', 'mcp-worker') }])
    await page.goto(`/projects/${project}/runs/${run}`)
    const canvas = page.getByTestId('architecture-canvas')
    await expect(canvas).toHaveAttribute('data-node-count', '2')
    await expect(canvas).toHaveAttribute('data-layouting', 'false')
    await expect(page.getByTestId('live-connection-state')).toHaveAttribute('data-state', 'live')
    const api = page.locator('.react-flow__node[data-id="mcp-api"]')
    await api.click()
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'mcp-api')
    // Real wheel/pan input claims the camera. Subsequent writes cannot fit it.
    const box = await canvas.boundingBox()
    if (!box) throw new Error('canvas missing')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -80)
    await expect.poll(async () => page.locator('.react-flow__viewport').getAttribute('style')).toContain('transform')
    await api.focus()
    const camera = await page.locator('.react-flow__viewport').getAttribute('style')
    const fitCount = await canvas.getAttribute('data-fit-view-count')
    await page.evaluate(() => {
      const state = { incoherent: false }
      ;(window as unknown as { mcpCanvasProbe: typeof state }).mcpCanvasProbe = state
      new MutationObserver(() => {
        const edge = document.querySelector('.react-flow__edge[data-id="rel:mcp-api~>mcp-store"]')
        const node = document.querySelector('.react-flow__node[data-id="mcp-store"]')
        if (edge && !node) state.incoherent = true
      }).observe(document.querySelector('[data-testid="architecture-canvas"]')!, { childList: true, subtree: true })
    })
    await mutate([{ op: 'component.add', component: component('mcp-store', 'MCP Store') }, { op: 'relationship.add', relationship: relationship('api-store', 'mcp-store') }])
    await expect(canvas).toHaveAttribute('data-node-count', '3')
    await expect(canvas).toHaveAttribute('data-layouting', 'false')
    const applied = page.getByTestId('overlay-mark-component-mcp-store')
    await expect(applied).toHaveAttribute('data-work-state', 'recently_applied')
    await expect(applied).toHaveAttribute('data-presence', 'applied')
    expect(await page.evaluate(() => (window as unknown as { mcpCanvasProbe: { incoherent: boolean } }).mcpCanvasProbe.incoherent)).toBe(false)
    await expect(api).toBeFocused()
    expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(camera)
    expect(await canvas.getAttribute('data-fit-view-count')).toBe(fitCount)

    for (const agent of [root, child]) await mcp.call('visualise_work_scope_set', { ...identity(agent), scope: { componentIds: ['mcp-api', 'mcp-store'], relationshipIds: ['api-store'] } })
    await expect(page.getByTestId('overlay-mark-component-mcp-api')).toHaveAttribute('data-agent-count', '2')
    await expect(page.getByTestId('element-contributions')).toContainText(root)
    await expect(page.getByTestId('element-contributions')).toContainText(child)
    await page.screenshot({ path: testInfo.outputPath('mcp-overlapping-scopes.png'), fullPage: true })
    await expect(page.getByTestId('overlay-mark-relationship-api-store')).toHaveAttribute('data-agent-count', '2')
    const scopedEdge = page.locator('.react-flow__edge[data-id="rel:mcp-api~>mcp-store"]')
    await scopedEdge.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('inspector-relationship-context')).toHaveAttribute('data-relationship-id', 'api-store')
    await expect(page.getByTestId('element-contributions')).toContainText(child)
    await api.click()
    await api.focus()
    const rename = await mutate([{ op: 'component.update', componentId: 'mcp-api', set: { name: 'MCP API renamed' } }], child)
    await expect(api).toHaveAttribute('aria-label', /MCP API renamed/)
    await expect(page.getByTestId('inspector-context')).toContainText('MCP API renamed')
    await expect(api).toBeFocused()
    const beforeRetry = await page.getByTestId('element-contributions').locator('li').count()
    expect((await mcp.call('visualise_model_mutate', rename.input)).duplicate).toBe(true)
    await expect(page.getByTestId('element-contributions').locator('li')).toHaveCount(beforeRetry)

    // Browser reconnect replays the missed mutation; the SDK remains connected.
    await context.setOffline(true)
    await mutate([{ op: 'component.update', componentId: 'mcp-api', set: { description: 'Delivered during reconnect' } }])
    await context.setOffline(false)
    await expect(page.getByTestId('inspector-context')).toContainText('Delivered during reconnect')
    await expect(page.getByTestId('live-connection-state')).toHaveAttribute('data-state', 'live')
    expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(camera)
    await expect(api).toBeFocused()

    // Hydration after an intentional reload keeps both explicit scope reports.
    await page.reload()
    await expect(page.getByTestId('overlay-mark-component-mcp-api')).toHaveAttribute('data-agent-count', '2')
    const store = page.locator('.react-flow__node[data-id="mcp-store"]')
    await store.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'mcp-store')
    await expect(page.getByTestId('element-contributions')).toContainText(child)
    await mutate([{ op: 'relationship.remove', relationshipId: 'api-store' }, { op: 'component.remove', componentId: 'mcp-store' }])
    await expect(canvas).toHaveAttribute('data-node-count', '2')
    await expect(page.getByTestId('overlay-mark-component-mcp-store')).toHaveAttribute('data-work-state', 'removed')
    await expect(page.getByTestId('inspector-context')).toContainText('nicht im angewandten Modell')
    await expect(store).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('mcp-selected-removal.png'), fullPage: true })
    // Recent ghosts expire by event count, not time; selection/history remains.
    for (let i = 0; i < 8; i++) await mutate([{ op: 'component.update', componentId: 'mcp-worker', set: { description: `Follow-up ${i}` } }])
    await expect(store).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('react-flow__node'))).toBe(true)
    await expect(page).toHaveURL(/component=mcp-store/)
    await page.getByRole('tab', { name: 'Historie' }).click()
    await expect(page.getByTestId('inspector-history')).toContainText('Modelländerung angewendet')
    // Explicit completion suppresses activity while retaining scope evidence.
    await mcp.call('visualise_work_report', { ...identity(), report: { action: 'run_finish', outcome: 'completed', summary: 'Canvas acceptance complete' } })
    await expect(page.getByTestId('element-contributions')).toContainText('beendet')
  } finally {
    await context.setOffline(false)
    await mcp.close()
  }
})
