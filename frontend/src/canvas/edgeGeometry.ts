import type { LayoutPoint } from './elkLayout'
import {
  DEFAULT_GRAPH_ORIENTATION,
  type GraphOrientation,
} from './graphOrientation'

/**
 * Path helpers for the relationship edges.
 *
 * ELK returns each edge as an orthogonal polyline between the exact points
 * where React Flow draws the handles. These helpers turn that polyline into an
 * SVG path, and fan a bundle out into visually parallel lines without letting
 * the endpoints come off their handles.
 */

const distance = (a: LayoutPoint, b: LayoutPoint): number =>
  Math.hypot(b.x - a.x, b.y - a.y)

const lerp = (from: LayoutPoint, to: LayoutPoint, ratio: number): LayoutPoint => ({
  x: from.x + (to.x - from.x) * ratio,
  y: from.y + (to.y - from.y) * ratio,
})

/** Default corner radius of a routed edge. */
export const EDGE_CORNER_RADIUS = 10

/**
 * Perpendicular distance between two lines of a fanned-out bundle.
 *
 * Relationship labels are independent keyboard/pointer actions. Their
 * screen-space hit areas are 32 px for fine pointers and 44 px for coarse
 * pointers (issue #59), so the model-space fan must leave at least that much
 * room at the readable zoom floor (0.93) instead of relying on the old 13 px
 * visual-only separation.
 */
export const BUNDLE_FAN_SPACING = 48

/**
 * Route-relative lanes for labels on independent edges that share an
 * endpoint. Keeping the lanes away from both handles leaves the label on its
 * own relationship while giving wide channel pills room to clear one another.
 */
export const EDGE_LABEL_STAGGER_START = 0.35
export const EDGE_LABEL_STAGGER_END = 0.65
const EDGE_LABEL_COLLISION_ZOOM = 0.93
const EDGE_LABEL_COLLISION_WIDTH = 220
const EDGE_LABEL_COLLISION_HEIGHT = 44
const EDGE_LABEL_COLLISION_GAP = 8

interface LabelCollisionBox {
  left: number
  right: number
  top: number
  bottom: number
}

function labelCollisionBox(point: LayoutPoint): LabelCollisionBox {
  const centerX = point.x * EDGE_LABEL_COLLISION_ZOOM
  const centerY = point.y * EDGE_LABEL_COLLISION_ZOOM
  return {
    left: centerX - (EDGE_LABEL_COLLISION_WIDTH + EDGE_LABEL_COLLISION_GAP) / 2,
    right: centerX + (EDGE_LABEL_COLLISION_WIDTH + EDGE_LABEL_COLLISION_GAP) / 2,
    top: centerY - (EDGE_LABEL_COLLISION_HEIGHT + EDGE_LABEL_COLLISION_GAP) / 2,
    bottom: centerY + (EDGE_LABEL_COLLISION_HEIGHT + EDGE_LABEL_COLLISION_GAP) / 2,
  }
}

export interface LabelPlacementEdge {
  id: string
  source: string
  target: string
  route?: readonly LayoutPoint[]
}

/**
 * Assigns deterministic label lanes to crowded endpoint groups. ELK already
 * separates the routes, but their visual labels can be much wider than the
 * route-to-route gap. The returned ratios move only the HTML label anchor;
 * edge routes, handles and node dimensions remain untouched.
 */
export function staggeredLabelRatios(
  edges: readonly LabelPlacementEdge[],
): ReadonlyMap<string, number> {
  const ratios = new Map<string, number>()

  const assignGroups = (endpoint: 'source' | 'target') => {
    const groups = new Map<string, LabelPlacementEdge[]>()
    for (const edge of edges) {
      const key = edge[endpoint]
      const group = groups.get(key)
      if (group) group.push(edge)
      else groups.set(key, [edge])
    }

    for (const group of groups.values()) {
      if (group.length < 2) continue
      group.sort((first, second) =>
        first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
      )
      const denominator = Math.max(group.length - 1, 1)
      for (const [index, edge] of group.entries()) {
        if (ratios.has(edge.id)) continue
        const fraction = index / denominator
        ratios.set(
          edge.id,
          EDGE_LABEL_STAGGER_START +
            fraction * (EDGE_LABEL_STAGGER_END - EDGE_LABEL_STAGGER_START),
        )
      }
    }
  }

  // Incoming edges are the common collision case, while the second pass also
  // protects fan-out labels when several edges leave one source.
  assignGroups('target')
  assignGroups('source')

  // Resolve labels whose routes are close even when their endpoints differ.
  // The collision box deliberately uses the coarse-pointer height and a
  // conservative width for the longest bounded canvas pill at the lowest
  // readable zoom, plus the documented 8 px independent-target gap. At higher
  // zooms the same model-space separation only grows on screen. Edges without
  // a route keep their endpoint lane and are handled again when a layout
  // becomes available.
  const placed: { left: number; right: number; top: number; bottom: number }[] = []
  const candidates = [
    EDGE_LABEL_STAGGER_START,
    0.5,
    EDGE_LABEL_STAGGER_END,
  ]
  const ordered = [...edges].sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  )
  for (const edge of ordered) {
    const route = edge.route
    if (!route) continue
    const preferred = ratios.get(edge.id) ?? 0.5
    const hadPreferred = ratios.has(edge.id)
    let bestRatio = preferred
    let bestCollisions = Number.POSITIVE_INFINITY
    let bestDistance = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const point = pointAtRatio(route, candidate)
      const box = labelCollisionBox(point)
      const collisions = placed.filter(
        (other) =>
          Math.min(box.right, other.right) > Math.max(box.left, other.left) &&
          Math.min(box.bottom, other.bottom) > Math.max(box.top, other.top),
      ).length
      const distanceFromPreferred = Math.abs(candidate - preferred)
      if (
        collisions < bestCollisions ||
        (collisions === bestCollisions && distanceFromPreferred < bestDistance)
      ) {
        bestRatio = candidate
        bestCollisions = collisions
        bestDistance = distanceFromPreferred
      }
    }
    if (hadPreferred || bestRatio !== 0.5) ratios.set(edge.id, bestRatio)
    placed.push(labelCollisionBox(pointAtRatio(route, bestRatio)))
  }
  return ratios
}

/**
 * Turns a polyline into an SVG path with rounded corners.
 *
 * Rounding is purely cosmetic but it matters at this density: a sharp
 * right angle at every bend makes a routed graph read as a circuit diagram.
 */
export function roundedPolylinePath(
  points: readonly LayoutPoint[],
  radius = EDGE_CORNER_RADIUS,
): string {
  const first = points[0]
  if (!first) return ''
  if (points.length === 1) return `M ${first.x},${first.y}`

  let path = `M ${first.x},${first.y}`

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1] as LayoutPoint
    const current = points[index] as LayoutPoint
    const next = points[index + 1] as LayoutPoint

    const inLength = distance(previous, current)
    const outLength = distance(current, next)
    if (inLength === 0 || outLength === 0) continue

    const corner = Math.min(radius, inLength / 2, outLength / 2)
    const entry = lerp(current, previous, corner / inLength)
    const exit = lerp(current, next, corner / outLength)

    path += ` L ${round(entry.x)},${round(entry.y)}`
    path += ` Q ${round(current.x)},${round(current.y)} ${round(exit.x)},${round(exit.y)}`
  }

  const last = points[points.length - 1] as LayoutPoint
  return `${path} L ${round(last.x)},${round(last.y)}`
}

/**
 * Offsets the interior of a route so that several relationships of one bundle
 * are drawn as visually parallel lines.
 *
 * The first and the last point stay untouched: they are the handles, and a line
 * that starts next to its node instead of on it reads as a rendering bug. A
 * two-point route gets two synthetic interior points first, otherwise a
 * straight connection could not be fanned out at all.
 */
export function fanRoute(
  points: readonly LayoutPoint[],
  offsetY: number,
  orientation: GraphOrientation = DEFAULT_GRAPH_ORIENTATION,
): LayoutPoint[] {
  if (points.length < 2 || offsetY === 0) return [...points]

  let working = [...points]
  if (working.length === 2) {
    const start = working[0] as LayoutPoint
    const end = working[1] as LayoutPoint
    working = [start, lerp(start, end, 0.3), lerp(start, end, 0.7), end]
  }

  const shifted = working.map((point, index) =>
    index === 0 || index === working.length - 1
      ? point
      : orientation === 'top-down'
        ? { x: point.x + offsetY, y: point.y }
        : { x: point.x, y: point.y + offsetY },
  )

  // Keep the first and last points on their handles while connecting them to
  // the shifted interior with orthogonal bends. Translating the interior of a
  // route otherwise turns its first/last segment into a diagonal at the
  // handle. The first bend follows the reading direction so a left-to-right
  // route leaves its source horizontally and a top-down route leaves it
  // vertically.
  const result: LayoutPoint[] = [shifted[0] as LayoutPoint]
  for (let index = 1; index < shifted.length; index += 1) {
    const next = shifted[index] as LayoutPoint
    const current = result[result.length - 1] as LayoutPoint
    if (current.x !== next.x && current.y !== next.y) {
      result.push(
        orientation === 'top-down'
          ? { x: current.x, y: next.y }
          : { x: next.x, y: current.y },
      )
    }
    result.push(next)
  }
  return result
}

/**
 * Perpendicular offset of entry `index` of a bundle of `total` entries, centred
 * around the original route.
 */
export function fanOffset(index: number, total: number): number {
  if (total <= 1) return 0
  return (index - (total - 1) / 2) * BUNDLE_FAN_SPACING
}

/** Point at a given ratio of the polyline's length. Used to place labels. */
export function pointAtRatio(
  points: readonly LayoutPoint[],
  ratio = 0.5,
): LayoutPoint {
  const first = points[0]
  if (!first) return { x: 0, y: 0 }
  if (points.length === 1) return first

  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1] as LayoutPoint, points[index] as LayoutPoint)
  }
  if (total === 0) return first

  let target = total * Math.min(Math.max(ratio, 0), 1)
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] as LayoutPoint
    const to = points[index] as LayoutPoint
    const segment = distance(from, to)
    if (segment === 0) continue
    if (target <= segment) return lerp(from, to, target / segment)
    target -= segment
  }
  return points[points.length - 1] as LayoutPoint
}

/**
 * Fallback route when ELK has none — after a node was dragged, for example.
 * A simple three-segment orthogonal connection through the horizontal midpoint.
 */
export function fallbackRoute(
  source: LayoutPoint,
  target: LayoutPoint,
  orientation: GraphOrientation = DEFAULT_GRAPH_ORIENTATION,
): LayoutPoint[] {
  if (orientation === 'top-down') {
    if (Math.abs(source.x - target.x) < 0.5) return [source, target]
    const middleY = (source.y + target.y) / 2
    return [
      source,
      { x: source.x, y: middleY },
      { x: target.x, y: middleY },
      target,
    ]
  }

  if (Math.abs(source.y - target.y) < 0.5) return [source, target]
  const middleX = (source.x + target.x) / 2
  return [
    source,
    { x: middleX, y: source.y },
    { x: middleX, y: target.y },
    target,
  ]
}

/**
 * A visible loop for a relationship whose source and target are the same node.
 * ELK intentionally omits self references from its layout input; drawing the
 * fallback as a straight line would put its label inside the node. The loop
 * leaves both handles where React Flow expects them and reserves a clear label
 * point above the box.
 */
export function selfLoopRoute(
  source: LayoutPoint,
  target: LayoutPoint,
): LayoutPoint[] {
  // Keep the badge's roughly 10 px height clear of a 96 px leaf box: the
  // handle is centred at y=48, so a centre 72 px above it leaves a visible
  // gap instead of touching the node's top border.
  const top = Math.min(source.y, target.y) - 72
  const right = Math.max(source.x, target.x) + 48
  const left = Math.min(source.x, target.x) - 48
  return [
    source,
    { x: right, y: source.y },
    { x: right, y: top },
    { x: left, y: top },
    { x: left, y: target.y },
    target,
  ]
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
