import type { Prepared, Settings } from './prepare'

export interface Rectangle { left: number; top: number; right: number; bottom: number }
export function intersects(r: Rectangle, width: number, height: number) {
  return r.right > 0 && r.bottom > 0 && r.left < width && r.top < height
}
export function contained(r: Rectangle, width: number, height: number) {
  return r.left >= 0 && r.top >= 0 && r.right <= width && r.bottom <= height
}
export function boundedIDs(ids: Iterable<string>) {
  const sorted = [...new Set(ids)].sort()
  return { ids: sorted.slice(0, 200), overflow: sorted.length > 200 }
}

/** Inspect native painted DOM, not the requested selection or pre-layout graph. */
export function painted(graph: Prepared, settings: Settings) {
  const { width, height } = settings.viewport
  const components: string[] = []
  const relationships: string[] = []
  let clipped = false
  const nodes = new Map([...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => [node.dataset.id, node]))
  for (const node of graph.nodes) {
    const element = nodes.get(node.id)
    if (!element || getComputedStyle(element).visibility === 'hidden') throw new Error('Native node has not painted')
    const bounds = element.getBoundingClientRect()
    if (intersects(bounds, width, height)) components.push(node.id)
    if (!contained(bounds, width, height)) clipped = true
  }
  const edgeElements = new Map([...document.querySelectorAll<SVGGElement>('.react-flow__edge')].map((edge) => [edge.dataset.id, edge]))
  const labels = new Map([...document.querySelectorAll<HTMLElement>('[data-testid]')].map((element) => [element.dataset.testid, element]))
  for (const edge of graph.edges) {
    const element = edgeElements.get(edge.id)
    if (!element) throw new Error('Native edge has not painted')
    const paths = [...element.querySelectorAll<SVGPathElement>('path[data-testid]')]
    if (paths.length === 0) throw new Error('Native edge path has not painted')
    const collapseControl = labels.get(`edge-collapse-${edge.id}`)
    if (collapseControl) clipped ||= !contained(collapseControl.getBoundingClientRect(), width, height)
    const unfolded = settings.detailLevel === 'full' && (edge.data?.relationships.length ?? 0) > 1
    const members = unfolded ? (edge.data?.relationships.map((r) => r.relationshipId) ?? []) : [edge.id]
    for (const member of members) {
      const path = paths.find((candidate) => candidate.dataset.testid === `edge-path-${member}`)
      if (!path) throw new Error('Native relationship path has not painted')
      let visible = false
      const nativeBounds = path.getBoundingClientRect()
      const transform = path.getScreenCTM()
      if (!transform) throw new Error('Native edge transform is unavailable')
      const scale = Math.hypot(transform.a, transform.b)
      const stroke = Number(getComputedStyle(path).strokeWidth.replace('px', '')) * scale / 2
      const bounds = { left: nativeBounds.left - stroke, top: nativeBounds.top - stroke, right: nativeBounds.right + stroke, bottom: nativeBounds.bottom + stroke }
      if (!contained(bounds, width, height)) clipped = true
      // Bounding boxes alone falsely include paths passing around the viewport.
      // Inspect the actual native curve at subpixel screen-space intervals.
      const length = path.getTotalLength()
      if (intersects(bounds, width, height)) {
        const steps = Math.max(1, Math.ceil(length * scale * 2))
        for (let i = 0; i <= steps; i++) {
          const point = path.getPointAtLength(length * i / steps)
          const x = point.x * transform.a + point.y * transform.c + transform.e
          const y = point.x * transform.b + point.y * transform.d + transform.f
          if (x >= -stroke && x <= width + stroke && y >= -stroke && y <= height + stroke) { visible = true; break }
        }
      }
      const originalIDs = unfolded ? [member] : (edge.data?.relationships.map((r) => r.relationshipId) ?? [])
      const label = labels.get(`edge-bundle-${edge.id}`) ?? labels.get(`edge-label-${originalIDs[0]}`)
      if (label) {
        const labelBounds = label.getBoundingClientRect()
        visible ||= intersects(labelBounds, width, height)
        clipped ||= !contained(labelBounds, width, height)
      }
      const markerBounds = endMarkerBounds(path, transform)
      if (markerBounds) {
        visible ||= intersects(markerBounds, width, height)
        clipped ||= !contained(markerBounds, width, height)
      }
      if (visible) relationships.push(...originalIDs)
    }
  }
  const c = boundedIDs(components)
  const r = boundedIDs(relationships)
  return {
    missingReferences: graph.resolved.missingReferences,
    boundaryRelationshipIds: graph.resolved.boundaryRelationshipIds,
    visibleIds: { componentIds: c.ids, relationshipIds: r.ids },
    clipped: clipped || c.overflow || r.overflow,
  }
}

/** Native marker geometry includes the arrowhead outside the line's own box. */
function endMarkerBounds(path: SVGPathElement, transform: DOMMatrix): Rectangle | null {
  const markerURL = path.getAttribute('marker-end') ?? ''
  const id = markerURL.slice(markerURL.indexOf('#') + 1).replace(/[)"']/g, '')
  const marker = document.getElementById(id) as SVGMarkerElement | null
  const shape = marker?.querySelector('path')
  if (!marker || !shape) return null
  const length = path.getTotalLength()
  const end = path.getPointAtLength(length)
  const previous = path.getPointAtLength(Math.max(0, length - 0.01))
  const angle = Math.atan2(end.y - previous.y, end.x - previous.x)
  const stroke = Number(getComputedStyle(path).strokeWidth.replace('px', ''))
  const viewBox = marker.viewBox.baseVal
  const sx = marker.markerWidth.baseVal.value * stroke / viewBox.width
  const sy = marker.markerHeight.baseVal.value * stroke / viewBox.height
  const points = []
  const markerLength = shape.getTotalLength()
  for (let i = 0; i <= 100; i++) {
    const point = shape.getPointAtLength(markerLength * i / 100)
    const x = (point.x - marker.refX.baseVal.value) * sx
    const y = (point.y - marker.refY.baseVal.value) * sy
    const rotatedX = end.x + x * Math.cos(angle) - y * Math.sin(angle)
    const rotatedY = end.y + x * Math.sin(angle) + y * Math.cos(angle)
    points.push({ x: rotatedX * transform.a + rotatedY * transform.c + transform.e, y: rotatedX * transform.b + rotatedY * transform.d + transform.f })
  }
  const shapeStyle = getComputedStyle(shape)
  const margin = shapeStyle.stroke === 'none' ? 0 : Number(shapeStyle.strokeWidth.replace('px', '')) * Math.max(sx, sy) * Math.hypot(transform.a, transform.b) / 2
  return { left: Math.min(...points.map((p) => p.x)) - margin, top: Math.min(...points.map((p) => p.y)) - margin, right: Math.max(...points.map((p) => p.x)) + margin, bottom: Math.max(...points.map((p) => p.y)) + margin }
}
