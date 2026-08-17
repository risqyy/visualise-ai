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
 * Default split, as a share of the window.
 *
 * At the mandatory acceptance resolution of 1920 × 1080 this is
 * 345 px | 1036 px | 537 px, and because the shares are relative it keeps the
 * same proportions at every supported width: the architecture surface is always
 * ~54 % — wider than the two side panes together — which is the product rule
 * that it stays the visually dominant area (ADR 0008).
 */
export const DEFAULT_PANE_LAYOUT: PaneLayout = {
  [PANE_IDS.left]: 18,
  [PANE_IDS.center]: 54,
  [PANE_IDS.right]: 28,
}

/** Width in percent a collapsed side pane keeps for its expand rail. */
export const COLLAPSED_PANE_SIZE = 3

/**
 * Narrowest window the cockpit is designed for.
 *
 * The mandatory acceptance surface stays 1920 × 1080 (epic #1). 1280 is what a
 * 1920 px window turns into at 150 % browser zoom and what a half-screen split
 * on a 2560 px display gives — both are normal desktop situations and neither
 * may make a pane unusable (issue #41).
 */
export const MIN_SUPPORTED_WIDTH = 1280

/**
 * Pane minimums in **CSS pixels**, not in percent.
 *
 * A percentage minimum shrinks with the window, which is exactly the wrong
 * behaviour: the content a pane has to show does not get narrower because the
 * window did. `react-resizable-panels` reads a bare number as pixels, so these
 * are absolute floors that hold at 1280 as well as at 1920 — for the initial
 * split, for a dragged separator and for a window resize alike.
 *
 * Each number is derived from what the pane has to fit, not from taste:
 *
 * * **left, 260 px** — a run row is a 20-character monospace id plus its state
 *   badge, and the agent tree indents four levels before it truncates.
 * * **centre, 500 px** — the canvas toolbar (`Einpassen`, minimap toggle,
 *   detail level) is ~300 px and the minimap is 168 px in the opposite corner;
 *   below ~500 px the two would overlap and the graph would have no room left.
 * * **right, 340 px** — a unified diff is two 40 px line-number gutters plus a
 *   code column that is worth reading before it starts scrolling sideways.
 *
 * They add up to 1100 px and therefore fit into {@link MIN_SUPPORTED_WIDTH}
 * with room to spare; `paneSizing.test.ts` asserts that as an invariant.
 */
export const PANE_MIN_WIDTH_PX: Record<PaneId, number> = {
  [PANE_IDS.left]: 260,
  [PANE_IDS.center]: 500,
  [PANE_IDS.right]: 340,
}

/**
 * Pane maximums, as a share of the window.
 *
 * Only the two side panes are capped, and they are capped so the architecture
 * surface cannot be squeezed out of the middle by dragging. The inspector's
 * 60 % is what the deep-focus split (56 %) needs — that mode deliberately
 * enlarges the inspector and is the one documented exception to "the canvas is
 * the widest pane" (ADR 0008); the canvas stays visible throughout.
 */
export const PANE_MAX_WIDTH: Record<'left' | 'right', string> = {
  left: '32%',
  right: '60%',
}

/**
 * Deep-focus split: the inspector grows over the canvas and the run pane folds
 * into its rail, but the canvas keeps ~41 % of the width — roughly 790 px at
 * 1920 and still ~525 px at 1280 — so the architecture context never
 * disappears and never falls below its pixel minimum.
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
  /**
   * Relationship bundles the user unfolded by clicking them. Purely a way of
   * looking at the graph — the bundle itself is a rendering, never a merge.
   */
  expandedEdgeIds: string[]
  /**
   * Architecture containers whose children are not drawn.
   *
   * `null` means "the canvas has not disclosed this project yet" and makes it
   * apply its initial rule (`initialCollapsedIds`). From the first user action
   * on it the array is authoritative, including the empty array — "the user
   * opened everything" is a different statement from "nothing was decided yet".
   *
   * Transient like the camera and the selection, and for the same reason: it
   * describes a concrete architecture snapshot, and restoring it into a model
   * whose hierarchy has meanwhile changed would hide components the user never
   * chose to hide.
   */
  collapsedComponentIds: string[] | null
  /** `false` hides the canvas minimap. */
  minimapVisible: boolean
  deepFocus: DeepFocusTarget | null
  /** Pane arrangement to restore when deep focus ends. */
  paneStateBeforeDeepFocus: PaneArrangement | null
  /** Whether both side panes are temporarily folded around the canvas. */
  architectureFocus: boolean
  /** Pane arrangement to restore when architecture focus ends. */
  paneStateBeforeArchitectureFocus: PaneArrangement | null

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

  toggleEdgeExpanded: (edgeId: string) => void
  clearExpandedEdges: () => void
  setCollapsedComponentIds: (componentIds: string[] | null) => void
  setComponentCollapsed: (componentId: string, collapsed: boolean) => void
  setMinimapVisible: (visible: boolean) => void

  setAgentCollapsed: (agentId: string, collapsed: boolean) => void
  toggleAgentCollapsed: (agentId: string) => void

  enterDeepFocus: (target: DeepFocusTarget) => void
  exitDeepFocus: () => void
  enterArchitectureFocus: () => void
  exitArchitectureFocus: () => void
  toggleArchitectureFocus: () => void
}

const transientDefaults = {
  camera: DEFAULT_CAMERA,
  nodePositions: {},
  selectedComponentId: null,
  selectedRelationshipId: null,
  hoveredComponentId: null,
  expandedEdgeIds: [],
  collapsedComponentIds: null,
  deepFocus: null,
  paneStateBeforeDeepFocus: null,
  architectureFocus: false,
  paneStateBeforeArchitectureFocus: null,
} satisfies Partial<UiState>

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      layout: DEFAULT_PANE_LAYOUT,
      leftCollapsed: false,
      rightCollapsed: false,
      collapsedAgentIds: [],
      minimapVisible: true,
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

      toggleEdgeExpanded: (edgeId) =>
        set((s) => ({
          expandedEdgeIds: s.expandedEdgeIds.includes(edgeId)
            ? s.expandedEdgeIds.filter((id) => id !== edgeId)
            : [...s.expandedEdgeIds, edgeId],
        })),
      clearExpandedEdges: () => set({ expandedEdgeIds: [] }),
      setCollapsedComponentIds: (collapsedComponentIds) =>
        set({
          collapsedComponentIds:
            collapsedComponentIds === null ? null : [...collapsedComponentIds].sort(),
        }),
      setComponentCollapsed: (componentId, collapsed) =>
        set((s) => {
          const current = new Set(s.collapsedComponentIds ?? [])
          if (collapsed) current.add(componentId)
          else current.delete(componentId)
          return { collapsedComponentIds: [...current].sort() }
        }),
      setMinimapVisible: (minimapVisible) => set({ minimapVisible }),

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

      // Architecture focus changes only the two side panes. The exact
      // arrangement is copied before folding them so a later inspector/run
      // resize or a pre-existing collapsed rail is restored byte-for-byte.
      enterArchitectureFocus: () =>
        set((s) => ({
          architectureFocus: true,
          paneStateBeforeArchitectureFocus:
            s.paneStateBeforeArchitectureFocus ?? {
              layout: { ...s.layout },
              leftCollapsed: s.leftCollapsed,
              rightCollapsed: s.rightCollapsed,
            },
          leftCollapsed: true,
          rightCollapsed: true,
        })),

      exitArchitectureFocus: () =>
        set((s) => {
          if (!s.architectureFocus && !s.paneStateBeforeArchitectureFocus) return {}
          const previous = s.paneStateBeforeArchitectureFocus
          return {
            architectureFocus: false,
            paneStateBeforeArchitectureFocus: null,
            layout: previous?.layout ?? s.layout,
            leftCollapsed: previous?.leftCollapsed ?? false,
            rightCollapsed: previous?.rightCollapsed ?? false,
          }
        }),

      toggleArchitectureFocus: () => {
        if (get().architectureFocus) get().exitArchitectureFocus()
        else get().enterArchitectureFocus()
      },
    }),
    {
      name: 'visualise-ai.ui',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only layout-ish state survives a reload. Camera, drag positions and
      // selection are bound to a concrete architecture snapshot and would be
      // misleading after it changed.
      //
      // Deep focus and architecture focus are transient modes. Persist the
      // arrangement each mode replaced — otherwise a reload without the mode
      // would come back in a temporary folded split.
      partialize: (state) => {
        const persistedPanes =
          state.paneStateBeforeArchitectureFocus ?? state.paneStateBeforeDeepFocus ?? {
            layout: state.layout,
            leftCollapsed: state.leftCollapsed,
            rightCollapsed: state.rightCollapsed,
          }
        return {
          ...persistedPanes,
          collapsedAgentIds: state.collapsedAgentIds,
          minimapVisible: state.minimapVisible,
        }
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
