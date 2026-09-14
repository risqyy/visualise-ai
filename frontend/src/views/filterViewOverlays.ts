import type { SavedView } from '@/api/types'
import type { ChangeOverlayModel } from '@/canvas/changeOverlays'

/** Filter only drawable overlays. The global ledger and Inspector evidence
 * remain project-owned and retain references outside the selected view.
 */
export function filterViewOverlays(overlay: ChangeOverlayModel, view: SavedView, includedComponentIds: readonly string[], includedRelationshipIds: readonly string[]): ChangeOverlayModel {
  if (view.selection.mode === 'all') return overlay
  const selectedComponents = new Set(view.selection.scope.componentIds)
  const selectedRelationships = new Set(view.selection.scope.relationshipIds)
  const components = new Set(includedComponentIds)
  const relationships = new Set(includedRelationshipIds)
  const extraComponents = overlay.extraComponents.filter((entry) => selectedComponents.has(entry.component.componentId))
  const extraRelationships = overlay.extraRelationships.filter((entry) => selectedRelationships.has(entry.relationship.relationshipId) && selectedComponents.has(entry.relationship.sourceComponentId) && selectedComponents.has(entry.relationship.targetComponentId))
  const componentOverlays = new Map([...overlay.components].filter(([id]) => components.has(id)))
  const relationshipOverlays = new Map([...overlay.relationships].filter(([id]) => relationships.has(id)))
  const counts = { planned: 0, active: 0, recently_applied: 0, removed: 0 }
  for (const entry of [...componentOverlays.values(), ...relationshipOverlays.values(), ...extraComponents.map((entry) => entry.overlay), ...extraRelationships.map((entry) => entry.overlay)]) counts[entry.state]++
  return { ...overlay, components: componentOverlays, relationships: relationshipOverlays, extraComponents, extraRelationships, counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) }
}
