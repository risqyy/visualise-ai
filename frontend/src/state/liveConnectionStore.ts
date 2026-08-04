import { create } from 'zustand'

import type { LiveConnectionState } from '@/api/liveStream'

/**
 * Connection state of the SSE stream.
 *
 * Deliberately a tiny store and **not** a query: the connection is not a read
 * model. Keeping it out of the query cache is what guarantees that a dropped
 * stream cannot invalidate, reset or otherwise destroy the data the user is
 * currently looking at — the cockpit keeps showing the last loaded snapshot and
 * merely says that it is no longer live.
 */
export interface LiveConnectionStore {
  state: LiveConnectionState
  /** Highest project position the client has processed. */
  lastEventPosition: number | null
  /** Wall-clock time of the last received event, for the header. */
  lastEventAt: number | null
  /** Number of events applied since the page was opened. */
  appliedEventCount: number

  setState: (state: LiveConnectionState) => void
  recordEvent: (position: number) => void
  reset: () => void
}

const initial = {
  state: 'connecting' as LiveConnectionState,
  lastEventPosition: null,
  lastEventAt: null,
  appliedEventCount: 0,
}

export const useLiveConnectionStore = create<LiveConnectionStore>((set) => ({
  ...initial,

  setState: (state) => set({ state }),

  recordEvent: (position) =>
    set((current) => ({
      lastEventPosition: Math.max(current.lastEventPosition ?? 0, position),
      lastEventAt: Date.now(),
      appliedEventCount: current.appliedEventCount + 1,
    })),

  reset: () => set({ ...initial }),
}))
