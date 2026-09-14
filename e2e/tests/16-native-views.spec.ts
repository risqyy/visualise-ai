import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

import { connectMcp, writeIdentity } from '../src/mcp.js'

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

test('16 · MCP views share identities and history while keeping local interaction and opaque deep links', async ({ page, request }, testInfo) => {
  const mcp = await connectMcp()
  const project = `mcp-views-${randomUUID().slice(0, 8)}`
  const run = 'views-run', root = 'views-root'
  const identity = () => writeIdentity(project, run, root)
  let revision = 0
  const allId = 'team/all', detailId = '..'
  const view = (viewId: string, name: string, selection: Record<string, unknown>, orientation = 'top-down') => ({ viewId, name, kind: 'architecture', selection, orientation, collapsedComponentIds: [] })
  const all = view(allId, 'Complete architecture', { mode: 'all' })
  const detail = view(detailId, 'API detail', { mode: 'explicit', scope: { componentIds: ['node-aa', 'node-bb'], relationshipIds: ['edge-aa'] } }, 'left-to-right')
  async function mutate(operations: Record<string, unknown>[]) {
    const receipt = await mcp.call('visualise_model_mutate', { ...identity(), expectedModelRevision: revision, operations })
    revision = receipt.modelRevision as number
    return receipt
  }
  async function ready(count: string) {
    const canvas = page.getByTestId('architecture-canvas')
    await expect(canvas).toHaveAttribute('data-node-count', count)
    await expect(canvas).toHaveAttribute('data-layouting', 'false')
    return canvas
  }
  try {
    await mcp.call('visualise_context_open', { ...identity(), role: 'orchestrator', displayName: 'View author', assignedTask: 'Create two shared model views' })
    await mutate([
      ...['group-aa', 'node-aa', 'node-bb', 'node-cc'].map((id) => ({ op: 'component.add', component: { componentId: id, name: id, kind: id === 'group-aa' ? 'system' : 'service', parentComponentId: id === 'node-aa' || id === 'node-bb' ? 'group-aa' : null } })),
      { op: 'relationship.add', relationship: { relationshipId: 'edge-aa', sourceComponentId: 'node-aa', targetComponentId: 'node-bb', kind: 'dependency' } },
    ])
    for (const definition of [all, detail]) {
      const receipt = await mcp.call('visualise_view_put', { ...identity(), expectedModelRevision: revision, expectedViewRevision: 0, view: definition })
      expect(receipt.modelRevision).toBe(revision)
      expect(receipt.viewRevision).toBe(1)
    }
    await mcp.call('visualise_work_scope_set', { ...identity(), scope: { componentIds: ['node-aa'], relationshipIds: ['edge-aa'] } })
    await page.goto(`/projects/${project}/runs/${run}`)
    await ready('4')
    const selector = page.getByTestId('architecture-view-selector')
    await expect(selector.locator('option')).toHaveCount(3)
    await selector.selectOption(allId)
    const canvas = await ready('4')
    const component = page.locator('.react-flow__node[data-id="node-aa"]')
    await component.focus(); await page.keyboard.press('Enter')
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'node-aa')
    await expect(page.getByTestId('element-contributions')).toContainText(root)
    await page.getByTestId('canvas-layout-left-right').click()
    await expect(canvas).toHaveAttribute('data-layout-orientation', 'left-right')
    await expect(canvas).toHaveAttribute('data-layouting', 'false')
    const box = await canvas.boundingBox(); if (!box) throw new Error('canvas missing')
    const beforeWheel = await stableCamera(page)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -100)
    await expect.poll(() => page.locator('.react-flow__viewport').getAttribute('style')).not.toBe(beforeWheel)
    const allCamera = await stableCamera(page)
    await selector.selectOption(detailId)
    await ready('3')
    await expect(page.locator('.react-flow__node[data-id="node-cc"]')).toHaveCount(0)
    await component.focus(); await page.keyboard.press('Enter')
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'node-aa')
    await expect(page.getByTestId('element-contributions')).toContainText(root)
    const detailCamera = await stableCamera(page)
    expect(detailCamera).not.toBe(allCamera)
    const historyBefore = await request.get(`/api/v1/projects/${project}/components/node-aa/history`)
    expect(historyBefore.ok()).toBe(true)
    const history = await historyBefore.json()
    expect(history.entries.length).toBeGreaterThan(0)
    const originalHistoryIds = history.entries.map((entry: { serverEventId: string }) => entry.serverEventId)
    await mutate([{ op: 'component.update', componentId: 'node-aa', set: { name: 'Shared API renamed' } }])
    await expect(component).toHaveAttribute('aria-label', /Shared API renamed/)
    await expect(page.getByTestId('inspector-context')).toContainText('Shared API renamed')
    expect(await stableCamera(page)).toBe(detailCamera)
    await page.screenshot({ path: testInfo.outputPath('native-detail-view.png'), fullPage: true })
    await selector.selectOption(allId)
    await ready('4')
    await expect(canvas).toHaveAttribute('data-layout-orientation', 'left-right')
    await expect(component).toHaveAttribute('aria-label', /Shared API renamed/)
    expect(await stableCamera(page)).toBe(allCamera)
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'node-aa')
    const after = await (await request.get(`/api/v1/projects/${project}/components/node-aa/history`)).json()
    expect(after.entries.map((entry: { serverEventId: string }) => entry.serverEventId)).toEqual(expect.arrayContaining(originalHistoryIds))
    await page.screenshot({ path: testInfo.outputPath('native-complete-view.png'), fullPage: true })
    await selector.selectOption(detailId)
    await ready('3')
    // Live definition updates can temporarily unmount an empty canvas. The
    // same view identity must restore its camera when its scope returns.
    const beforeEmpty = await stableCamera(page)
    await mcp.call('visualise_view_put', { ...identity(), expectedModelRevision: revision, expectedViewRevision: 1, view: { ...detail, selection: { mode: 'explicit', scope: { componentIds: [], relationshipIds: [] } } } })
    await expect(canvas).toHaveCount(0)
    await mcp.call('visualise_view_put', { ...identity(), expectedModelRevision: revision, expectedViewRevision: 2, view: detail })
    await ready('3')
    expect(await stableCamera(page)).toBe(beforeEmpty)
    await page.reload()
    await ready('3')
    await expect(selector).toHaveValue(detailId)
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', 'node-aa')
    // Retargeting never adds the outside endpoint to a saved explicit view.
    await mutate([{ op: 'relationship.update', relationshipId: 'edge-aa', set: { targetComponentId: 'node-cc' } }])
    await expect(page.getByTestId('view-diagnostics')).toBeVisible()
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)
    await expect(page.locator('.react-flow__node[data-id="node-cc"]')).toHaveCount(0)
    // Arbitrary opaque IDs round-trip through real Nginx, browser navigation,
    // query-based reads and a fresh page load. No slug restriction is invented.
    for (const id of ['space view', '50%', 'Übersicht', 'a|separator', '.', 'a+b?c#d']) {
      await mcp.call('visualise_view_put', { ...identity(), expectedModelRevision: revision, expectedViewRevision: 0, view: view(id, id, { mode: 'all' }) })
      await expect(selector.locator('option').filter({ hasText: id }).first()).toBeAttached()
      await selector.selectOption(id)
      await ready('4')
      await page.reload(); await ready('4'); await expect(selector).toHaveValue(id)
      const response = await request.get(`/api/v1/projects/${project}/view`, { params: { viewId: id } })
      expect(response.ok()).toBe(true); expect((await response.json()).view.viewId).toBe(id)
    }
    await mcp.call('visualise_view_remove', { ...identity(), viewId: detailId, expectedViewRevision: 3 })
    await page.goto(`/projects/${project}/runs/${run}?view=..`)
    await expect(page.getByText(/gespeicherte Ansicht ist nicht verfügbar/)).toBeVisible()
    await expect(canvas).toHaveCount(0)
    await selector.selectOption(''); await ready('4')
    const current = await mcp.call('visualise_model_read', { contractVersion: '2.0.0', projectId: project })
    expect(current.modelRevision).toBe(revision)
    expect((current.items as unknown[]).length).toBe(5)
  } finally { await mcp.close() }
})
