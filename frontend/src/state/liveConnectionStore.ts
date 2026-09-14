import { create } from 'zustand'

import type { LiveConnectionState } from '@/api/liveStream'
import type { ProjectId } from '@/api/types'

interface ProjectReception {
  /** Highest position processed for this project, never a cross-project cursor. */
  lastEventPosition: number | null
  lastEventAt: number | null
  appliedEventCount: number
}

/**
 * The active stream's status and reception metadata, outside the query cache.
 * Project cursors live only for this page session, alongside their change ledgers.
 * A fresh page starts at the live tail; returning to a watched project replays its gap.
 */
export interface LiveConnectionStore extends ProjectReception {
  projectId: ProjectId | null
  state: LiveConnectionState
  projects: ReadonlyMap<ProjectId, ProjectReception>
  activate: (projectId: ProjectId) => void
  deactivate: (projectId: ProjectId) => void
  setState: (projectId: ProjectId, state: LiveConnectionState) => void
  recordEvent: (projectId: ProjectId, position: number) => void
  reset: () => void
}

const emptyReception: ProjectReception = {
  lastEventPosition: null,
  lastEventAt: null,
  appliedEventCount: 0,
}

const initial = {
  ...emptyReception,
  projectId: null,
  state: 'connecting' as LiveConnectionState,
  projects: new Map<ProjectId, ProjectReception>(),
}

export const useLiveConnectionStore = create<LiveConnectionStore>((set) => ({
  ...initial,

  activate: (projectId) => set((current) => ({
    ...(current.projects.get(projectId) ?? emptyReception),
    projectId,
    state: 'connecting',
  })),

  deactivate: (projectId) => set((current) => current.projectId === projectId
    ? { ...emptyReception, projectId: null, state: 'offline' }
    : current),

  setState: (projectId, state) => set((current) => current.projectId === projectId ? { state } : current),

  recordEvent: (projectId, position) => set((current) => {
    if (current.projectId !== projectId || position <= (current.lastEventPosition ?? 0)) return current
    const reception = {
      lastEventPosition: position,
      lastEventAt: Date.now(),
      appliedEventCount: current.appliedEventCount + 1,
    }
    return { ...reception, projects: new Map(current.projects).set(projectId, reception) }
  }),

  reset: () => set({ ...initial }),
}))
