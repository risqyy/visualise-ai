import { useMemo, type ReactNode } from 'react'

import { useUiStore } from '@/state/uiStore'

import { CanvasEdgeActionsContext } from './CanvasEdgeActionsContext'

export function InteractiveEdgeActionsProvider({ children }: { children: ReactNode }) {
  const expandedEdgeIds = useUiStore((state) => state.expandedEdgeIds)
  const selectedRelationshipId = useUiStore((state) => state.selectedRelationshipId)
  const toggleEdgeExpanded = useUiStore((state) => state.toggleEdgeExpanded)
  const setSelectedRelationshipId = useUiStore((state) => state.setSelectedRelationshipId)
  const value = useMemo(() => ({ expandedEdgeIds, selectedRelationshipId, toggleEdgeExpanded, setSelectedRelationshipId }), [expandedEdgeIds, selectedRelationshipId, toggleEdgeExpanded, setSelectedRelationshipId])
  return <CanvasEdgeActionsContext.Provider value={value}>{children}</CanvasEdgeActionsContext.Provider>
}
