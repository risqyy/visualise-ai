/**
 * The shapes the simulator works with.
 *
 * These are deliberately loose about the payload: `api/openapi.yaml` is the
 * authority on what a payload may contain, and every envelope is validated
 * against it before it is sent (see `contract.ts`). Restating the 20 payload
 * schemas in TypeScript would create a second, silently drifting contract —
 * exactly what ADR 0004 rejects for the backend.
 */

export type EventPayload = Record<string, unknown>

/** One event envelope as `POST /api/v1/events` accepts it. */
export interface EventEnvelope {
  schemaVersion: '1.0'
  clientEventId: string
  projectId: string
  runId: string
  agentId: string
  parentAgentId: string | null
  occurredAt: string
  type: string
  payload: EventPayload
}

/**
 * One entry of a scenario: the envelope plus how the runner should narrate and
 * pace it.
 */
export interface ScenarioStep {
  /** Human-readable phase this step belongs to, printed as a section heading. */
  phase: string
  /** Base pause in milliseconds *before* this step, scaled by `--speed`. */
  pauseMs: number
  /** The envelope to send. */
  event: EventEnvelope
  /**
   * What the runner expects back. `201` for a first delivery, `200` for a
   * byte-identical retry, `409` for a deliberate conflict. Anything else aborts
   * the run.
   */
  expect: ExpectedResponse
}

export interface ExpectedResponse {
  status: number
  /** Expected `duplicate` flag of an `EventAccepted` body, when the step asserts one. */
  duplicate?: boolean
  /** Expected RFC 9457 `code` of a problem body, when the step expects a failure. */
  code?: string
  /**
   * Name of an earlier step whose assigned position this step must repeat.
   * Used by the retry scenario to prove the position is not re-allocated.
   */
  samePositionAs?: string
}

/** A complete, ordered scenario. */
export interface Scenario {
  name: ScenarioName
  projectId: string
  runId: string
  steps: ScenarioStep[]
}

export const SCENARIO_NAMES = ['full', 'retry', 'conflict'] as const
export type ScenarioName = (typeof SCENARIO_NAMES)[number]

/** `EventAccepted` from the contract. */
export interface EventAccepted {
  projectId: string
  position: number
  serverEventId: string
  clientEventId: string
  duplicate: boolean
  receivedAt: string
}

/** RFC 9457 problem document as the backend returns it. */
export interface ProblemDocument {
  type?: string
  title?: string
  status?: number
  detail?: string
  code?: string
  instance?: string
  errors?: { field?: string; code?: string; message?: string }[]
}
