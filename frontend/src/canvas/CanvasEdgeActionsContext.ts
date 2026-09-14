import { createContext, useContext } from 'react'

export interface CanvasEdgeActions {
  expandedEdgeIds: readonly string[]
  selectedRelationshipId: string | null
  toggleEdgeExpanded: (id: string) => void
  setSelectedRelationshipId: (id: string | null) => void
}

/** Native edges have no dependency on workspace state. Isolated rendering uses
 * these inert defaults; the interactive canvas supplies its current view state.
 */
export const CanvasEdgeActionsContext = createContext<CanvasEdgeActions>({
  expandedEdgeIds: [],
  selectedRelationshipId: null,
  toggleEdgeExpanded: () => {},
  setSelectedRelationshipId: () => {},
})

export function useCanvasEdgeActions() {
  return useContext(CanvasEdgeActionsContext)
}
