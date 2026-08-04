/**
 * Generates `src/api/generated/contract.ts` from `api/openapi.yaml`.
 *
 *   node scripts/generate-contract.mjs           # (re)write the file
 *   node scripts/generate-contract.mjs --check   # fail when it is stale
 *
 * The generated module is committed. The frontend image builds from the
 * `frontend/` directory alone (`docker-compose.yml` sets that build context),
 * so `../api` does not exist inside the Docker build — the same reason the
 * backend commits its contract copy, see
 * `docs/decisions/0004-contract-driven-ingestion-validation.md`.
 *
 * A committed generated artefact is only safe while something proves it still
 * matches the authority. That is `--check`, which `src/api/generated/contract.drift.test.ts`
 * runs as part of the normal test suite.
 */
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import openapiTS, { astToString } from 'openapi-typescript'

const SPEC_URL = new URL('../../api/openapi.yaml', import.meta.url)
const OUTPUT_URL = new URL('../src/api/generated/contract.ts', import.meta.url)

/** Marks the file as generated and pins the exact authority it came from. */
function header(specHash) {
  return `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced from \`api/openapi.yaml\` by \`npm run generate:contract\`
 * (openapi-typescript). Edit the contract, then regenerate.
 *
 * authority: api/openapi.yaml
 * sha256:    ${specHash}
 *
 * \`npm run check:contract\` — also run by the Vitest suite — fails when this
 * file no longer matches the authority above.
 */
`
}

/** sha256 of the authority document, over its raw bytes. */
export async function specSha256() {
  return createHash('sha256').update(await readFile(SPEC_URL)).digest('hex')
}

/** The exact content `src/api/generated/contract.ts` must have. */
export async function buildContractModule() {
  const ast = await openapiTS(SPEC_URL, {
    // `type: object` without properties is a free-form object in the contract
    // (`ActiveChange.snapshot`, every event `payload`). The default
    // `Record<string, never>` would claim the opposite — that it can never
    // carry a property — and make every narrowing of it `never`.
    emptyObjectsUnknown: true,
  })
  return `${header(await specSha256())}${astToString(ast)}`
}

const expected = await buildContractModule()
const check = process.argv.includes('--check')

if (check) {
  let actual = null
  try {
    actual = await readFile(OUTPUT_URL, 'utf8')
  } catch {
    // stays null — reported below
  }

  if (actual === expected) {
    console.log(`✓ ${fileURLToPath(OUTPUT_URL)} matches api/openapi.yaml`)
    process.exit(0)
  }

  console.error(
    `✗ src/api/generated/contract.ts does not match api/openapi.yaml.\n` +
      `  The contract is the authority. Run:\n\n` +
      `      npm run generate:contract\n\n` +
      `  and commit the regenerated file.`,
  )
  process.exit(1)
}

await mkdir(new URL('.', OUTPUT_URL), { recursive: true })
await writeFile(OUTPUT_URL, expected, 'utf8')
console.log(`✓ wrote ${fileURLToPath(OUTPUT_URL)}`)
