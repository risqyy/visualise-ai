import type {
  AgentId,
  ChangeOperation,
  Component,
  Identifier,
  ProjectId,
  Relationship,
  RunId,
  StreamedEvent,
  Timestamp,
  Uuid,
} from '@/api/types'

/**
 * The client-side ledger of everything the overlays need and the read API
 * cannot answer.
 *
 * `GET /architecture` returns the applied model plus the proposals that are
 * still `planned` — and nothing else. It has, by contract, no notion of
 *
 * * a work step that is **started and not yet completed** (the `active` state),
 * * a change that was **just applied** (the `recently_applied` state), or
 * * an element that an applied change **removed** (the `removed` state), because
 *   a removed component is exactly the one that is no longer in the response.
 *
 * All three are statements about the *event log*, and the log is what the SSE
 * stream delivers.
 *
 * **The ledger describes what the cockpit watched happen.** A stream opened
 * without a cursor starts at the live tail rather than replaying the project
 * (`liveOnly` in `backend/internal/sse/connection.go`, ADR 0006), so opening the
 * cockpit mid-run shows the applied model, the pending proposals from the read
 * model — and from that moment on every state as its event arrives. That is what
 * "kürzlich angewandt" means, and it is the honest reading: the ledger never
 * claims to know a phase it did not see reported. A reconnect *does* replay the
 * gap, and replayed events are folded in idempotently.
 *
 * Three properties hold, and each of them is a rule of the product:
 *
 * 1. **Nothing is overwritten.** Every change event is appended to `history`.
 *    A retraction *marks* its entry, a correction *supersedes* its entry — both
 *    keep the original inspectable, exactly as the append-only log does.
 * 2. **"Recent" is counted, never timed.** Only the newest
 *    `RECENT_APPLIED_LIMIT` applied changes contribute an overlay. A clock-based
 *    window would make the picture change without an event having arrived, which
 *    is precisely the restless behaviour the cockpit must not produce.
 * 3. **A replacing snapshot resets it.** `architecture.snapshot_published`
 *    replaces the applied model entirely, so every earlier "applied" or
 *    "removed" statement is a statement about a model that no longer exists.
 *    Keeping them would draw a ghost of something the new model contains.
 */

/** Newest applied changes that still contribute an overlay. */
export const RECENT_APPLIED_LIMIT = 8

/** Hard cap on the retained history, so a long run cannot grow without bound. */
export const HISTORY_LIMIT = 200

export type ChangePhase = 'planned' | 'applied'

/** One reported change, kept verbatim. */
export interface LedgerChange {
  /** `clientEventId` of the reporting event — the key a retraction names. */
  clientEventId: Uuid
  /** Agent-assigned change id, or `null` when the agent reported none. */
  changeId: Identifier | null
  targetKind: 'component' | 'relationship'
  targetId: string
  operation: ChangeOperation
  phase: ChangePhase
  agentId: AgentId
  runId: RunId
  occurredAt: Timestamp
  position: number
  /** The reported descriptor, exactly as it arrived. */
  snapshot: Component | Relationship
  /** `true` once a `retraction.issued` withdrew the reporting event. */
  retracted: boolean
  /** `true` once a `correction.issued` replaced the reporting event. */
  superseded: boolean
}

/** A work step that was started and has not been completed. */
export interface LedgerWorkStep {
  workStepId: Identifier
  clientEventId: Uuid
  title: string
  agentId: AgentId
  runId: RunId
  componentIds: readonly string[]
  occurredAt: Timestamp
  position: number
}

export interface ChangeLedger {
  /** Project the ledger describes. `null` before the first event. */
  projectId: ProjectId | null
  /** Highest position ingested; replayed events at or below it are ignored. */
  lastPosition: number
  /** Every change event seen, oldest first. Append-only. */
  history: readonly LedgerChange[]
  /** Work steps that are started and not completed, keyed by `workStepId`. */
  openWorkSteps: Readonly<Record<Identifier, LedgerWorkStep>>
}

export const EMPTY_LEDGER: ChangeLedger = {
  projectId: null,
  lastPosition: 0,
  history: [],
  openWorkSteps: {},
}

/** Guards against a pathological chain of corrections correcting corrections. */
const MAX_CORRECTION_DEPTH = 4

/**
 * Folds one streamed event into the ledger.
 *
 * Pure and total: an event the ledger has nothing to say about returns the very
 * same object, so a caller can use identity to decide whether anything changed.
 * Replayed events (`position <= lastPosition`) are ignored, which makes the
 * reconnect path of ADR 0006 idempotent here as well.
 */
export function ingestEvent(ledger: ChangeLedger, event: StreamedEvent): ChangeLedger {
  const base =
    ledger.projectId !== null && ledger.projectId !== event.projectId
      ? { ...EMPTY_LEDGER, projectId: event.projectId }
      : { ...ledger, projectId: event.projectId }

  if (event.position <= base.lastPosition) return ledger

  const next = applyEvent(base, event, 0)
  return { ...next, lastPosition: event.position }
}

function applyEvent(
  ledger: ChangeLedger,
  event: StreamedEvent,
  depth: number,
): ChangeLedger {
  switch (event.type) {
    case 'work.step_started': {
      const { workStepId, title, componentIds } = event.payload
      return {
        ...ledger,
        openWorkSteps: {
          ...ledger.openWorkSteps,
          [workStepId]: {
            workStepId,
            clientEventId: event.clientEventId,
            title,
            agentId: event.agentId,
            runId: event.runId,
            componentIds: [...componentIds],
            occurredAt: event.occurredAt,
            position: event.position,
          },
        },
      }
    }

    case 'work.step_completed':
      return withoutWorkStep(ledger, event.payload.workStepId)

    case 'component.change_planned':
      return appendChange(ledger, event, {
        changeId: event.payload.changeId,
        targetKind: 'component',
        targetId: event.payload.component.componentId,
        operation: event.payload.operation,
        phase: 'planned',
        snapshot: event.payload.component,
      })

    case 'component.change_applied':
      return appendChange(ledger, event, {
        changeId: event.payload.changeId ?? null,
        targetKind: 'component',
        targetId: event.payload.component.componentId,
        operation: event.payload.operation,
        phase: 'applied',
        snapshot: event.payload.component,
      })

    case 'relationship.change_planned':
      return appendChange(ledger, event, {
        changeId: event.payload.changeId,
        targetKind: 'relationship',
        targetId: event.payload.relationship.relationshipId,
        operation: event.payload.operation,
        phase: 'planned',
        snapshot: event.payload.relationship,
      })

    case 'relationship.change_applied':
      return appendChange(ledger, event, {
        changeId: event.payload.changeId ?? null,
        targetKind: 'relationship',
        targetId: event.payload.relationship.relationshipId,
        operation: event.payload.operation,
        phase: 'applied',
        snapshot: event.payload.relationship,
      })

    // A snapshot replaces the applied model entirely (contract). Every earlier
    // applied change described a model that no longer exists, so the overlays
    // derived from them would contradict what is now on screen. Open work steps
    // survive: a work step is a statement about an agent, not about the model.
    case 'architecture.snapshot_published':
      return { ...ledger, history: [] }

    // The log stays append-only: a retraction never deletes, it marks.
    case 'retraction.issued': {
      const retracted = event.payload.retractsClientEventId
      return {
        ...withoutWorkStepOfEvent(ledger, retracted),
        history: ledger.history.map((entry) =>
          entry.clientEventId === retracted ? { ...entry, retracted: true } : entry,
        ),
      }
    }

    // A correction replaces the *content* of an earlier event. The original
    // stays in `history`, flagged, and the corrected content is ingested under
    // the correction's own client event id.
    case 'correction.issued': {
      if (depth >= MAX_CORRECTION_DEPTH) return ledger
      const correctedId = event.payload.correctsClientEventId
      const marked: ChangeLedger = {
        ...withoutWorkStepOfEvent(ledger, correctedId),
        history: ledger.history.map((entry) =>
          entry.clientEventId === correctedId ? { ...entry, superseded: true } : entry,
        ),
      }
      const corrected = {
        ...event,
        type: event.payload.correctedType,
        payload: event.payload.correctedPayload,
      } as unknown as StreamedEvent
      return applyEvent(marked, corrected, depth + 1)
    }

    default:
      return ledger
  }
}

interface ChangeFields {
  changeId: Identifier | null
  targetKind: 'component' | 'relationship'
  targetId: string
  operation: ChangeOperation
  phase: ChangePhase
  snapshot: Component | Relationship
}

function appendChange(
  ledger: ChangeLedger,
  event: StreamedEvent,
  fields: ChangeFields,
): ChangeLedger {
  const entry: LedgerChange = {
    ...fields,
    clientEventId: event.clientEventId,
    agentId: event.agentId,
    runId: event.runId,
    occurredAt: event.occurredAt,
    position: event.position,
    retracted: false,
    superseded: false,
  }
  const history = [...ledger.history, entry]
  return {
    ...ledger,
    history: history.length > HISTORY_LIMIT ? history.slice(-HISTORY_LIMIT) : history,
  }
}

function withoutWorkStep(ledger: ChangeLedger, workStepId: Identifier): ChangeLedger {
  if (!(workStepId in ledger.openWorkSteps)) return ledger
  const openWorkSteps = { ...ledger.openWorkSteps }
  delete openWorkSteps[workStepId]
  return { ...ledger, openWorkSteps }
}

/** Drops the open work step a withdrawn or corrected event had started. */
function withoutWorkStepOfEvent(ledger: ChangeLedger, clientEventId: Uuid): ChangeLedger {
  const match = Object.values(ledger.openWorkSteps).find(
    (step) => step.clientEventId === clientEventId,
  )
  return match ? withoutWorkStep(ledger, match.workStepId) : ledger
}

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------

/** Every change still in force: neither withdrawn nor replaced. */
export function standingChanges(ledger: ChangeLedger): LedgerChange[] {
  return ledger.history.filter((entry) => !entry.retracted && !entry.superseded)
}

/**
 * The newest applied changes that still count as "recent", oldest first.
 *
 * Bounded by count rather than by a clock, so the picture only ever changes
 * because an event arrived.
 */
export function recentAppliedChanges(
  ledger: ChangeLedger,
  limit = RECENT_APPLIED_LIMIT,
): LedgerChange[] {
  const applied = standingChanges(ledger).filter((entry) => entry.phase === 'applied')
  return applied.slice(-limit)
}

/** Open work steps, sorted by position so the result is order-independent. */
export function openWorkSteps(ledger: ChangeLedger): LedgerWorkStep[] {
  return Object.values(ledger.openWorkSteps).sort((a, b) => a.position - b.position)
}
