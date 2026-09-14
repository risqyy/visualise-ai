/** Validate the prospective contract, not an implementation of its state machine. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { parse } from 'yaml'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const schema = parse(await read('model-view-mcp.schema.yaml'))
const catalogue = parse(await read('model-view-mcp.tools.yaml'))
const legacy = parse(await read('openapi.yaml'))
const fixtures = JSON.parse(await read('examples/model-view-mcp/cases.json'))
const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)
ajv.addSchema(legacy, 'urn:visualise-ai:rest:1.1.0')
ajv.addSchema(schema)
assert.equal(catalogue.schema, schema.$id)
assert.equal(catalogue.contractVersion, schema.$defs.Version.const)

function validate(ref, value, expected = true) {
  const check = ajv.getSchema(`${schema.$id}${ref}`)
  assert.ok(check, `unresolvable schema ${ref}`)
  const valid = check(value)
  assert.equal(valid, expected, `${ref}: ${JSON.stringify(check.errors)}`)
}

const names = new Set()
for (const tool of catalogue.tools) {
  assert.match(tool.name, /^visualise_[a-z_]+$/)
  assert.ok(!names.has(tool.name), `duplicate tool ${tool.name}`)
  names.add(tool.name)
  assert.deepEqual(Object.keys(tool).sort(),
    (tool.eventType ? ['name', 'inputSchema', 'outputSchema', 'eventType'] :
      ['name', 'inputSchema', 'outputSchema']).sort())
  const cases = fixtures.tools.filter((example) => example.tool === tool.name)
  assert.ok(cases.length, `missing request/result fixture for ${tool.name}`)
  for (const example of cases) {
    validate(tool.inputSchema, example.input)
    validate(tool.outputSchema, example.result)
    if (tool.eventType) {
      // The public command and its future REST event must share the exact fields.
      const { contractVersion, projectId, runId, agentId, parentAgentId,
        clientEventId, occurredAt, ...payload } = example.input
      assert.equal(contractVersion, catalogue.contractVersion)
      const wire = { schemaVersion: '2.0', projectId, runId, agentId,
        parentAgentId, clientEventId, occurredAt, type: tool.eventType, payload }
      validate('#/$defs/CommandEvent', wire)
    }
  }
  console.log(`✓ ${tool.name}: request, result${tool.eventType ? ' and REST event' : ''}`)
}
assert.ok(fixtures.tools.every((example) => names.has(example.tool)), 'unknown fixture tool')
const discovery = fixtures.tools.find((example) => example.tool === 'visualise_discover')
assert.deepEqual([...discovery.result.tools].sort(), [...names].sort())

const operationNames = new Set(schema.$defs.Operation.oneOf.map((s) => s.properties.op.const))
for (const example of fixtures.operations) {
  validate('#/$defs/Operation', example)
  operationNames.delete(example.op)
}
assert.equal(operationNames.size, 0, 'every mutation operation needs a fixture')
const actions = new Set(schema.$defs.WorkReport.oneOf.map((s) => s.properties.action.const))
for (const example of fixtures.reports) {
  validate('#/$defs/WorkReport', example)
  actions.delete(example.action)
}
assert.equal(actions.size, 0, 'every explicit report action needs a fixture')

for (const example of fixtures.invalid) {
  assert.ok(example.reason, 'rejection must explain its purpose')
  validate(example.schema, example.value, false)
  console.log(`✓ rejected: ${example.reason}`)
}
const mutation = fixtures.tools.find((example) => example.tool === 'visualise_model_mutate').input
validate('#/$defs/ModelMutateInput', { ...mutation, operations: Array(101).fill(mutation.operations[0]) }, false)
console.log('✓ rejected: mutation batch above 100 operations')
for (const example of fixtures.errors) validate(catalogue.errorSchema, example)
assert.ok(fixtures.invalid.length >= 10, 'retain boundary/closed-contract fixtures')
assert.ok(fixtures.errors.some((e) => e.code === 'revision_conflict'))
assert.ok(fixtures.errors.some((e) => e.code === 'client_event_id_conflict'))
console.log(`Validated ${fixtures.tools.length} tool pairs, ${fixtures.operations.length} operations, ` +
  `${fixtures.reports.length} work actions, ${fixtures.invalid.length} rejections and ${fixtures.errors.length} errors.`)
console.log('Schema checks only: atomicity, lifecycle, reference integrity, rendering and migration require #77–#83 runtime tests.')
