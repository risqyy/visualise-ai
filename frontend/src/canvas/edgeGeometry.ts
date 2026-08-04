import type { LayoutPoint } from './elkLayout'

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

/** Vertical distance between two lines of a fanned-out bundle. */
export const BUNDLE_FAN_SPACING = 13

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
): LayoutPoint[] {
  if (points.length < 2 || offsetY === 0) return [...points]

  let working = [...points]
  if (working.length === 2) {
    const start = working[0] as LayoutPoint
    const end = working[1] as LayoutPoint
    working = [start, lerp(start, end, 0.3), lerp(start, end, 0.7), end]
  }

  return working.map((point, index) =>
    index === 0 || index === working.length - 1
      ? point
      : { x: point.x, y: point.y + offsetY },
  )
}

/**
 * Vertical offset of entry `index` of a bundle of `total` entries, centred
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
): LayoutPoint[] {
  if (Math.abs(source.y - target.y) < 0.5) return [source, target]
  const middleX = (source.x + target.x) / 2
  return [
    source,
    { x: middleX, y: source.y },
    { x: middleX, y: target.y },
    target,
  ]
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
