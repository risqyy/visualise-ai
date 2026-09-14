import type { LayoutPoint } from './elkLayout'

export interface AttachmentObstacle {
  left: number
  right: number
  top: number
  bottom: number
}

/** Project onto the closest segment, so moving along an edge needs no leader. */
export function nearestPointOnRoute(point: LayoutPoint, route: readonly LayoutPoint[]): LayoutPoint {
  let nearest = route[0] ?? point
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1]!
    const end = route[index]!
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const ratio = lengthSquared === 0 ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    const candidate = { x: start.x + ratio * dx, y: start.y + ratio * dy }
    const distance = (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return { x: nearest.x, y: nearest.y }
}

/** Boundary contact is allowed; crossing any part of a node's interior is not. */
export function attachmentCrossesObstacle(
  start: LayoutPoint,
  end: LayoutPoint,
  box: AttachmentObstacle,
): boolean {
  let enter = 0
  let leave = 1
  for (const [origin, delta, minimum, maximum] of [
    [start.x, end.x - start.x, box.left, box.right],
    [start.y, end.y - start.y, box.top, box.bottom],
  ] as const) {
    if (delta === 0) {
      if (origin <= minimum || origin >= maximum) return false
      continue
    }
    const first = (minimum - origin) / delta
    const second = (maximum - origin) / delta
    enter = Math.max(enter, Math.min(first, second))
    leave = Math.min(leave, Math.max(first, second))
    if (enter >= leave) return false
  }
  return enter < leave
}
