import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The drift guard for the committed contract types.
 *
 * `src/api/generated/contract.ts` is a generated artefact under version
 * control. That is only defensible while something proves it still describes
 * `api/openapi.yaml` — the same arrangement, and the same argument, as
 * `TestEmbeddedContractMatchesTheAuthority` in the backend
 * (`backend/internal/ingest/contract_test.go`).
 *
 * The check runs the generator itself and compares byte for byte, so it fails
 * for either cause of drift:
 *
 * * the contract changed and nobody regenerated, and
 * * the generated file was edited by hand.
 *
 * The second assertion pins the same fact from the other side: the sha256 in
 * the file's header must be the sha256 of the contract as it is on disk now.
 *
 * Vitest runs with the frontend package as its working directory, so the paths
 * below are resolved from there rather than from `import.meta.url`, which is a
 * transformed module URL inside the jsdom environment.
 */

const FRONTEND_ROOT = process.cwd()
const SPEC = resolve(FRONTEND_ROOT, '../api/openapi.yaml')
const GENERATED = resolve(FRONTEND_ROOT, 'src/api/generated/contract.ts')

/** Generation walks the whole contract; give it room on a cold cache. */
const GENERATE_TIMEOUT = 60_000

describe('generated contract types', () => {
  it(
    'are up to date with api/openapi.yaml',
    () => {
      expect(() =>
        execFileSync(process.execPath, ['scripts/generate-contract.mjs', '--check'], {
          cwd: FRONTEND_ROOT,
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      ).not.toThrow()
    },
    GENERATE_TIMEOUT,
  )

  it('record the sha256 of the contract they were generated from', () => {
    const specHash = createHash('sha256').update(readFileSync(SPEC)).digest('hex')
    const header = readFileSync(GENERATED, 'utf8').slice(0, 600)

    expect(header).toContain('GENERATED FILE — DO NOT EDIT.')
    expect(header).toContain(`sha256:    ${specHash}`)
  })
})
