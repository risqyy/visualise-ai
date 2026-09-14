import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { connectMcp, writeIdentity } from '../src/mcp.js'
import { streamUrl } from '../src/api.js'
import { SseRecorder } from '../src/sse.js'
import { runCommandOrThrow } from '../src/process.js'
import { BASE_URL, REPO_ROOT } from '../src/config.js'
import { attachMeasurements } from '../src/measurements.js'

test('17 · committed response loss, concurrent CAS and rollback use real SDK sessions and one published event log', async ({ page, browser }, testInfo) => {
  const reader = await connectMcp()
  const competitor = await connectMcp()
  const project = `mcp-recovery-${randomUUID().slice(0, 8)}`
  const run = 'recovery-run', root = 'recovery-root'
  const identity = (agent = root) => writeIdentity(project, run, agent, agent === root ? null : root)
  const read = { contractVersion: '2.0.0', projectId: project }
  const samples: number[] = []
  let recorder: SseRecorder | undefined
  let faulty: Awaited<ReturnType<typeof connectMcp>> | undefined
  let retryClient: Awaited<ReturnType<typeof connectMcp>> | undefined
  try {
    const documents = JSON.parse(await readFile(join(REPO_ROOT, 'backend/internal/mcptools/schemas.json'), 'utf8')) as Record<string, { input?: unknown; eventType?: string }>
    const schemas = Object.fromEntries(Object.entries(documents).filter(([, document]) => document.input !== undefined))
    expect(reader.catalogue.tools.map((tool) => tool.name).sort()).toEqual(Object.keys(schemas).sort())
    expect(reader.catalogue.tools).toHaveLength(14)
    expect((await reader.call('visualise_discover', {})).tools).toEqual(expect.arrayContaining(Object.keys(schemas)))
    await reader.call('visualise_context_open', { ...identity(), role: 'orchestrator', displayName: root, assignedTask: 'Verify model command recovery' })
    recorder = new SseRecorder(streamUrl(project, 0))
    expect(await recorder.open()).toBe(200)
    await recorder.waitForPosition(1)
    const create = await reader.call('visualise_model_mutate', { ...identity(), expectedModelRevision: 0, operations: [
      { op: 'component.add', component: { componentId: 'shared-api', name: 'Shared API', kind: 'service', parentComponentId: null } },
      { op: 'component.add', component: { componentId: 'shared-db', name: 'Shared DB', kind: 'datastore', parentComponentId: null } },
      { op: 'relationship.add', relationship: { relationshipId: 'shared-edge', sourceComponentId: 'shared-api', targetComponentId: 'shared-db', kind: 'data' } },
    ] })
    await page.goto(`/projects/${project}/runs/${run}?component=shared-api`)
    const canvas = page.getByTestId('architecture-canvas')
    const api = page.locator('.react-flow__node[data-id="shared-api"]')
    await expect(canvas).toHaveAttribute('data-node-count', '2')
    await expect(canvas).toHaveAttribute('data-layouting', 'false')
    await expect(page.getByTestId('live-connection-state')).toHaveAttribute('data-state', 'live')

    // Fault injection occurs only AFTER the real server response has arrived.
    // The bytes are consumed and discarded, never handed to the calling SDK.
    const lost = { ...identity(), expectedModelRevision: 1, operations: [{ op: 'component.update', componentId: 'shared-api', set: { name: 'Committed without reply' } }] }
    let discardedBytes = 0, drops = 0
    faulty = await connectMcp({ fetch: async (url, init) => {
      const response = await fetch(url, init)
      if (typeof init?.body === 'string' && init.body.includes(lost.clientEventId)) {
        expect(response.ok).toBe(true)
        discardedBytes = (await response.arrayBuffer()).byteLength
        drops++
        throw new TypeError('Acceptance injected lost committed response')
      }
      return response
    } })
    const start = performance.now()
    await expect(faulty.call('visualise_model_mutate', lost)).rejects.toThrow(/lost committed response/)
    expect(drops).toBe(1)
    expect(discardedBytes).toBeGreaterThan(0)
    const independentlyRead = await reader.call('visualise_model_read', read)
    expect(independentlyRead).toMatchObject({ modelRevision: 2, projectPosition: Number(create.projectPosition) + 1 })
    await expect(api).toHaveAttribute('aria-label', /Committed without reply/)
    samples.push(performance.now() - start)
    await faulty.close()
    faulty = undefined
    await recorder.waitForPosition(Number(independentlyRead.projectPosition))
    const original = recorder.frames.find((frame) => frame.position === independentlyRead.projectPosition)!.event
    expect(original).toMatchObject({ clientEventId: lost.clientEventId, projectId: project, runId: run, agentId: root })
    retryClient = await connectMcp()
    const recovered = await retryClient.call('visualise_model_mutate', lost)
    expect(recovered).toMatchObject({ duplicate: true, clientEventId: lost.clientEventId, modelRevision: 2, projectPosition: independentlyRead.projectPosition })
    expect(recovered).toMatchObject({ serverEventId: original.serverEventId, receivedAt: original.receivedAt, projectId: original.projectId, runId: original.runId, agentId: original.agentId, viewRevision: null, affected: { componentIds: ['shared-api'], relationshipIds: [] } })
    const recoveredAgain = await reader.call('visualise_model_mutate', lost)
    expect(recoveredAgain).toEqual(recovered)
    expect(await reader.call('visualise_model_read', read)).toEqual(independentlyRead)

    // Two independent initialized clients read the same head before racing.
    const [headA, headB] = await Promise.all([reader.call('visualise_model_read', read), competitor.call('visualise_model_read', read)])
    expect(headA.modelRevision).toBe(headB.modelRevision)
    const inputs = ['CAS winner A', 'CAS winner B'].map((name) => ({ ...identity(), expectedModelRevision: headA.modelRevision, operations: [{ op: 'component.update', componentId: 'shared-api', set: { name } }] }))
    const casStart = performance.now()
    const results = await Promise.all([reader.client.callTool({ name: 'visualise_model_mutate', arguments: inputs[0]! }), competitor.client.callTool({ name: 'visualise_model_mutate', arguments: inputs[1]! })])
    expect(results.filter((result) => !result.isError)).toHaveLength(1)
    expect(results.filter((result) => result.isError)).toHaveLength(1)
    const winner = results.findIndex((result) => !result.isError)
    expect(results[1 - winner]!.structuredContent).toMatchObject({ code: 'revision_conflict', currentModelRevision: 3 })
    await expect(api).toHaveAttribute('aria-label', new RegExp(`CAS winner ${winner === 0 ? 'A' : 'B'}`))
    await expect(page.getByTestId('inspector-context')).toContainText(`CAS winner ${winner === 0 ? 'A' : 'B'}`)
    samples.push(performance.now() - casStart)
    const head = await competitor.call('visualise_model_read', read)
    const reconcileStart = performance.now()
    const reconciled = await competitor.call('visualise_model_mutate', { ...identity(), expectedModelRevision: head.modelRevision, operations: [{ op: 'component.update', componentId: 'shared-api', set: { name: 'Reconciled shared API' } }] })
    await expect(api).toHaveAttribute('aria-label', /Reconciled shared API/)
    samples.push(performance.now() - reconcileStart)

    // Rejected node+invalid-edge batch must leave head, graph, publication and
    // every observed DOM state unchanged. A later accepted event is a barrier.
    await page.evaluate(() => {
      const state = { leaked: false, observations: 0 }
      ;(window as unknown as { rollbackProbe: typeof state }).rollbackProbe = state
      new MutationObserver(() => { state.observations++; state.leaked ||= document.querySelector('.react-flow__node[data-id="rollback-node"]') !== null }).observe(document.body, { childList: true, subtree: true })
    })
    const beforeBad = await reader.call('visualise_model_read', read)
    const invalid = await reader.client.callTool({ name: 'visualise_model_mutate', arguments: { ...identity(), expectedModelRevision: beforeBad.modelRevision, operations: [
      { op: 'component.add', component: { componentId: 'rollback-node', name: 'Must never appear', kind: 'service', parentComponentId: null } },
      { op: 'relationship.add', relationship: { relationshipId: 'rollback-edge', sourceComponentId: 'rollback-node', targetComponentId: 'absent-target', kind: 'dependency' } },
    ] } })
    expect(invalid.isError).toBe(true)
    expect(invalid.structuredContent).toMatchObject({ code: 'reference_invalid' })
    expect(await reader.call('visualise_model_read', read)).toEqual(beforeBad)
    const barrier = await reader.call('visualise_work_report', { ...identity(), report: { action: 'status', status: 'working', note: 'Rollback verified' } })
    expect(barrier.projectPosition).toBe(Number(reconciled.projectPosition) + 1)
    expect(barrier.modelRevision).toBe(reconciled.modelRevision)
    await recorder.waitForPosition(Number(barrier.projectPosition))
    expect(recorder.positions.filter((position) => position === Number(recovered.projectPosition))).toHaveLength(1)
    expect(recorder.frames.filter((frame) => frame.type === 'model.mutation_applied')).toHaveLength(4)
    await expect(page.getByTestId('agent-status-note-recovery-root')).toContainText('Rollback verified')
    const probe = await page.evaluate(() => (window as unknown as { rollbackProbe: { leaked: boolean; observations: number } }).rollbackProbe)
    expect(probe.observations).toBeGreaterThan(0)
    expect(probe.leaked).toBe(false)

    // Root and TWO explicitly registered workers share scope without locks or
    // implicit model/code progress. Each completes its own reported step.
    for (const agent of ['worker-one', 'worker-two']) await reader.call('visualise_context_open', { ...identity(agent), role: 'subagent', displayName: agent, assignedTask: 'Review shared model' })
    for (const agent of [root, 'worker-one', 'worker-two']) {
      await reader.call('visualise_work_scope_set', { ...identity(agent), scope: { componentIds: ['shared-api'], relationshipIds: ['shared-edge'] } })
      await reader.call('visualise_work_report', { ...identity(agent), report: { action: 'step_start', workStepId: `${agent}-step`, title: 'Review model', componentIds: ['shared-api'] } })
      await reader.call('visualise_work_report', { ...identity(agent), report: { action: 'status', status: 'working', note: 'Explicit report' } })
      await reader.call('visualise_work_report', { ...identity(agent), report: { action: 'progress', percent: 50, scope: 'own_task', basis: 'reported_estimate' } })
    }
    await expect(page.getByTestId('overlay-mark-component-shared-api')).toHaveAttribute('data-agent-count', '3')
    for (const agent of [root, 'worker-one', 'worker-two']) await expect(page.getByTestId('element-contributions')).toContainText(agent)
    const context = await reader.call('visualise_context_read', { ...read, runId: run })
    expect(context.isOpen).toBe(true)
    expect(context.items).toHaveLength(3)
    for (const item of context.items as { agent: Record<string, unknown>; scope: unknown }[]) {
      expect(item.scope).toEqual({ componentIds: ['shared-api'], relationshipIds: ['shared-edge'] })
      expect(item.agent).toMatchObject({ status: 'working', progress: { percent: 50, scope: 'own_task', basis: 'reported_estimate' } })
    }
    await page.screenshot({ path: testInfo.outputPath('mcp-three-explicit-contributors.png'), fullPage: true })
    const saved = await reader.call('visualise_view_put', { ...identity(), expectedModelRevision: 4, expectedViewRevision: 0, view: { viewId: 'temporary/view', name: 'Temporary shared view', kind: 'architecture', selection: { mode: 'all' }, orientation: 'top-down', collapsedComponentIds: [] } })
    await reader.call('visualise_view_remove', { ...identity(), expectedViewRevision: saved.viewRevision, viewId: 'temporary/view' })
    for (const agent of [root, 'worker-one', 'worker-two']) {
      await reader.call('visualise_work_report', { ...identity(agent), report: { action: 'step_complete', workStepId: `${agent}-step`, summary: 'Model inspected, no code change asserted' } })
      await reader.call('visualise_work_report', { ...identity(agent), report: { action: 'agent_finish', outcome: 'completed', summary: 'Review complete' } })
    }
    const closed = await reader.call('visualise_work_report', { ...identity(), report: { action: 'run_finish', outcome: 'completed', summary: 'Acceptance complete' } })
    expect((await reader.call('visualise_context_read', { ...read, runId: run })).isOpen).toBe(false)
    const rejectedAfterClosure = await competitor.client.callTool({ name: 'visualise_model_mutate', arguments: { ...lost, ...identity(), expectedModelRevision: 4 } })
    expect(rejectedAfterClosure.isError).toBe(true)
    expect(rejectedAfterClosure.structuredContent).toMatchObject({ code: 'run_already_finished' })
    expect(await retryClient.call('visualise_model_mutate', lost)).toEqual(recovered)
    await recorder.waitForPosition(Number(closed.projectPosition))
    await recorder.abort()
    expect(recorder.positions).toEqual(Array.from({ length: Number(closed.projectPosition) }, (_, i) => i + 1))
    const requiredTypes = [...new Set(Object.values(schemas).map((schema) => schema.eventType).filter(Boolean))].sort()
    expect([...new Set(recorder.frames.map((frame) => frame.type))].sort()).toEqual(requiredTypes)
    await testInfo.attach('command-recovery-evidence', { contentType: 'application/json', body: JSON.stringify({ drops, discardedBytes, recovered, casResults: results.map((result) => result.structuredContent), finalPosition: closed.projectPosition, eventTypes: requiredTypes }, null, 2) })
    await attachMeasurements(testInfo, browser, 'mutation-to-observed-canvas', samples, { measurement: 'SDK mutation dispatch to observed native aria-label, includes network and polling', sampleLabels: ['lost-response path including independent read', 'two-client CAS race', 'reconciled mutation'], summaryMeaning: 'Three distinct local scenarios, not repeated identical writes or an SLA', model: { components: 2, relationships: 1 }, viewport: { width: 1920, height: 1080 }, detailLevel: 'native automatic readable camera' })
  } finally {
    await recorder?.abort()
    await faulty?.close()
    await retryClient?.close()
    await competitor.close()
    await reader.close()
  }
})


test('documented official SDK example produces before/after native PNGs', async ({}, testInfo) => {
  const result = await runCommandOrThrow(process.execPath, ['e2e/examples/native-feedback.mjs'], {
    cwd: REPO_ROOT, env: { ...process.env, MCP_URL: `${BASE_URL}/mcp`, MCP_OUTPUT_DIR: testInfo.outputPath('client-example') },
  })
  const evidence = JSON.parse(result.stdout)
  expect(evidence.before.modelRevision).toBe(1)
  expect(evidence.after.modelRevision).toBe(2)
  expect(evidence.before.viewRevision).toBe(evidence.after.viewRevision)
  await testInfo.attach('documented-client-result', { body: result.stdout, contentType: 'application/json' })
})
