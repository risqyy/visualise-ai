import { describe, expect, it } from 'vitest'

import {
  BUNDLE_FAN_SPACING,
  EDGE_LABEL_STAGGER_END,
  EDGE_LABEL_STAGGER_START,
  fallbackRoute,
  fanOffset,
  fanRoute,
  pointAtRatio,
  roundedPolylinePath,
  selfLoopRoute,
  staggeredLabelRatios,
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
    const fanned = fanRoute(route, 13, 'left-right')

    // The endpoints stay exactly on the handles…
    expect(fanned[0]).toEqual({ x: 0, y: 50 })
    expect(fanned[fanned.length - 1]).toEqual({ x: 200, y: 50 })
    // …while the middle of the line moves aside.
    expect(fanned).toHaveLength(6)
    expect(fanned[2]?.y).toBe(63)
    expect(fanned[3]?.y).toBe(63)
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

  it('staggered labels clear shared-endpoint routes in screen space', () => {
    const routes = [
      [
        { x: 1170, y: 1426 },
        { x: 1170, y: 1516 },
        { x: 1572.5, y: 1516 },
        { x: 1572.5, y: 1647 },
      ],
      [
        { x: 1434, y: 1426 },
        { x: 1434, y: 1526 },
        { x: 1572.5, y: 1526 },
        { x: 1572.5, y: 1647 },
      ],
    ] as const
    const edges = [
      {
        id: 'edge-inventory',
        source: 'inventory-topic',
        target: 'notifications',
        route: routes[0],
      },
      { id: 'edge-order', source: 'order-topic', target: 'notifications', route: routes[1] },
    ]
    const ratios = staggeredLabelRatios(edges)
    expect(ratios.get('edge-inventory')).toBe(EDGE_LABEL_STAGGER_START)
    expect(ratios.get('edge-order')).toBe(EDGE_LABEL_STAGGER_END)

    const firstRatio = ratios.get('edge-inventory') ?? 0.5
    const secondRatio = ratios.get('edge-order') ?? 0.5
    for (const zoom of [0.93, 1.15, 2.5]) {
      const first = pointAtRatio(routes[0], firstRatio)
      const second = pointAtRatio(routes[1], secondRatio)
      const horizontalGap = Math.abs(second.x - first.x) * zoom
      for (const minimumTarget of [32, 44]) {
        expect(horizontalGap).toBeGreaterThan(minimumTarget + 8)
      }
    }
  })

  it('keeps intermediate lanes for four long shared-endpoint routes', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
    ] as const
    const edges = ['a', 'b', 'c', 'd'].map((id) => ({
      id: `edge-${id}`,
      source: `source-${id}`,
      target: 'shared-target',
      route,
    }))
    const ratios = staggeredLabelRatios(edges)
    const expectedRatios = [0.35, 0.45, 0.55, 0.65]
    edges.forEach((edge, index) => {
      expect(ratios.get(edge.id)).toBeCloseTo(expectedRatios[index] ?? 0.5, 10)
    })

    const anchors = edges.map((edge) =>
      pointAtRatio(route, ratios.get(edge.id) ?? 0.5),
    )
    for (let index = 1; index < anchors.length; index += 1) {
      const previous = anchors[index - 1] as { x: number; y: number }
      const current = anchors[index] as { x: number; y: number }
      expect((current.x - previous.x) * 0.93).toBeGreaterThan(220 + 8)
    }
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
    expect(fallbackRoute({ x: 0, y: 10 }, { x: 100, y: 10 }, 'left-right')).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
    ])
    expect(fallbackRoute({ x: 0, y: 0 }, { x: 100, y: 60 }, 'left-right')).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 60 },
      { x: 100, y: 60 },
    ])
  })

  it('uses a vertical midpoint for a top-down fallback route', () => {
    expect(fallbackRoute({ x: 20, y: 0 }, { x: 120, y: 200 }, 'top-down')).toEqual([
      { x: 20, y: 0 },
      { x: 20, y: 100 },
      { x: 120, y: 100 },
      { x: 120, y: 200 },
    ])
  })

  it('fans top-down bundles horizontally while keeping both handles attached', () => {
    const route = [
      { x: 50, y: 0 },
      { x: 50, y: 200 },
    ]
    const fanned = fanRoute(route, 13, 'top-down')
    expect(fanned[0]).toEqual(route[0])
    expect(fanned[fanned.length - 1]).toEqual(route[1])
    expect(fanned.some((point) => point.x === 63)).toBe(true)
    for (let index = 1; index < fanned.length; index += 1) {
      const previous = fanned[index - 1] as { x: number; y: number }
      const current = fanned[index] as { x: number; y: number }
      expect(previous.x === current.x || previous.y === current.y).toBe(true)
    }
  })

  it('keeps every left-to-right fanout segment axis-aligned', () => {
    const fanned = fanRoute(
      [
        { x: 0, y: 50 },
        { x: 200, y: 50 },
      ],
      13,
      'left-right',
    )

    expect(fanned[0]).toEqual({ x: 0, y: 50 })
    expect(fanned[fanned.length - 1]).toEqual({ x: 200, y: 50 })
    expect(fanned.some((point) => point.y === 63)).toBe(true)
    for (let index = 1; index < fanned.length; index += 1) {
      const previous = fanned[index - 1] as { x: number; y: number }
      const current = fanned[index] as { x: number; y: number }
      expect(previous.x === current.x || previous.y === current.y).toBe(true)
    }
  })

  it('routes a self relationship around the node for a safe label point', () => {
    const route = selfLoopRoute({ x: 228, y: 48 }, { x: 0, y: 48 })
    expect(route[0]).toEqual({ x: 228, y: 48 })
    expect(route[route.length - 1]).toEqual({ x: 0, y: 48 })
    expect(pointAtRatio(route)).toEqual({ x: 114, y: -24 })
  })
})
