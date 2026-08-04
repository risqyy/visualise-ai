import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import type { ComponentId, Identifier } from '@/api/types'

/**
 * Local UI state — strictly separated from server state.
 *
 * Everything in this store is a property of *this browser tab looking at* the
 * data, not a property of the data:
 *
 * * pane sizes and collapse states
 * * camera position and zoom of the architecture canvas
 * * temporary node positions from dragging
 * * selection, expansion and deep-focus state
 *
 * Two rules hold without exception:
 *
 * 1. None of it is ever written into the TanStack Query cache. The cache holds
 *    exactly what the read API returned.
 * 2. None of it is ever written back into the domain model. Dragging a node
 *    moves it on screen and nowhere else — v0 is observing and read-only, and
 *    the agent's reported architecture is not the user's to edit.
 *
 * Only the layout-ish part is persisted (`localStorage`). Camera, drag
 * positions and selection are intentionally transient: they must not survive a
 * reload into a project whose architecture has meanwhile changed.
 */

/**
 * Panel ids of the workspace group. They are also the keys of the persisted
 * layout, and react-resizable-panels mirrors them into `data-testid`, so they
 * must not collide with the `data-testid`s of the panes themselves.
 */
export const PANE_IDS = {
  left: 'workspace-left',
  center: 'workspace-center',
  right: 'workspace-right',
} as const

export type PaneId = (typeof PANE_IDS)[keyof typeof PANE_IDS]

/** Percentages per pane; must add up to 100. */
export type PaneLayout = Record<string, number>

/**
 * Default split at the mandatory acceptance resolution of 1920 × 1080:
 * 346 px | 1037 px | 537 px. The centre stays the dominant area — three times
 * the left pane and twice the inspector.
 */
export const DEFAULT_PANE_LAYOUT: PaneLayout = {
  [PANE_IDS.left]: 18,
  [PANE_IDS.center]: 54,
  [PANE_IDS.right]: 28,
}

/** Width in percent a collapsed side pane keeps for its expand rail. */
export const COLLAPSED_PANE_SIZE = 3

/**
 * Deep-focus split: the inspector grows over the canvas and the run pane folds
 * into its rail, but the canvas keeps ~41 % of the width — roughly 790 px at
 * 1920 — so the architecture context never disappears.
 */
export const DEEP_FOCUS_PANE_LAYOUT: PaneLayout = {
  [PANE_IDS.left]: COLLAPSED_PANE_SIZE,
  [PANE_IDS.center]: 41,
  [PANE_IDS.right]: 100 - COLLAPSED_PANE_SIZE - 41,
}

export type DeepFocusTarget = 'feedback' | 'diffs'

export interface CameraState {
  x: number
  y: number
  zoom: number
}

export const DEFAULT_CAMERA: CameraState = { x: 0, y: 0, zoom: 1 }

/** The part of the pane arrangement that deep focus temporarily overrides. */
export interface PaneArrangement {
  layout: PaneLayout
  leftCollapsed: boolean
  rightCollapsed: boolean
}

export interface UiState {
  // ---- persisted ---------------------------------------------------------
  layout: PaneLayout
  leftCollapsed: boolean
  rightCollapsed: boolean
  /** Agent ids the user collapsed in the run/agent tree. */
  collapsedAgentIds: string[]

  // ---- transient ---------------------------------------------------------
  camera: CameraState
  /** Node positions from dragging. Never persisted, never sent anywhere. */
  nodePositions: Record<ComponentId, { x: number; y: number }>
  selectedComponentId: ComponentId | null
  selectedRelationshipId: Identifier | null
  hoveredComponentId: ComponentId | null
  deepFocus: DeepFocusTarget | null
  /** Pane arrangement to restore when deep focus ends. */
  paneStateBeforeDeepFocus: PaneArrangement | null

  // ---- actions -----------------------------------------------------------
  setLayout: (layout: PaneLayout) => void
  resetLayout: () => void
  setLeftCollapsed: (collapsed: boolean) => void
  setRightCollapsed: (collapsed: boolean) => void
  toggleLeftCollapsed: () => void
  toggleRightCollapsed: () => void

  setCamera: (camera: CameraState) => void
  resetCamera: () => void
  setNodePosition: (componentId: ComponentId, position: { x: number; y: number }) => void
  clearNodePositions: () => void

  setSelectedComponentId: (componentId: ComponentId | null) => void
  setSelectedRelationshipId: (relationshipId: Identifier | null) => void
  setHoveredComponentId: (componentId: ComponentId | null) => void

  setAgentCollapsed: (agentId: string, collapsed: boolean) => void
  toggleAgentCollapsed: (agentId: string) => void

  enterDeepFocus: (target: DeepFocusTarget) => void
  exitDeepFocus: () => void
}

const transientDefaults = {
  camera: DEFAULT_CAMERA,
  nodePositions: {},
  selectedComponentId: null,
  selectedRelationshipId: null,
  hoveredComponentId: null,
  deepFocus: null,
  paneStateBeforeDeepFocus: null,
} satisfies Partial<UiState>

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      layout: DEFAULT_PANE_LAYOUT,
      leftCollapsed: false,
      rightCollapsed: false,
      collapsedAgentIds: [],
      ...transientDefaults,

      setLayout: (layout) => set({ layout }),
      resetLayout: () => set({ layout: DEFAULT_PANE_LAYOUT }),

      setLeftCollapsed: (leftCollapsed) => set({ leftCollapsed }),
      setRightCollapsed: (rightCollapsed) => set({ rightCollapsed }),
      toggleLeftCollapsed: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
      toggleRightCollapsed: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),

      setCamera: (camera) => set({ camera }),
      resetCamera: () => set({ camera: DEFAULT_CAMERA }),
      setNodePosition: (componentId, position) =>
        set((s) => ({ nodePositions: { ...s.nodePositions, [componentId]: position } })),
      clearNodePositions: () => set({ nodePositions: {} }),

      setSelectedComponentId: (selectedComponentId) => set({ selectedComponentId }),
      setSelectedRelationshipId: (selectedRelationshipId) =>
        set({ selectedRelationshipId }),
      setHoveredComponentId: (hoveredComponentId) => set({ hoveredComponentId }),

      setAgentCollapsed: (agentId, collapsed) =>
        set((s) => {
          const next = new Set(s.collapsedAgentIds)
          if (collapsed) next.add(agentId)
          else next.delete(agentId)
          return { collapsedAgentIds: [...next] }
        }),
      toggleAgentCollapsed: (agentId) =>
        get().setAgentCollapsed(agentId, !get().collapsedAgentIds.includes(agentId)),

      // Deep focus enlarges the inspector over the canvas and folds the run
      // pane into its rail. The arrangement it replaces is remembered, so
      // leaving deep focus restores exactly what the user had set up.
      enterDeepFocus: (target) =>
        set((s) => ({
          deepFocus: target,
          paneStateBeforeDeepFocus: s.paneStateBeforeDeepFocus ?? {
            layout: s.layout,
            leftCollapsed: s.leftCollapsed,
            rightCollapsed: s.rightCollapsed,
          },
          layout: DEEP_FOCUS_PANE_LAYOUT,
          leftCollapsed: true,
          rightCollapsed: false,
        })),

      exitDeepFocus: () =>
        set((s) => {
          if (!s.deepFocus && !s.paneStateBeforeDeepFocus) return {}
          const previous = s.paneStateBeforeDeepFocus
          return {
            deepFocus: null,
            paneStateBeforeDeepFocus: null,
            layout: previous?.layout ?? DEFAULT_PANE_LAYOUT,
            leftCollapsed: previous?.leftCollapsed ?? false,
            rightCollapsed: previous?.rightCollapsed ?? false,
          }
        }),
    }),
    {
      name: 'visualise-ai.ui',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only layout-ish state survives a reload. Camera, drag positions and
      // selection are bound to a concrete architecture snapshot and would be
      // misleading after it changed.
      //
      // Deep focus is a transient mode driven by the `focus` search parameter,
      // so the arrangement it replaced is what gets persisted — otherwise a
      // reload without `?focus=` would come back in a deep-focus split.
      partialize: (state) => {
        const persistedPanes = state.paneStateBeforeDeepFocus ?? {
          layout: state.layout,
          leftCollapsed: state.leftCollapsed,
          rightCollapsed: state.rightCollapsed,
        }
        return { ...persistedPanes, collapsedAgentIds: state.collapsedAgentIds }
      },
    },
  ),
)

/** Resets the whole store. Used by tests and by `resetLayout` in the UI. */
export function resetUiStore(): void {
  useUiStore.setState({
    layout: DEFAULT_PANE_LAYOUT,
    leftCollapsed: false,
    rightCollapsed: false,
    collapsedAgentIds: [],
    ...transientDefaults,
  })
}
