import { describe, expect, it } from 'vitest'

import {
  BUNDLE_FAN_SPACING,
  fallbackRoute,
  fanOffset,
  fanRoute,
  pointAtRatio,
  roundedPolylinePath,
} from './edgeGeometry'

describe('edge geometry', () => {
  it('turns a polyline into a path with rounded corners', () => {
    const path = roundedPolylinePath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ])
    expect(path.startsWith('M 0,0')).toBe(true)
    expect(path).toContain('Q 100,0')
    expect(path.endsWith('L 100,100')).toBe(true)
  })

  it('degrades gracefully for short polylines', () => {
    expect(roundedPolylinePath([])).toBe('')
    expect(roundedPolylinePath([{ x: 3, y: 4 }])).toBe('M 3,4')
    expect(
      roundedPolylinePath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe('M 0,0 L 10,0')
  })

  it('fans a bundle out without detaching it from its handles', () => {
    const route = [
      { x: 0, y: 50 },
      { x: 200, y: 50 },
    ]
    const fanned = fanRoute(route, 13)

    // The endpoints stay exactly on the handles…
    expect(fanned[0]).toEqual({ x: 0, y: 50 })
    expect(fanned[fanned.length - 1]).toEqual({ x: 200, y: 50 })
    // …while the middle of the line moves aside.
    expect(fanned).toHaveLength(4)
    expect(fanned[1]?.y).toBe(63)
    expect(fanned[2]?.y).toBe(63)
  })

  it('centres the fan around the original route', () => {
    expect(fanOffset(0, 1)).toBe(0)
    expect(fanOffset(0, 3)).toBe(-BUNDLE_FAN_SPACING)
    expect(fanOffset(1, 3)).toBe(0)
    expect(fanOffset(2, 3)).toBe(BUNDLE_FAN_SPACING)
    // Three lines of a bundle end up on three different paths.
    const offsets = [0, 1, 2].map((index) => fanOffset(index, 3))
    expect(new Set(offsets).size).toBe(3)
  })

  it('finds the midpoint of a polyline for the label', () => {
    const midpoint = pointAtRatio([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ])
    expect(midpoint).toEqual({ x: 100, y: 0 })
    expect(pointAtRatio([{ x: 5, y: 5 }])).toEqual({ x: 5, y: 5 })
    expect(pointAtRatio([], 0.5)).toEqual({ x: 0, y: 0 })
  })

  it('falls back to an orthogonal connection when no route was computed', () => {
    expect(fallbackRoute({ x: 0, y: 10 }, { x: 100, y: 10 })).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ])
    expect(fallbackRoute({ x: 0, y: 0 }, { x: 100, y: 60 })).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 60 },
      { x: 100, y: 60 },
    ])
  })
})
