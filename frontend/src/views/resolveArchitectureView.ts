import type { AppliedComponent, AppliedRelationship, Component, Relationship, SavedView } from '@/api/types'

export interface ArchitectureViewResolution<C, R> {
  model: { components: C[]; relationships: R[] }
  structuralContextIds: string[]
  collapsedComponentIds: string[]
  missingReferences: { componentIds: string[]; relationshipIds: string[] }
  boundaryRelationshipIds: string[]
}

/** Resolve shared identities without copying descriptors or inventing provenance.
 * Ancestors provide containment, never additional selected endpoints or siblings.
 * Old saved definitions remain readable after model removal or retargeting.
 */
export function resolveArchitectureView<
  C extends Component | AppliedComponent,
  R extends Relationship | AppliedRelationship,
>(
  model: { components: readonly C[]; relationships: readonly R[] },
  view: SavedView,
): ArchitectureViewResolution<C, R> {
  const components = new Map(model.components.map((component) => [component.componentId, component]))
  const relationships = new Map(model.relationships.map((relationship) => [relationship.relationshipId, relationship]))
  const selected = new Set<string>()
  const missingComponents = new Set<string>()
  const missingRelationships = new Set<string>()
  const boundaryRelationships = new Set<string>()
  const selectedRelationships = new Set<string>()
  const componentIds = view.selection.mode === 'all'
    ? [...components.keys()]
    : view.selection.scope.componentIds
  const relationshipIds = view.selection.mode === 'all'
    ? [...relationships.keys()]
    : view.selection.scope.relationshipIds
  for (const id of componentIds) {
    if (components.has(id)) selected.add(id)
    else missingComponents.add(id)
  }
  const included = new Set(selected)
  for (const id of selected) {
    const seen = new Set([id])
    let component = components.get(id)
    while (component?.parentComponentId != null) {
      const parent = component.parentComponentId
      if (seen.has(parent)) break
      seen.add(parent)
      component = components.get(parent)
      if (!component) break
      included.add(parent)
    }
  }
  for (const id of relationshipIds) {
    const relationship = relationships.get(id)
    if (!relationship) missingRelationships.add(id)
    else if (!selected.has(relationship.sourceComponentId) || !selected.has(relationship.targetComponentId)) boundaryRelationships.add(id)
    else selectedRelationships.add(id)
  }
  const collapsed = new Set<string>()
  for (const id of view.collapsedComponentIds) {
    if (!components.has(id)) missingComponents.add(id)
    else if (included.has(id)) collapsed.add(id)
  }
  return {
    model: {
      components: [...included].sort().map((id) => components.get(id)!),
      relationships: [...selectedRelationships].sort().map((id) => relationships.get(id)!),
    },
    structuralContextIds: [...included].filter((id) => !selected.has(id)).sort(),
    collapsedComponentIds: [...collapsed].sort(),
    missingReferences: { componentIds: [...missingComponents].sort(), relationshipIds: [...missingRelationships].sort() },
    boundaryRelationshipIds: [...boundaryRelationships].sort(),
  }
}
