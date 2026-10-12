import { bundleMemberRoute, fallbackRoute, selfLoopRoute } from './edgeGeometry'
import { attachmentCrossesObstacle } from './edgeLabelAttachment'
import type { LayoutPoint } from './elkLayout'
import { COMPOUND_HEADER_HEIGHT, LEAF_NODE_SIZE, resolveRelationships, type ArchitectureEdge, type ArchitectureNode } from './graphProjection'

export interface NodeBox { left: number; top: number; right: number; bottom: number }
interface Obstacle extends NodeBox { id: string }
// More than the 10px rounded corner radius plus the widest normal stroke.
const CLEARANCE = 12
const STEM = 16
const BEND_COST = 16
const CROSSING_COST = 160

/** Absolute geometry is shared by routing and labels, including dragged ancestors. */
export function absoluteNodeBoxes(nodes: readonly ArchitectureNode[]): Map<string, NodeBox> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return new Map(nodes.map((node) => {
    let { x, y } = node.position
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
    return [node.id, { left: x, top: y,
      right: x + (node.width ?? node.measured?.width ?? LEAF_NODE_SIZE.width),
      bottom: y + (node.height ?? node.measured?.height ?? LEAF_NODE_SIZE.height) }]
  }))
}

export function architectureObstacles(nodes: readonly ArchitectureNode[]): Obstacle[] {
  const boxes = absoluteNodeBoxes(nodes)
  return nodes.filter((node) => !node.hidden).map((node) => {
    const box = boxes.get(node.id)!
    return { ...box, id: node.id,
      bottom: node.data.isCompound && !node.data.collapsed ? box.top + COMPOUND_HEADER_HEIGHT : box.bottom }
  })
}

/** Strict interior intersection: a port on the boundary is a valid endpoint. */
export function segmentIntersectsBox(a: LayoutPoint, b: LayoutPoint, box: NodeBox): boolean {
  if (a.x === b.x) return a.x > box.left && a.x < box.right &&
    Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom
  if (a.y === b.y) return a.y > box.top && a.y < box.bottom &&
    Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right
  return true // A routed path must be orthogonal, including its port connections.
}

const same = (a: LayoutPoint, b: LayoutPoint) => a.x === b.x && a.y === b.y
const length = (a: LayoutPoint, b: LayoutPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const inflate = (box: Obstacle, clearance: number): Obstacle => ({ ...box, left: box.left - clearance,
  right: box.right + clearance, top: box.top - clearance, bottom: box.bottom + clearance })

function simplify(points: readonly LayoutPoint[]): LayoutPoint[] {
  const result: LayoutPoint[] = []
  for (const point of points) {
    if (result.length && same(result[result.length - 1]!, point)) continue
    while (result.length > 1) {
      const a = result[result.length - 2]!, b = result[result.length - 1]!
      // Preserve reversals: simplifying them would hide an invalid port approach.
      if ((a.x === b.x && b.x === point.x && (b.y - a.y) * (point.y - b.y) >= 0) ||
          (a.y === b.y && b.y === point.y && (b.x - a.x) * (point.x - b.x) >= 0)) result.pop()
      else break
    }
    result.push(point)
  }
  return result
}

interface Segment { a: LayoutPoint; b: LayoutPoint }
function segments(route: readonly LayoutPoint[]): Segment[] {
  return route.slice(1).map((b, index) => ({ a: route[index]!, b }))
}

/** Penalise crossings and shared lanes, but not the unavoidable shared port stem. */
function congestion(a: LayoutPoint, b: LayoutPoint, occupied: readonly Segment[], ports: readonly LayoutPoint[]): number {
  let result = 0
  for (const other of occupied) {
    const horizontal = a.y === b.y, otherHorizontal = other.a.y === other.b.y
    if (horizontal === otherHorizontal) {
      if (horizontal ? a.y !== other.a.y : a.x !== other.a.x) continue
      const low = Math.max(horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
        horizontal ? Math.min(other.a.x, other.b.x) : Math.min(other.a.y, other.b.y))
      const high = Math.min(horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
        horizontal ? Math.max(other.a.x, other.b.x) : Math.max(other.a.y, other.b.y))
      if (high <= low) continue
      const midpoint = horizontal ? { x: (low + high) / 2, y: a.y } : { x: a.x, y: (low + high) / 2 }
      if (ports.some((port) => length(port, midpoint) <= STEM)) continue
      result += (high - low) * 3
    } else {
      const h = horizontal ? { a, b } : other, v = horizontal ? other : { a, b }
      const point = { x: v.a.x, y: h.a.y }
      if (point.x < Math.min(h.a.x, h.b.x) || point.x > Math.max(h.a.x, h.b.x) ||
          point.y < Math.min(v.a.y, v.b.y) || point.y > Math.max(v.a.y, v.b.y)) continue
      if (!ports.some((port) => length(port, point) <= STEM)) result += CROSSING_COST
    }
  }
  return result
}

function routeCost(route: readonly LayoutPoint[], occupied: readonly Segment[]): number {
  const ports = [route[0]!, route[route.length - 1]!]
  return segments(route).reduce((sum, { a, b }) => sum + length(a, b) + congestion(a, b, occupied, ports),
    Math.max(route.length - 2, 0) * BEND_COST)
}

interface QueueItem { key: number; cost: number; priority: number }
/** Stable binary heap: bounded orthogonal A* without a sort on every expansion. */
class Queue {
  private items: QueueItem[] = []
  private less(a: QueueItem, b: QueueItem) { return a.priority < b.priority || (a.priority === b.priority && a.key < b.key) }
  push(item: QueueItem) {
    const items = this.items
    let index = items.length
    items.push(item)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (!this.less(item, items[parent]!)) break
      items[index] = items[parent]!
      index = parent
    }
    items[index] = item
  }
  pop(): QueueItem | undefined {
    const first = this.items[0], last = this.items.pop()
    if (!this.items.length || !last) return first
    let index = 0
    while (index * 2 + 1 < this.items.length) {
      let child = index * 2 + 1
      if (child + 1 < this.items.length && this.less(this.items[child + 1]!, this.items[child]!)) child++
      if (!this.less(this.items[child]!, last)) break
      this.items[index] = this.items[child]!
      index = child
    }
    this.items[index] = last
    return first
  }
}

function searchRoute(start: LayoutPoint, end: LayoutPoint, preferred: readonly LayoutPoint[],
  obstacles: readonly Obstacle[], occupied: readonly Segment[], ports: readonly LayoutPoint[]): LayoutPoint[] | null {
  // Hanan grid: obstacle boundaries and port coordinates suffice for a
  // rectilinear path. Preferred +/- lanes give parallel members room to differ.
  const xs = new Set([start.x, end.x]), ys = new Set([start.y, end.y])
  for (const box of obstacles) { xs.add(box.left); xs.add(box.right); ys.add(box.top); ys.add(box.bottom) }
  for (const point of preferred) {
    for (const offset of [-CLEARANCE, 0, CLEARANCE]) { xs.add(point.x + offset); ys.add(point.y + offset) }
  }
  const xx = [...xs].sort((a, b) => a - b), yy = [...ys].sort((a, b) => a - b)
  const width = xx.length, size = width * yy.length
  const startId = yy.indexOf(start.y) * width + xx.indexOf(start.x)
  const endId = yy.indexOf(end.y) * width + xx.indexOf(end.x)
  const point = (id: number): LayoutPoint => ({ x: xx[id % width]!, y: yy[Math.floor(id / width)]! })
  const costs = new Float64Array(size * 2).fill(Infinity)
  const previous = new Int32Array(size * 2).fill(-1)
  const queue = new Queue()
  for (const direction of [0, 1]) {
    const key = startId * 2 + direction
    costs[key] = 0
    queue.push({ key, cost: 0, priority: length(start, end) })
  }
  const blocked = new Map<string, boolean>()
  let current: QueueItem | undefined
  while ((current = queue.pop())) {
    if (current.cost !== costs[current.key]) continue
    const id = current.key >> 1
    if (id === endId) {
      const result: LayoutPoint[] = []
      for (let key = current.key; key !== -1; key = previous[key]!) result.push(point(key >> 1))
      return simplify(result.reverse())
    }
    const a = point(id), x = id % width, y = Math.floor(id / width)
    const neighbours = [x > 0 ? id - 1 : -1, x < width - 1 ? id + 1 : -1,
      y > 0 ? id - width : -1, y < yy.length - 1 ? id + width : -1]
    for (const next of neighbours) {
      if (next < 0) continue
      const b = point(next)
      const segmentKey = id < next ? `${id}:${next}` : `${next}:${id}`
      let collision = blocked.get(segmentKey)
      if (collision === undefined) {
        collision = obstacles.some((box) => segmentIntersectsBox(a, b, box))
        blocked.set(segmentKey, collision)
      }
      if (collision) continue
      const direction = a.y === b.y ? 0 : 1, key = next * 2 + direction
      const cost = current.cost + length(a, b) + congestion(a, b, occupied, ports) +
        ((current.key & 1) !== direction ? BEND_COST : 0)
      if (cost >= costs[key]!) continue
      costs[key] = cost
      previous[key] = current.key
      queue.push({ key, cost, priority: cost + length(b, end) })
    }
  }
  return null
}

/** Arrowless label attachments use sharp bends so clearance is not cut away. */
export function routeAnnotation(start: LayoutPoint, end: LayoutPoint, boxes: readonly NodeBox[]): LayoutPoint[] | null {
  if (boxes.every((box) => !attachmentCrossesObstacle(start, end, box))) return [start, end]
  for (const clearance of [4, 0]) {
    const obstacles = boxes.map((box, index) => inflate({ ...box, id: String(index) }, clearance))
    const relevant = new Map(obstacles.filter((box) => attachmentCrossesObstacle(start, end, box))
      .map((box) => [box.id, box]))
    for (let attempt = 0; attempt <= obstacles.length; attempt++) {
      const route = searchRoute(start, end, [start, end], [...relevant.values()], [], [start, end])
      if (!route) break
      const blockers = obstacles.filter((box) => !relevant.has(box.id) &&
        segments(route).some(({ a, b }) => segmentIntersectsBox(a, b, box)))
      if (!blockers.length) return route
      for (const box of blockers) relevant.set(box.id, box)
    }
  }
  return null
}

function repairRoute(preferred: LayoutPoint[], sourceId: string, targetId: string, topDown: boolean,
  obstacles: readonly Obstacle[], occupied: readonly Segment[], clearance = CLEARANCE, stem = STEM): { points: LayoutPoint[]; cornerRadius: number } {
  const source = preferred[0]!, target = preferred[preferred.length - 1]!
  const inflated = obstacles.map((box) => inflate(box, clearance))
  const sourceStub = topDown ? { x: source.x, y: source.y + stem } : { x: source.x + stem, y: source.y }
  const targetStub = topDown ? { x: target.x, y: target.y - stem } : { x: target.x - stem, y: target.y }
  const result = (points: LayoutPoint[]) => ({ points, cornerRadius: clearance === CLEARANCE ? 10 : 2 })
  // Endpoint stems may cross only their own clearance padding, never another body.
  const clear = (route: readonly LayoutPoint[]) => segments(route).every(({ a, b }, index, all) =>
    inflated.every((box) => {
      if ((index === 0 && box.id === sourceId) || (index === all.length - 1 && box.id === targetId)) {
        const body = obstacles.find((item) => item.id === box.id)!
        return !segmentIntersectsBox(a, b, body)
      }
      return !segmentIntersectsBox(a, b, box)
    }))
  const safePreferred = clear(preferred)
  if (safePreferred && segments(preferred).every(({ a, b }) => congestion(a, b, occupied, [source, target]) === 0)) return result(preferred)
  // Start with obstacles touching the old path. Adding blockers encountered
  // by a candidate keeps the typical visibility grid local even in big graphs;
  // every accepted route is still validated against the complete inventory.
  const relevant = new Map(inflated.filter((box) => box.id === sourceId || box.id === targetId ||
    segments(preferred).some(({ a, b }) => segmentIntersectsBox(a, b, box))).map((box) => [box.id, box]))
  let repaired: LayoutPoint[] | null = null
  for (let attempt = 0; attempt <= inflated.length; attempt++) {
    const middle = searchRoute(sourceStub, targetStub, preferred, [...relevant.values()], occupied, [source, target])
    if (!middle) break
    const candidate = simplify([source, ...middle, target])
    const blockers = inflated.filter((box) => !relevant.has(box.id) &&
      segments(candidate).some(({ a, b }) => segmentIntersectsBox(a, b, box)))
    if (!blockers.length) { repaired = candidate; break }
    for (const box of blockers) relevant.set(box.id, box)
  }
  if (repaired && clear(repaired) && (!safePreferred || routeCost(repaired, occupied) < routeCost(preferred, occupied))) return result(repaired)
  if (safePreferred) return result(preferred)
  // ELK leaves 12px below compound titles. Use smaller corners in a narrow
  // channel instead of requiring a 16px port stem inside that title.
  if (clearance === CLEARANCE) return repairRoute(preferred, sourceId, targetId, topDown, obstacles, occupied, 4, 6)
  // Overlapping bodies can trap a handle. Keep the relationship represented;
  // the UI rejects new overlapping drops, and this is only malformed geometry.
  return result(preferred)
}

/**
 * Pure route preparation shared by interactive and headless renderers. Run
 * before label placement and memoize on geometry/disclosure, never selection
 * or camera zoom. All routes see all current obstacles, not just moved endpoints.
 */
export function routeArchitectureEdges(edges: readonly ArchitectureEdge[], nodes: readonly ArchitectureNode[],
  options: { expandedEdgeIds?: readonly string[] } = {}): ArchitectureEdge[] {
  const boxes = absoluteNodeBoxes(nodes), obstacles = architectureObstacles(nodes)
  const expanded = new Set(options.expandedEdgeIds ?? [])
  const occupied: Segment[] = []
  const result = new Map<string, ArchitectureEdge>()
  for (const edge of [...edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const data = edge.data, sourceBox = boxes.get(edge.source), targetBox = boxes.get(edge.target)
    if (!data || edge.hidden || !sourceBox || !targetBox) { result.set(edge.id, edge); continue }
    const orientation = data.fallbackOrientation ?? 'top-down', topDown = orientation === 'top-down'
    const source = topDown ? { x: (sourceBox.left + sourceBox.right) / 2, y: sourceBox.bottom }
      : { x: sourceBox.right, y: (sourceBox.top + sourceBox.bottom) / 2 }
    const target = topDown ? { x: (targetBox.left + targetBox.right) / 2, y: targetBox.top }
      : { x: targetBox.left, y: (targetBox.top + targetBox.bottom) / 2 }
    const selfSize = edge.source === edge.target
      ? { width: sourceBox.right - sourceBox.left, height: sourceBox.bottom - sourceBox.top } : undefined
    // ELK's 1px ports can differ from the model midpoint by one pixel. A moved
    // endpoint or ancestor invalidates that route; unrelated obstacles don't.
    const existing = data.route
    const aligned = existing && existing.length > 1 && length(existing[0]!, source) <= 2 &&
      length(existing[existing.length - 1]!, target) <= 2
    const preferred = aligned ? existing : selfSize ? selfLoopRoute(source, target, orientation, selfSize)
      : fallbackRoute(source, target, orientation)
    const edgeObstacles = selfSize ? obstacles.map((box) => box.id === edge.source ? { ...sourceBox, id: box.id } : box) : obstacles
    const base = repairRoute(preferred, edge.source, edge.target, topDown, edgeObstacles, occupied)
    const route = base.points
    let routeCornerRadius = base.cornerRadius
    // Relationship IDs are opaque; '__proto__' and 'constructor' are data keys.
    const memberRoutes: Record<string, LayoutPoint[]> = Object.create(null)
    const relationships = resolveRelationships(data.relationships)
    if (expanded.has(edge.id) && relationships.length > 1) {
      for (const entry of relationships) {
        const member = repairRoute(bundleMemberRoute(route, entry.index, entry.total, orientation, selfSize),
          edge.source, edge.target, topDown, edgeObstacles, occupied)
        memberRoutes[entry.relationship.relationshipId] = member.points
        routeCornerRadius = Math.min(routeCornerRadius, member.cornerRadius)
        occupied.push(...segments(member.points))
      }
    } else occupied.push(...segments(route))
    result.set(edge.id, { ...edge, data: { ...data, route, memberRoutes, routeCornerRadius } })
  }
  return edges.map((edge) => result.get(edge.id)!)
}
