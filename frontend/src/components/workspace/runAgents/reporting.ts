import type {
  AgentProgress,
  Outcome,
  PlanStepState,
  RunAgent,
  RunPlanRevision,
} from '@/api/types'
import type { AgentsKey } from '@/i18n'

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

export const AGENT_ROLE_LABEL_KEY: Record<ReportedRole, AgentsKey> = {
  '': 'role.unreported',
  orchestrator: 'role.orchestrator',
  subagent: 'role.subagent',
}

/**
 * The reported status word, mapped onto a display word.
 *
 * This is the sharp edge of the translation contract, and it falls on the
 * translated side: `working` is a **contract value** and stays `working` in
 * every payload, in every id and in every `data-status` attribute; the word the
 * cockpit paints next to it is the cockpit's own vocabulary and reads
 * "arbeitet" or "working". Mapping a closed value onto a display word is not a
 * change to the value (ADR 0014).
 */
export const AGENT_STATUS_LABEL_KEY: Record<ReportedStatus, AgentsKey> = {
  '': 'status.unreported',
  working: 'status.working',
  waiting: 'status.waiting',
  blocked: 'status.blocked',
  idle: 'status.idle',
  done: 'status.done',
}

/**
 * Second, colour-independent channel for a reported agent status.
 *
 * Same rule as `PLAN_STEP_STATE_GLYPH` and `src/state/workStates.ts` (ADR 0003):
 * the information has to survive greyscale, so every status is carried by a
 * glyph **and** its label, never by a hue alone. The glyphs are neutral marks,
 * not verdicts — `blocked` gets the same kind of geometric symbol as `working`.
 */
export const AGENT_STATUS_GLYPH: Record<ReportedStatus, string> = {
  '': '–',
  working: '▶',
  waiting: '⋯',
  blocked: '⊘',
  idle: '○',
  done: '●',
}

export const OUTCOME_LABEL_KEY: Record<Outcome, AgentsKey> = {
  completed: 'outcome.completed',
  failed: 'outcome.failed',
  cancelled: 'outcome.cancelled',
}

export const PLAN_STEP_STATE_LABEL_KEY: Record<PlanStepState, AgentsKey> = {
  pending: 'planStep.pending',
  in_progress: 'planStep.inProgress',
  done: 'planStep.done',
  skipped: 'planStep.skipped',
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
// How much of a row to paint: read off the reported status, never off a clock
// ---------------------------------------------------------------------------

/**
 * Whether an agent's **own last reported status** names work that is still
 * going on.
 *
 * This is the input for the pane's default density (#39): a row whose agent
 * reported ongoing work opens with its details, every other row starts compact.
 * Three properties make that a rendering decision rather than a verdict:
 *
 * * **No clock is consulted.** `lastEventAt`, `startedAt` and the current time
 *   are not read here and are not compared anywhere in this module (ADR 0011).
 *   An agent that reported `working` an hour ago is `ongoing`, exactly like one
 *   that reported it a second ago — because that is what it reported.
 * * **The mapping is the reported vocabulary, nothing else.** `working`,
 *   `waiting` and `blocked` are the three statuses that describe work in flight;
 *   `done` and `idle` are what an agent says when it is not working. A reported
 *   `finishedOutcome` wins over the status field, because an outcome is the
 *   later and more specific statement.
 * * **Nothing is hidden.** A compact row still shows the agent, its status, its
 *   role and its assigned task, and one keystroke opens the rest. Density is
 *   about what is painted first, never about what is available.
 *
 * `unreported` is kept apart from `settled` on purpose: "the agent said it is
 * idle" and "the agent never said anything" are different statements, and the
 * row labels them differently.
 */
export type ReportedWorkState = 'ongoing' | 'settled' | 'unreported'

/** The reported statuses that describe work still in flight. */
const ONGOING_STATUSES: ReadonlySet<ReportedStatus> = new Set<ReportedStatus>([
  'working',
  'waiting',
  'blocked',
])

export function reportedWorkState(
  agent: Pick<RunAgent, 'status' | 'finishedOutcome'>,
): ReportedWorkState {
  if (agent.finishedOutcome !== null) return 'settled'
  if (agent.status === '') return 'unreported'
  return ONGOING_STATUSES.has(agent.status) ? 'ongoing' : 'settled'
}

/**
 * How often each status was reported across a list of agents, in the fixed
 * order of the vocabulary.
 *
 * A count of reported values — the same kind of statement as `run.counts` — and
 * deliberately not a percentage, not a share and not an aggregate of the agents'
 * own progress numbers. ADR 0011 forbids the latter; counting how many agents
 * reported which word is a fact about the log.
 */
const STATUS_TALLY_ORDER: readonly ReportedStatus[] = [
  'working',
  'waiting',
  'blocked',
  'idle',
  'done',
  '',
]

export function statusTally(
  agents: readonly Pick<RunAgent, 'status'>[],
): { status: ReportedStatus; count: number }[] {
  const counts = new Map<ReportedStatus, number>()
  for (const agent of agents) {
    counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1)
  }

  return STATUS_TALLY_ORDER.filter((status) => (counts.get(status) ?? 0) > 0).map(
    (status) => ({ status, count: counts.get(status) as number }),
  )
}

// ---------------------------------------------------------------------------
// Timestamps: not here
// ---------------------------------------------------------------------------

/**
 * This module used to carry its own `formatTimestamp`, built from `Date.getUTC*`
 * so that it did not depend on the host's locale data — and the inspector
 * carried a second, differently shaped one. Both are gone: a reported instant is
 * rendered by `<ReportedTime>` and formatted by `src/i18n/formatting.ts`, which
 * keeps `timeZone: 'UTC'` and the visible `UTC` label that this pane always had
 * (#40, ADR 0019).
 */

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
  /** Key of what the number is about, as a sentence fragment. */
  subjectKey: AgentsKey
  /** Key of how the agent arrived at it. */
  derivationKey: AgentsKey
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
    subjectKey: PROGRESS_SUBJECT_KEY[scope],
    derivationKey: PROGRESS_DERIVATION_KEY[basis],
  }
}

const PROGRESS_SUBJECT_KEY: Record<ProgressStatement['scope'], AgentsKey> = {
  own_task: 'progress.subjectOwnTask',
  overall_estimate: 'progress.subjectOverallEstimate',
  unreported: 'progress.subjectUnreported',
}

const PROGRESS_DERIVATION_KEY: Record<ProgressStatement['basis'], AgentsKey> = {
  completed_steps: 'progress.basisCompletedSteps',
  reported_estimate: 'progress.basisReportedEstimate',
  unreported: 'progress.basisUnreported',
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
