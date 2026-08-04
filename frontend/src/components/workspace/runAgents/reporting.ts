import type {
  AgentProgress,
  Outcome,
  PlanStepState,
  RunAgent,
  RunPlanRevision,
  Timestamp,
} from '@/api/types'

/**
 * The role and status vocabularies of the **read model**, which are wider than
 * the ones of the event payloads: `RunAgent` adds `''` for "never reported".
 * `AgentRole` / `AgentStatus` in `types.ts` are read off the payload schemas and
 * therefore do not carry that case.
 */
type ReportedRole = RunAgent['role']
type ReportedStatus = RunAgent['status']

/**
 * The vocabulary of the run/agent pane, and the one rule that governs it:
 * **nothing here is derived**.
 *
 * The read models report "was never reported" as an empty string or as `null`
 * (ADR 0005). Every label below therefore has an explicit entry for that case —
 * "kein Status gemeldet" is a statement about the report, not about the agent.
 * The pane never turns silence into `blocked`, `stalled`, `failed` or any other
 * verdict, and there is deliberately no time comparison anywhere in this module:
 * an old `lastEventAt` is shown as an old timestamp and nothing else.
 */

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

export const AGENT_ROLE_LABEL: Record<ReportedRole, string> = {
  '': 'keine Rolle gemeldet',
  orchestrator: 'Orchestrator',
  subagent: 'Subagent',
}

export const AGENT_STATUS_LABEL: Record<ReportedStatus, string> = {
  '': 'kein Status gemeldet',
  working: 'arbeitet',
  waiting: 'wartet',
  blocked: 'blockiert',
  idle: 'untätig',
  done: 'fertig',
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  completed: 'abgeschlossen',
  failed: 'fehlgeschlagen',
  cancelled: 'abgebrochen',
}

export const PLAN_STEP_STATE_LABEL: Record<PlanStepState, string> = {
  pending: 'offen',
  in_progress: 'in Arbeit',
  done: 'abgeschlossen',
  skipped: 'übersprungen',
}

/**
 * Second, colour-independent channel for a plan-step state — the same rule the
 * work-state module follows (ADR 0003): the information has to survive
 * greyscale.
 */
export const PLAN_STEP_STATE_GLYPH: Record<PlanStepState, string> = {
  pending: '○',
  in_progress: '◐',
  done: '●',
  skipped: '⊘',
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/**
 * Formats a contract timestamp in UTC.
 *
 * The API normalises every timestamp to UTC (ADR 0005) and the cockpit renders
 * it that way, labelled: a local-time rendering of an agent report is a
 * different claim than the one the agent made, and the difference is invisible
 * until it matters. Built from `Date.getUTC*` rather than `Intl`, so the output
 * does not depend on the host's locale data.
 */
export function formatTimestamp(value: Timestamp): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const pad = (part: number) => String(part).padStart(2, '0')
  return (
    `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}` +
    `, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  )
}

// ---------------------------------------------------------------------------
// Progress: two kinds of statement, never one
// ---------------------------------------------------------------------------

/**
 * How a reported percentage may be rendered.
 *
 * * `counted` — the agent reported `basis: completed_steps` **for its own task**
 *   (`scope: own_task`). That is a countable quantity about a bounded subject,
 *   and it is the only case the pane draws as a filled meter.
 * * `claim` — everything else: a free estimate, a percentage without a reported
 *   basis, and *every* `scope: overall_estimate` regardless of its basis. No
 *   meter, no track, no fill — a quoted number attributed to the agent that said
 *   it.
 *
 * The second rule is the important one. An orchestrator's overall estimate is
 * the agent's opinion about a run nobody can objectively measure in v0; drawing
 * it as a bar next to a subagent's counted bar would let the reader add the two
 * up. See `docs/decisions/0011-run-and-agent-hierarchy.md`.
 */
export type ProgressForm = 'counted' | 'claim'

export interface ProgressStatement {
  form: ProgressForm
  percent: number
  /** Contract value, or `'unreported'` when the agent did not send one. */
  scope: 'own_task' | 'overall_estimate' | 'unreported'
  basis: 'reported_estimate' | 'completed_steps' | 'unreported'
  /** What the number is about, as a sentence fragment. */
  subject: string
  /** How the agent arrived at it. */
  derivation: string
}

export function progressStatement(progress: AgentProgress): ProgressStatement {
  const scope = progress.scope ?? 'unreported'
  const basis = progress.basis ?? 'unreported'
  const form: ProgressForm =
    scope === 'own_task' && basis === 'completed_steps' ? 'counted' : 'claim'

  return {
    form,
    percent: progress.percent,
    scope,
    basis,
    subject: PROGRESS_SUBJECT[scope],
    derivation: PROGRESS_DERIVATION[basis],
  }
}

const PROGRESS_SUBJECT: Record<ProgressStatement['scope'], string> = {
  own_task: 'für den eigenen Task',
  overall_estimate: 'für den gesamten Run',
  unreported: 'ohne gemeldeten Bezug',
}

const PROGRESS_DERIVATION: Record<ProgressStatement['basis'], string> = {
  completed_steps: 'aus abgeschlossenen Schritten gezählt',
  reported_estimate: 'frei geschätzt',
  unreported: 'ohne gemeldete Herleitung',
}

// ---------------------------------------------------------------------------
// Plan completion: the objective counterpart
// ---------------------------------------------------------------------------

export interface StepCompletion {
  done: number
  total: number
  /** States in reported order, so a meter can show one segment per step. */
  states: PlanStepState[]
}

/**
 * Counts the steps of one plan revision that the agent explicitly marked `done`.
 *
 * This is the only "progress" number the cockpit computes itself, and it is a
 * count of reported facts, not a projection: `skipped` is not `done`, and a
 * revision with no steps is `0 von 0` rather than `100 %`.
 */
export function stepCompletion(revision: RunPlanRevision): StepCompletion {
  const states = [...revision.steps]
    .sort((left, right) => left.order - right.order)
    .map((step) => step.state)

  return {
    done: states.filter((state) => state === 'done').length,
    total: states.length,
    states,
  }
}
