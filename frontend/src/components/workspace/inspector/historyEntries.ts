import type {
  ComponentHistoryEntry,
  CorrectionIssuedPayload,
  EventType,
  RetractionIssuedPayload,
  Uuid,
} from '@/api/types'

/**
 * Reading of the component history.
 *
 * The history is the append-only log projected onto one component. Two rules of
 * the contract shape everything below:
 *
 * * "Corrections and retractions appear as their own entries; nothing is ever
 *   overwritten."
 * * A correction "corrects the content of a previously accepted event. The
 *   event log stays append-only: the original event is never mutated."
 *
 * So this module never removes and never rewrites an entry. It only **links**
 * them: an entry that a later `correction.issued` or `retraction.issued` refers
 * to is marked, and the correcting entry keeps its own place in the timeline
 * with the reason the agent gave. A withdrawn statement stays legible, which is
 * the point — a reviewer has to be able to see that something was claimed and
 * then taken back, not just the end state.
 */

export type HistoryItemKind = 'reported' | 'correction' | 'retraction'

export interface HistoryItem {
  entry: ComponentHistoryEntry
  kind: HistoryItemKind
  /** The `clientEventId` this entry corrects or retracts, `null` otherwise. */
  referencesClientEventId: Uuid | null
  /** Reason the agent gave for a correction or retraction, `null` otherwise. */
  reason: string | null
  /** Event type a correction replaces the original's content with. */
  correctedType: EventType | null
  /** A later entry corrected this one. The entry itself stays as it was. */
  isCorrected: boolean
  /** A later entry withdrew this one. The entry itself stays as it was. */
  isRetracted: boolean
}

/**
 * Turns one page-flattened history into linked items.
 *
 * Entries arrive newest first, and that order is preserved: the list is the
 * timeline, not a merge of it.
 */
export function buildHistoryItems(
  entries: readonly ComponentHistoryEntry[],
): HistoryItem[] {
  const correctedIds = new Set<string>()
  const retractedIds = new Set<string>()

  for (const entry of entries) {
    if (entry.type === 'correction.issued') {
      const payload = correctionPayload(entry)
      if (payload) correctedIds.add(payload.correctsClientEventId)
    }
    if (entry.type === 'retraction.issued') {
      const payload = retractionPayload(entry)
      if (payload) retractedIds.add(payload.retractsClientEventId)
    }
  }

  return entries.map((entry) => {
    const correction = correctionPayload(entry)
    const retraction = retractionPayload(entry)

    return {
      entry,
      kind: correction ? 'correction' : retraction ? 'retraction' : 'reported',
      referencesClientEventId:
        correction?.correctsClientEventId ?? retraction?.retractsClientEventId ?? null,
      reason: correction?.reason ?? retraction?.reason ?? null,
      correctedType: correction?.correctedType ?? null,
      isCorrected: correctedIds.has(entry.clientEventId),
      isRetracted: retractedIds.has(entry.clientEventId),
    }
  })
}

/**
 * Narrows `payload` for a `correction.issued` entry.
 *
 * `ComponentHistoryEntry.payload` is a free-form object in the contract — its
 * "effective schema is fixed by `type`". Reading it through the discriminator
 * is a projection of that rule; a malformed row yields `null` and is rendered
 * as a plain entry rather than throwing the whole history away.
 */
function correctionPayload(
  entry: ComponentHistoryEntry,
): CorrectionIssuedPayload | null {
  if (entry.type !== 'correction.issued') return null
  const payload = entry.payload as Partial<CorrectionIssuedPayload>
  if (typeof payload?.correctsClientEventId !== 'string') return null
  if (typeof payload.reason !== 'string') return null
  return payload as CorrectionIssuedPayload
}

function retractionPayload(
  entry: ComponentHistoryEntry,
): RetractionIssuedPayload | null {
  if (entry.type !== 'retraction.issued') return null
  const payload = entry.payload as Partial<RetractionIssuedPayload>
  if (typeof payload?.retractsClientEventId !== 'string') return null
  if (typeof payload.reason !== 'string') return null
  return payload as RetractionIssuedPayload
}

/**
 * German labels for the closed event catalogue.
 *
 * Exhaustive by construction: a type added to the contract and not to this map
 * fails `tsc`, the same guarantee `EVENT_TYPES` has in `api/types.ts`.
 */
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  'agent.started': 'Agent gestartet',
  'agent.status_reported': 'Status gemeldet',
  'agent.progress_reported': 'Fortschritt gemeldet',
  'agent.finished': 'Agent beendet',
  'plan.published': 'Plan veröffentlicht',
  'plan.step_updated': 'Planschritt aktualisiert',
  'work.step_started': 'Arbeitsschritt begonnen',
  'work.step_completed': 'Arbeitsschritt abgeschlossen',
  'feedback.published': 'Feedback veröffentlicht',
  'architecture.snapshot_published': 'Architektur-Snapshot veröffentlicht',
  'component.change_planned': 'Komponentenänderung geplant',
  'component.change_applied': 'Komponentenänderung angewandt',
  'relationship.change_planned': 'Beziehungsänderung geplant',
  'relationship.change_applied': 'Beziehungsänderung angewandt',
  'diff.reported': 'Diff gemeldet',
  'risk.reported': 'Risiko gemeldet',
  'problem.reported': 'Problem gemeldet',
  'correction.issued': 'Korrektur',
  'retraction.issued': 'Retraktion',
  'run.finished': 'Run beendet',
}
