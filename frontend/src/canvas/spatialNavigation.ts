import type { GraphOrientation } from './graphOrientation'

export type SpatialDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

export interface SpatialNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** Stable projection order, used only after geometric ties. */
  order?: number
}

interface PositionedNode {
  id: string
  position: Position
  parentId?: string | null
  width?: number
  height?: number
  measured?: { width?: number; height?: number }
}

interface Position {
  x: number
  y: number
}

const DIRECTION_AXIS = {
  ArrowUp: 'y',
  ArrowDown: 'y',
  ArrowLeft: 'x',
  ArrowRight: 'x',
} as const

/**
 * Resolves the rendered architecture positions into absolute rectangles.
 * React Flow stores child positions relative to their parent, while spatial
 * navigation must use the boxes users actually see. The Map keeps parent
 * lookups O(1), including for deeply nested graphs.
 */
export function toSpatialNodes(nodes: readonly PositionedNode[]): SpatialNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const absoluteById = new Map<string, Position>()
  const resolving = new Set<string>()

  const absolutePosition = (node: PositionedNode): Position => {
    const cached = absoluteById.get(node.id)
    if (cached) return cached

    // Projection validation already prevents hierarchy cycles. Keep this
    // fallback total so a transient malformed update cannot break keyboard
    // navigation while the next snapshot is arriving.
    if (resolving.has(node.id)) return node.position
    resolving.add(node.id)

    const parent = node.parentId ? byId.get(node.parentId) : undefined
    const parentPosition = parent ? absolutePosition(parent) : { x: 0, y: 0 }
    const position = {
      x: parentPosition.x + node.position.x,
      y: parentPosition.y + node.position.y,
    }
    resolving.delete(node.id)
    absoluteById.set(node.id, position)
    return position
  }

  return nodes.map((node, order) => {
    const position = absolutePosition(node)
    return {
      id: node.id,
      x: position.x,
      y: position.y,
      width: node.width ?? node.measured?.width ?? 0,
      height: node.height ?? node.measured?.height ?? 0,
      order,
    }
  })
}

/**
 * Finds the deterministic spatial neighbour of a focused node.
 *
 * Candidates are first restricted to the requested half-plane. The score then
 * prefers a short distance in the requested direction and alignment on the
 * other axis. IDs and projection order finish ties, so equal ELK coordinates
 * never make an arrow key choose a different node between renders.
 */
export function spatialNeighbor(
  nodes: readonly SpatialNode[],
  currentId: string,
  direction: SpatialDirection,
  orientation: GraphOrientation,
): string | null {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const current = byId.get(currentId)
  if (!current) return null

  const currentCenter = centerOf(current)
  const axis = DIRECTION_AXIS[direction]
  const sign = direction === 'ArrowUp' || direction === 'ArrowLeft' ? -1 : 1

  const candidates = nodes
    .filter((node) => node.id !== current.id)
    .map((node) => {
      const candidateCenter = centerOf(node)
      const primaryDelta = candidateCenter[axis] - currentCenter[axis]
      if (primaryDelta * sign <= 0) return null

      const secondary = axis === 'x' ? 'y' : 'x'
      const secondaryDelta = Math.abs(candidateCenter[secondary] - currentCenter[secondary])
      const primary = Math.abs(primaryDelta)
      return {
        node,
        primary,
        secondary: secondaryDelta,
        score: primary + secondaryDelta * 2,
        // ELK's reading axis gives a stable final tie-breaker when two boxes
        // have the same distance (horizontal for left-right, vertical for
        // top-down).
        readingCoordinate:
          orientation === 'top-down' ? candidateCenter.x : candidateCenter.y,
      }
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)

  candidates.sort((left, right) => {
    const score = left.score - right.score
    if (score !== 0) return score

    if (left.primary !== right.primary) return left.primary - right.primary
    if (left.secondary !== right.secondary) return left.secondary - right.secondary
    if (left.readingCoordinate !== right.readingCoordinate) {
      return left.readingCoordinate - right.readingCoordinate
    }
    const id = left.node.id.localeCompare(right.node.id)
    return id !== 0 ? id : (left.node.order ?? 0) - (right.node.order ?? 0)
  })

  return candidates[0]?.node.id ?? null
}

function centerOf(node: SpatialNode): { x: number; y: number } {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
}
