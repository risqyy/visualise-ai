import type { DetailLevel } from './detailLevel'
import { bundleMemberRoute, fallbackRoute, pointAtRatio, selfLoopRoute } from './edgeGeometry'
import { attachmentCrossesObstacle, nearestPointOnRoute } from './edgeLabelAttachment'
import type { LayoutPoint } from './elkLayout'
import {
  COMPOUND_HEADER_HEIGHT,
  LEAF_NODE_SIZE,
  resolveRelationships,
  type ArchitectureEdge,
  type ArchitectureNode,
} from './graphProjection'

/** The renderer bounds its visible text; selection never changes these sizes. */
export const EDGE_LABEL_MAX_WIDTH = 240
export const EDGE_LABEL_HIT_SIZE = 44
const GAP = 8

export interface EdgeLabelLayoutOptions {
  detailLevel: DetailLevel
  expandedEdgeIds?: readonly string[]
  /** Actual viewport zoom, including an explicitly requested map overview. */
  zoom?: number
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

interface Request {
  edgeId: string
  key: string
  route: readonly LayoutPoint[]
  ratio: number
  compact: boolean
}

function intersects(first: Box, second: Box): boolean {
  return first.left < second.right && first.right > second.left &&
    first.top < second.bottom && first.bottom > second.top
}

/** Resolve parent-relative positions without depending on React Flow's DOM. */
function absoluteNodes(nodes: readonly ArchitectureNode[]): Map<string, Box> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const boxes = new Map<string, Box>()
  for (const node of nodes) {
    let x = node.position.x
    let y = node.position.y
    let parent = node.parentId
    const visited = new Set([node.id])
    while (parent && !visited.has(parent)) {
      visited.add(parent)
      const ancestor = byId.get(parent)
      if (!ancestor) break
      x += ancestor.position.x
      y += ancestor.position.y
      parent = ancestor.parentId
    }
    boxes.set(node.id, {
      left: x,
      top: y,
      right: x + (node.width ?? node.measured?.width ?? LEAF_NODE_SIZE.width),
      bottom: y + (node.height ?? node.measured?.height ?? LEAF_NODE_SIZE.height),
    })
  }
  return boxes
}

function routeFor(edge: ArchitectureEdge, boxes: ReadonlyMap<string, Box>): readonly LayoutPoint[] {
  if (edge.data?.route?.length) return edge.data.route
  const sourceBox = boxes.get(edge.source)
  const targetBox = boxes.get(edge.target)
  if (!sourceBox || !targetBox) return []
  const orientation = edge.data?.fallbackOrientation ?? 'top-down'
  const source = orientation === 'top-down'
    ? { x: (sourceBox.left + sourceBox.right) / 2, y: sourceBox.bottom }
    : { x: sourceBox.right, y: (sourceBox.top + sourceBox.bottom) / 2 }
  const target = orientation === 'top-down'
    ? { x: (targetBox.left + targetBox.right) / 2, y: targetBox.top }
    : { x: targetBox.left, y: (targetBox.top + targetBox.bottom) / 2 }
  return edge.source === edge.target
    ? selfLoopRoute(source, target, orientation, {
      width: sourceBox.right - sourceBox.left,
      height: sourceBox.bottom - sourceBox.top,
    })
    : fallbackRoute(source, target, orientation)
}

/**
 * Place every emitted edge label, work-state mark and bundle action together.
 *
 * A bounded route search keeps labels near their relationships. If the local
 * space is exhausted, a shelf below all occupied rectangles guarantees a free
 * position in finite time. Callers attach displaced labels to the nearest route
 * segment. Only label positions change, never nodes or routes.
 * The same pure planner is used by the interactive and native image renderers.
 */
export function placeEdgeLabels(
  edges: readonly ArchitectureEdge[],
  nodes: readonly ArchitectureNode[],
  options: EdgeLabelLayoutOptions,
): ReadonlyMap<string, Readonly<Record<string, LayoutPoint>>> {
  const zoom = Number.isFinite(options.zoom) && (options.zoom ?? 0) > 0
    ? Math.max(options.zoom ?? 0.93, 0.01)
    : 0.93
  const expanded = new Set(options.expandedEdgeIds ?? [])
  const boxes = absoluteNodes(nodes)
  const obstacles: Box[] = nodes.filter((node) => !node.hidden).map((node) => {
    const box = boxes.get(node.id) as Box
    return node.data.isCompound && !node.data.collapsed
      ? { ...box, bottom: box.top + COMPOUND_HEADER_HEIGHT }
      : box
  })
  const occupied = [...obstacles]
  const requests: Request[] = []
  const ordered = [...edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  for (const edge of ordered) {
    if (edge.hidden || !edge.data) continue
    const resolved = resolveRelationships(edge.data.relationships)
    if (!resolved.length) continue
    const route = routeFor(edge, boxes)
    if (!route.length) continue
    const bundled = resolved.length > 1
    const unfolded = bundled && options.detailLevel !== 'minimal' && expanded.has(edge.id)
    const add = (key: string, labelRoute: readonly LayoutPoint[], ratio: number, compact = false) => {
      requests.push({ edgeId: edge.id, key, route: labelRoute, ratio, compact })
    }
    if (unfolded) {
      for (const [index, entry] of resolved.entries()) {
        const relationshipId = entry.relationship.relationshipId
        const sourceBox = boxes.get(edge.source)
        const fanned = bundleMemberRoute(route, index, resolved.length, edge.data.fallbackOrientation,
          edge.source === edge.target && sourceBox
            ? { width: sourceBox.right - sourceBox.left, height: sourceBox.bottom - sourceBox.top }
            : undefined)
        add(`relationship:${relationshipId}`, fanned, edge.data.labelRatio ?? 0.5)
        if (edge.data.overlays[relationshipId]) add(`overlay:${relationshipId}`, fanned, 0.74)
      }
      add('collapse', route, 0.12, true)
    } else {
      if (bundled || options.detailLevel === 'standard' || options.detailLevel === 'full') {
        add('badge', route, edge.data.labelRatio ?? 0.5, options.detailLevel === 'minimal')
      }
      if (Object.keys(edge.data.overlays).length) add('overlay', route, 0.74, options.detailLevel === 'minimal')
    }
  }

  const result = new Map<string, Record<string, LayoutPoint>>()
  const gap = GAP / Math.min(zoom, 1)
  const height = Math.max(EDGE_LABEL_HIT_SIZE, EDGE_LABEL_HIT_SIZE / zoom) + gap
  let bottom = occupied.reduce((maximum, box) => Math.max(maximum, box.bottom), 0)
  for (const request of requests) {
    // The collapse action includes the member count; unlike the map icon it
    // needs room for several digits as well as its minimum pointer target.
    const baseWidth = request.key === 'collapse' ? 80
      : request.compact ? EDGE_LABEL_HIT_SIZE : EDGE_LABEL_MAX_WIDTH
    const width = Math.max(baseWidth, baseWidth / zoom) + gap
    const rect = (point: LayoutPoint): Box => ({
      left: point.x - width / 2,
      right: point.x + width / 2,
      top: point.y - height / 2,
      bottom: point.y + height / 2,
    })
    const free = (point: LayoutPoint) => {
      if (occupied.some((box) => intersects(rect(point), box))) return false
      const attachment = nearestPointOnRoute(point, request.route)
      return !obstacles.some((box) => attachmentCrossesObstacle(point, attachment, box))
    }
    const preferred = pointAtRatio(request.route, request.ratio)
    let point: LayoutPoint | undefined
    const anchors = [request.ratio, 0.35, 0.65, 0.2, 0.8].map((ratio) => pointAtRatio(request.route, ratio))
    // Sampling each segment also finds usable short branches that global path
    // ratios miss. Keep the search finite, including routes with zero length.
    const offsets: LayoutPoint[] = []
    for (let index = 1; index < request.route.length; index += 1) {
      const start = request.route[index - 1]!
      const end = request.route[index]!
      const dx = end.x - start.x
      const dy = end.y - start.y
      const length = Math.hypot(dx, dy)
      if (!length) continue
      for (const ratio of [0.15, 0.35, 0.5, 0.65, 0.85]) {
        const anchor = { x: start.x + dx * ratio, y: start.y + dy * ratio }
        anchors.push(anchor)
        const step = Math.abs(dx) >= Math.abs(dy) ? height / 2 + gap : width / 2 + gap
        for (let ring = 1; ring <= 8; ring += 1) {
          for (const direction of [-1, 1]) {
            offsets.push({
              x: anchor.x - dy / length * step * ring * direction,
              y: anchor.y + dx / length * step * ring * direction,
            })
          }
        }
      }
    }
    const distanceSquared = (first: LayoutPoint, second: LayoutPoint) =>
      (first.x - second.x) ** 2 + (first.y - second.y) ** 2
    anchors.sort((first, second) => distanceSquared(first, preferred) - distanceSquared(second, preferred))
    for (const candidate of anchors) {
      if (free(candidate)) {
        point = candidate
        break
      }
    }
    if (!point) {
      // Prefer short perpendicular leaders. Diagonal rings around a fixed
      // anchor used to connect a shifted label across its own source node.
      const ranked = offsets.map((candidate) => ({
        candidate,
        cost: distanceSquared(candidate, nearestPointOnRoute(candidate, request.route)) +
          distanceSquared(candidate, preferred) * 0.05,
      })).sort((first, second) => first.cost - second.cost)
      for (const { candidate } of ranked) {
        if (free(candidate)) {
          point = candidate
          break
        }
      }
    }
    point ??= { x: preferred.x, y: bottom + height / 2 + gap }
    const box = rect(point)
    occupied.push(box)
    bottom = Math.max(bottom, box.bottom)
    let positions = result.get(request.edgeId)
    if (!positions) {
      positions = {}
      result.set(request.edgeId, positions)
    }
    positions[request.key] = point
  }
  return result
}
