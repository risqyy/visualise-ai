import { create } from 'zustand'

import type { ArchitectureResponse, ProjectId, StreamedEvent } from '@/api/types'

import { EMPTY_LEDGER, ingestEvent, observeModel, type ChangeLedger } from './changeLedger'

/**
 * Session-local evidence for every watched project, outside the query cache.
 * Keep each ledger for as long as its SSE cursor: returning to a project must
 * retain observed evidence before folding the gap replay. Neither is persisted;
 * a fresh page starts at the live tail and hydrates explicit scopes via reads.
 */
export interface ChangeLedgerStore {
  ledgers: ReadonlyMap<ProjectId, ChangeLedger>
  ingest: (event: StreamedEvent, model?: ArchitectureResponse) => void
  reset: () => void
}

export const useChangeLedgerStore = create<ChangeLedgerStore>((set) => ({
  ledgers: new Map(),

  ingest: (event, model) => set((state) => {
    const base = state.ledgers.get(event.projectId) ?? EMPTY_LEDGER
    if (event.position <= base.lastPosition) return state
    const next = ingestEvent(model ? observeModel(base, model, event.position) : base, event)
    return { ledgers: new Map(state.ledgers).set(event.projectId, next) }
  }),

  reset: () => set({ ledgers: new Map() }),
}))

/** Folds one live event into the ledger. Called from the SSE apply path. */
export function ingestLiveEvent(event: StreamedEvent, model?: ArchitectureResponse): void {
  useChangeLedgerStore.getState().ingest(event, model)
}

/** Stable empty value prevents foreign overlays and unnecessary subscriptions. */
export function selectLedgerFor(state: ChangeLedgerStore, projectId: ProjectId): ChangeLedger {
  return state.ledgers.get(projectId) ?? EMPTY_LEDGER
}
