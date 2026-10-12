import { COMPOUND_HEADER_HEIGHT, LEAF_NODE_SIZE, type ArchitectureNode } from './graphProjection'
import { toSpatialNodes, type SpatialNode } from './spatialNavigation'

// Leave space for a relationship to reach a port between separate cards.
const COMPONENT_CLEARANCE = 32
const overlaps = (a: SpatialNode, b: SpatialNode) =>
  a.x < b.x + b.width + COMPONENT_CLEARANCE && a.x + a.width + COMPONENT_CLEARANCE > b.x &&
  a.y < b.y + b.height + COMPONENT_CLEARANCE && a.y + a.height + COMPONENT_CLEARANCE > b.y

/** A local drag must not bury another component or its title beneath a card. */
export function isComponentMoveClear(
  nodes: readonly ArchitectureNode[],
  componentId: string,
  position: { x: number; y: number },
): boolean {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (!byId.has(componentId)) return false
  const ancestors = (id: string): Set<string> => {
    const result = new Set<string>()
    let parent = byId.get(id)?.parentId
    while (parent && !result.has(parent)) {
      result.add(parent)
      parent = byId.get(parent)?.parentId
    }
    return result
  }
  const ancestry = new Map(nodes.map((node) => [node.id, ancestors(node.id)]))
  const moved = new Set(nodes.filter((node) => node.id === componentId ||
    ancestry.get(node.id)?.has(componentId)).map((node) => node.id))
  const boxes = toSpatialNodes(nodes.filter((node) => !node.hidden).map((node) => ({
    ...node,
    position: node.id === componentId ? position : node.position,
    width: node.width ?? node.measured?.width ?? LEAF_NODE_SIZE.width,
    height: node.height ?? node.measured?.height ?? LEAF_NODE_SIZE.height,
  })))
  for (const box of boxes) {
    if (!moved.has(box.id)) continue
    for (const other of boxes) {
      // A compound moves rigidly with its descendants. Their relative geometry
      // is unchanged; only stationary components can be newly obstructed.
      if (moved.has(other.id)) continue
      if (ancestry.get(box.id)?.has(other.id)) {
        // Descendants belong inside their containers, below every title strip.
        if (box.x < other.x || box.x + box.width > other.x + other.width ||
          box.y < other.y + COMPOUND_HEADER_HEIGHT ||
          box.y + box.height > other.y + other.height) return false
      } else if (!ancestry.get(other.id)?.has(box.id) && overlaps(box, other)) {
        return false
      }
    }
  }
  return true
}
