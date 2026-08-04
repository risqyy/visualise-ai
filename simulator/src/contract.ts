/**
 * Validation against the published contract.
 *
 * The simulator is the reference client of `api/openapi.yaml`, so it must not be
 * able to demonstrate anything the contract does not allow. Every envelope is
 * checked here *before* it reaches the network: a violation aborts the run
 * instead of being answered with a `400` the simulator would then have to
 * explain.
 *
 * The approach mirrors `api/scripts/validate-examples.mjs`: parse the contract,
 * register every component schema under its canonical `$ref` and compile it with
 * Ajv 2020 (OpenAPI 3.1 schemas are JSON Schema 2020-12). No bundling step is
 * needed because `api/openapi.yaml` contains no external `$ref`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { parse as parseYaml } from 'yaml'

import type { EventEnvelope } from './types.js'

/** Relative path of the contract inside the repository. */
export const CONTRACT_RELATIVE_PATH = 'api/openapi.yaml'

/**
 * Walks up from this module until it finds the contract. Resolving upwards
 * rather than hard-coding `../../api` keeps the lookup correct no matter whether
 * the simulator runs from `src/`, from a build output or from a test runner's
 * working directory.
 */
export function locateContract(startDir: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir
  for (;;) {
    const candidate = join(dir, CONTRACT_RELATIVE_PATH)
    try {
      readFileSync(candidate, 'utf8')
      return candidate
    } catch {
      const parent = dirname(dir)
      if (parent === dir) {
        throw new Error(
          `could not find ${CONTRACT_RELATIVE_PATH} in any parent directory of ${startDir}`,
        )
      }
      dir = parent
    }
  }
}

export class ContractViolationError extends Error {
  constructor(
    readonly eventType: string,
    readonly clientEventId: string,
    readonly violations: string[],
  ) {
    super(
      `event ${clientEventId} of type ${eventType} violates ${CONTRACT_RELATIVE_PATH}:\n` +
        violations.map((v) => `    ${v}`).join('\n'),
    )
    this.name = 'ContractViolationError'
  }
}

export interface Contract {
  /** `info.version` of the contract the simulator validated against. */
  readonly documentVersion: string
  /** The closed v0 event catalogue, in the order the contract lists it. */
  readonly eventTypes: readonly string[]
  /** Absolute path of the contract document that was loaded. */
  readonly path: string
  /** Throws {@link ContractViolationError} when the envelope is not ingestible. */
  assertIngestible(event: EventEnvelope): void
  /** Validates a response body against a named component schema. */
  validateResponse(schemaName: string, body: unknown): string[]
}

interface OpenApiDocument {
  info?: { version?: string }
  components?: { schemas?: Record<string, Record<string, unknown>> }
}

/** Loads and compiles `api/openapi.yaml`. */
export function loadContract(contractPath: string = locateContract()): Contract {
  const spec = parseYaml(readFileSync(contractPath, 'utf8')) as OpenApiDocument
  const schemas = spec.components?.schemas
  if (!schemas) {
    throw new Error(`no component schemas found in ${contractPath}`)
  }

  const ajv = new Ajv2020({ strict: false, allErrors: true })
  // Format assertions are advisory in JSON Schema 2020-12. ADR 0004 records that
  // leaving them off silently accepted `"clientEventId": "not-a-uuid"` in the
  // backend; the simulator turns them on for the same reason.
  addFormats(ajv)
  for (const [name, schema] of Object.entries(schemas)) {
    ajv.addSchema(schema, `#/components/schemas/${name}`)
  }

  const compile = (name: string): ValidateFunction => {
    const validate = ajv.getSchema(`#/components/schemas/${name}`)
    if (!validate) {
      throw new Error(`schema ${name} does not exist in ${contractPath}`)
    }
    return validate
  }

  const ingest = schemas.IngestEventRequest
  const mapping = (ingest?.discriminator as { mapping?: Record<string, string> } | undefined)
    ?.mapping
  if (!mapping) {
    throw new Error(`IngestEventRequest in ${contractPath} has no discriminator mapping`)
  }

  const validateUnion = compile('IngestEventRequest')
  const branchCache = new Map<string, ValidateFunction>()

  const eventTypes = (schemas.EventType?.enum as string[] | undefined) ?? []
  if (eventTypes.length === 0) {
    throw new Error(`EventType in ${contractPath} has no enumeration`)
  }

  const describe = (validate: ValidateFunction): string[] =>
    (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`)

  return {
    documentVersion: spec.info?.version ?? 'unknown',
    eventTypes,
    path: contractPath,

    assertIngestible(event: EventEnvelope): void {
      // Validating straight against the 20-branch `oneOf` reports the failures
      // of the 19 branches the event never meant — ADR 0004 measured ~80 errors
      // for a single bad field. The contract's own discriminator mapping selects
      // the branch first, so the message names the real problem; the union is
      // still the authoritative gate afterwards.
      const ref = mapping[event.type]
      if (ref) {
        let branch = branchCache.get(ref)
        if (!branch) {
          const compiled = ajv.getSchema(ref)
          if (!compiled) {
            throw new Error(`discriminator maps ${event.type} to ${ref}, which does not exist`)
          }
          branch = compiled
          branchCache.set(ref, branch)
        }
        // Ajv types its validators as type guards over `unknown`, which would
        // narrow `event` to `never` in the failure branch. The explicit boolean
        // keeps the envelope typed while the check stays the same.
        const branchOk: boolean = branch(event)
        if (!branchOk) {
          throw new ContractViolationError(event.type, event.clientEventId, describe(branch))
        }
      }

      const unionOk: boolean = validateUnion(event)
      if (!unionOk) {
        throw new ContractViolationError(event.type, event.clientEventId, [
          `type ${event.type} matches no branch of IngestEventRequest`,
          ...describe(validateUnion),
        ])
      }
    },

    validateResponse(schemaName: string, body: unknown): string[] {
      const validate = compile(schemaName)
      return validate(body) ? [] : describe(validate)
    },
  }
}
