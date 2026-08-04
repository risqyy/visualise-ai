import { create } from 'zustand'

import type { ProjectId, StreamedEvent } from '@/api/types'

import { EMPTY_LEDGER, ingestEvent, type ChangeLedger } from './changeLedger'

/**
 * Holds the change ledger of the project currently being watched.
 *
 * Like the live connection state, this is **not** server state and therefore
 * deliberately not a query: it is a projection the client folds out of the SSE
 * stream, and it must survive a refetch without being invalidated by one. It is
 * also never persisted — the SSE stream replays the project from position 0 on
 * a fresh connection (ADR 0006), so a reload rebuilds it exactly rather than
 * restoring a stale copy of it.
 *
 * The store scopes itself: an event from another project resets the ledger, so
 * switching projects cannot leave a foreign overlay behind.
 */
export interface ChangeLedgerStore {
  ledger: ChangeLedger
  ingest: (event: StreamedEvent) => void
  reset: () => void
}

export const useChangeLedgerStore = create<ChangeLedgerStore>((set) => ({
  ledger: EMPTY_LEDGER,

  // `ingestEvent` returns the identical object when it had nothing to record,
  // so an unrelated event (an agent status, a diff) causes no re-render at all.
  ingest: (event) =>
    set((state) => {
      const next = ingestEvent(state.ledger, event)
      return next === state.ledger ? state : { ledger: next }
    }),

  reset: () => set({ ledger: EMPTY_LEDGER }),
}))

/** Folds one live event into the ledger. Called from the SSE apply path. */
export function ingestLiveEvent(event: StreamedEvent): void {
  useChangeLedgerStore.getState().ingest(event)
}

/**
 * The ledger of one project.
 *
 * Returns the empty ledger while the store still describes another project, so
 * a pane can never render the overlays of the project the user just left.
 */
export function selectLedgerFor(
  state: ChangeLedgerStore,
  projectId: ProjectId,
): ChangeLedger {
  return state.ledger.projectId === null || state.ledger.projectId === projectId
    ? state.ledger
    : EMPTY_LEDGER
}
