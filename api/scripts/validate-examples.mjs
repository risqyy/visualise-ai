/**
 * Validates every example document against the schema it claims to illustrate.
 *
 * OpenAPI `externalValue` examples are not checked by `redocly lint`, but the
 * examples are the reference the simulator, the backend tests and the docs are
 * written against. Drift between them and the contract has to fail the build.
 *
 * OpenAPI 3.1 schemas are JSON Schema 2020-12, so they are used unmodified.
 */
import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { parse as parseYaml } from 'yaml'

const apiDir = fileURLToPath(new URL('..', import.meta.url))
const examplesDir = join(apiDir, 'examples')
const bundlePath = join(apiDir, 'dist', 'openapi.bundled.yaml')

/** Example file -> the component schema it must satisfy. */
const EXPECTED_SCHEMA = {
  'root-agent-started.json': 'IngestEventRequest',
  'subagent-started.json': 'IngestEventRequest',
  'architecture-snapshot.json': 'IngestEventRequest',
  'component-change-planned.json': 'IngestEventRequest',
  'component-change-applied.json': 'IngestEventRequest',
  'feedback-published.json': 'IngestEventRequest',
  'diff-reported.json': 'IngestEventRequest',
  'correction-issued.json': 'IngestEventRequest',
  'run-finished.json': 'IngestEventRequest',
  'retry-idempotent-response.json': 'EventAccepted',
  'conflict-response.json': 'Problem',
  'validation-error-response.json': 'ValidationProblem',
}

const spec = parseYaml(await readFile(bundlePath, 'utf8'))
const schemas = spec.components?.schemas
if (!schemas) {
  throw new Error(`no component schemas found in ${bundlePath}`)
}

const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)

// Register every component schema under its canonical $ref so internal
// references inside the bundle resolve.
for (const [name, schema] of Object.entries(schemas)) {
  ajv.addSchema(schema, `#/components/schemas/${name}`)
}

const files = (await readdir(examplesDir)).filter((f) => f.endsWith('.json')).sort()
const unmapped = files.filter((f) => !(f in EXPECTED_SCHEMA))
if (unmapped.length > 0) {
  console.error(`✗ example(s) without an expected schema: ${unmapped.join(', ')}`)
  console.error('  Add them to EXPECTED_SCHEMA so they stay covered.')
  process.exit(1)
}

let failed = 0
for (const file of files) {
  const schemaName = EXPECTED_SCHEMA[file]
  const validate = ajv.getSchema(`#/components/schemas/${schemaName}`)
  if (!validate) {
    console.error(`✗ ${file}: schema ${schemaName} does not exist in the contract`)
    failed += 1
    continue
  }

  const document = JSON.parse(await readFile(join(examplesDir, file), 'utf8'))
  if (validate(document)) {
    console.log(`✓ ${basename(file)} -> ${schemaName}`)
    continue
  }

  failed += 1
  console.error(`✗ ${basename(file)} -> ${schemaName}`)
  for (const error of validate.errors ?? []) {
    console.error(`    ${error.instancePath || '/'} ${error.message}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} example(s) do not match the contract.`)
  process.exit(1)
}
console.log(`\nAll ${files.length} examples match the contract.`)

// ---------------------------------------------------------------------------
// Negative fixtures: the catalogue is closed, so these must all be rejected.
// ---------------------------------------------------------------------------

const invalidDir = join(apiDir, 'fixtures', 'invalid')
const validateIngest = ajv.getSchema('#/components/schemas/IngestEventRequest')
const invalidFiles = (await readdir(invalidDir)).filter((f) => f.endsWith('.json')).sort()

console.log('\nRejection fixtures:')
let wronglyAccepted = 0
for (const file of invalidFiles) {
  const document = JSON.parse(await readFile(join(invalidDir, file), 'utf8'))
  // `_reason` documents the fixture; it is not part of the payload under test.
  const reason = document._reason ?? '(no reason recorded)'
  delete document._reason

  if (validateIngest(document)) {
    console.error(`✗ ${basename(file)} was ACCEPTED but must be rejected — ${reason}`)
    wronglyAccepted += 1
    continue
  }
  console.log(`✓ ${basename(file)} rejected — ${reason}`)
}

if (wronglyAccepted > 0) {
  console.error(`\n${wronglyAccepted} fixture(s) slipped through the contract.`)
  process.exit(1)
}
console.log(`\nAll ${invalidFiles.length} rejection fixtures were refused by the contract.`)
