import { create } from 'zustand'

import type { ArchitectureResponse, ProjectId, StreamedEvent } from '@/api/types'

import { EMPTY_LEDGER, ingestEvent, observeModel, type ChangeLedger } from './changeLedger'

/**
 * Holds the change ledger of the project currently being watched.
 *
 * Like the live connection state, this is **not** server state and therefore
 * deliberately not a query: it is a projection the client folds out of the SSE
 * stream, and it must survive a refetch without being invalidated by one. It is
 * also never persisted. A fresh stream starts at the live tail; reconnect
 * resumes the watched position. Reload hydrates explicit scopes from the read
 * API, while recent change evidence describes only events actually observed.
 *
 * The store scopes itself: an event from another project resets the ledger, so
 * switching projects cannot leave a foreign overlay behind.
 */
export interface ChangeLedgerStore {
  ledger: ChangeLedger
  ingest: (event: StreamedEvent, model?: ArchitectureResponse) => void
  reset: () => void
}

export const useChangeLedgerStore = create<ChangeLedgerStore>((set) => ({
  ledger: EMPTY_LEDGER,

  // Replay is a no-op. New positions advance the ledger's deduplication cursor.
  ingest: (event, model) =>
    set((state) => {
      const base = state.ledger.projectId === event.projectId || state.ledger.projectId === null ? state.ledger : EMPTY_LEDGER
      if (event.position <= base.lastPosition) return state
      const next = ingestEvent(model ? observeModel(base, model, event.position) : base, event)
      return next === state.ledger ? state : { ledger: next }
    }),

  reset: () => set({ ledger: EMPTY_LEDGER }),
}))

/** Folds one live event into the ledger. Called from the SSE apply path. */
export function ingestLiveEvent(event: StreamedEvent, model?: ArchitectureResponse): void {
  useChangeLedgerStore.getState().ingest(event, model)
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
