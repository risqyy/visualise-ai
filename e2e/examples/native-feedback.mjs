// Run from the checkout: MCP_URL=http://localhost:8080/mcp node e2e/examples/native-feedback.mjs
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const endpoint = new URL(process.env.MCP_URL ?? 'http://localhost:8080/mcp')
const projectId = `sdk-example-${randomUUID().slice(0, 8)}`
const runId = 'example-run', agentId = 'example-root', viewId = 'example/view'
const output = process.env.MCP_OUTPUT_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../test-results/client-example', projectId)
const client = new Client({ name: 'visualise-native-feedback-example', version: '1.0.0' })
const read = { contractVersion: '2.0.0', projectId }
const identity = () => ({ ...read, runId, agentId, parentAgentId: null, clientEventId: randomUUID(), occurredAt: new Date().toISOString() })

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent)}`)
  assert(result.structuredContent, 'expected structured result')
  return result.structuredContent
}
async function capture(filename) {
  const model = await call('visualise_model_read', read)
  const view = await call('visualise_view_get', { ...read, viewId })
  // Concurrent writers can invalidate either revision. Read/reconcile then
  // request again; never silently substitute latest after a conflict.
  const result = await client.callTool({ name: 'visualise_view_render', arguments: {
    ...read, viewId, expectedModelRevision: model.modelRevision, expectedViewRevision: view.viewRevision,
    viewport: { width: 800, height: 600, pixelRatio: 1 }, detailLevel: 'standard',
  } })
  if (result.isError) throw new Error(JSON.stringify(result.structuredContent))
  const images = result.content.filter((item) => item.type === 'image')
  assert.equal(images.length, 1)
  assert.equal(images[0].mimeType, 'image/png')
  const png = Buffer.from(images[0].data, 'base64')
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  assert.equal(png.readUInt32BE(16), 800)
  assert.equal(png.readUInt32BE(20), 600)
  assert(png.length <= 4 * 1024 * 1024)
  const metadata = result.structuredContent
  assert.equal(metadata.modelRevision, model.modelRevision)
  assert.equal(metadata.viewRevision, view.viewRevision)
  assert.equal(metadata.byteLength, png.length)
  await writeFile(join(output, filename), png)
  await writeFile(join(output, `${filename}.json`), JSON.stringify(metadata, null, 2))
  return { png, metadata }
}

try {
  await client.connect(new StreamableHTTPClientTransport(endpoint))
  const catalogue = await client.listTools()
  assert(catalogue.tools.some((tool) => tool.name === 'visualise_view_render'), 'configure the renderer or use source-built Compose')
  await call('visualise_context_open', { ...identity(), role: 'orchestrator', displayName: 'SDK example', assignedTask: 'Inspect and correct the architecture model' })
  const created = await call('visualise_model_mutate', { ...identity(), expectedModelRevision: 0, operations: [
    { op: 'component.add', component: { componentId: 'gateway-api', name: 'Reported gateway label needing correction', kind: 'service', parentComponentId: null } },
    { op: 'component.add', component: { componentId: 'worker', name: 'Worker', kind: 'service', parentComponentId: null } },
    { op: 'relationship.add', relationship: { relationshipId: 'gateway-worker', sourceComponentId: 'gateway-api', targetComponentId: 'worker', kind: 'dependency' } },
  ] })
  await call('visualise_view_put', { ...identity(), expectedModelRevision: created.modelRevision, expectedViewRevision: 0,
    view: { viewId, name: 'Native review', kind: 'architecture', selection: { mode: 'all' }, orientation: 'top-down', collapsedComponentIds: [] } })
  await mkdir(output, { recursive: true })
  const before = await capture('before.png')
  // This explicit model-label correction is not a repository-code change or
  // an automated quality judgment. A real agent chooses it after inspecting PNG.
  const correction = { ...identity(), expectedModelRevision: before.metadata.modelRevision,
    operations: [{ op: 'component.update', componentId: 'gateway-api', set: { name: 'Gateway' } }] }
  // Keep this complete input/key for a retry if the reply is lost.
  const corrected = await call('visualise_model_mutate', correction)
  const after = await capture('after.png')
  assert.equal(after.metadata.modelRevision, corrected.modelRevision)
  assert(!before.png.equals(after.png), 'the targeted label correction must change the native image')
  await call('visualise_work_report', { ...identity(), report: { action: 'run_finish', outcome: 'completed', summary: 'Example model-label correction complete; no code change asserted' } })
  process.stdout.write(`${JSON.stringify({ projectId, runId, viewId, endpoint: endpoint.href, output, before: before.metadata, after: after.metadata })}\n`)
} finally {
  await client.close()
}
