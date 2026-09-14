import { describe, expect, it } from 'vitest'

import { attachmentCrossesObstacle, nearestPointOnRoute } from './edgeLabelAttachment'

describe('edge label attachment', () => {
  it('attaches to the nearest segment instead of a fixed ratio anchor', () => {
    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }]
    expect(nearestPointOnRoute({ x: 120, y: 160 }, route)).toEqual({ x: 100, y: 160 })
    expect(nearestPointOnRoute({ x: 20, y: 0 }, route)).toEqual({ x: 20, y: 0 })
    expect(nearestPointOnRoute({ x: 20, y: -10 }, route)).toEqual({ x: 20, y: 0 })
  })

  it('clamps to endpoints and handles missing or repeated route points', () => {
    const point = { x: 50, y: 50 }
    expect(nearestPointOnRoute(point, [])).toEqual(point)
    expect(nearestPointOnRoute(point, [{ x: 0, y: 0 }])).toEqual({ x: 0, y: 0 })
    expect(nearestPointOnRoute(point, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }]))
      .toEqual({ x: 50, y: 0 })
    expect(nearestPointOnRoute({ x: 150, y: 50 }, [{ x: 0, y: 0 }, { x: 100, y: 0 }]))
      .toEqual({ x: 100, y: 0 })
  })

  it('projects onto diagonal segments without extending the route', () => {
    expect(nearestPointOnRoute({ x: 100, y: 0 }, [{ x: 0, y: 0 }, { x: 100, y: 100 }]))
      .toEqual({ x: 50, y: 50 })
  })

  it('rejects horizontal, vertical and diagonal node crossings but permits boundary contact', () => {
    const box = { left: 10, right: 20, top: 10, bottom: 20 }
    expect(attachmentCrossesObstacle({ x: 0, y: 15 }, { x: 30, y: 15 }, box)).toBe(true)
    expect(attachmentCrossesObstacle({ x: 15, y: 30 }, { x: 15, y: 0 }, box)).toBe(true)
    expect(attachmentCrossesObstacle({ x: 0, y: 0 }, { x: 30, y: 30 }, box)).toBe(true)
    expect(attachmentCrossesObstacle({ x: 0, y: 15 }, { x: 10, y: 15 }, box)).toBe(false)
    expect(attachmentCrossesObstacle({ x: 0, y: 10 }, { x: 30, y: 10 }, box)).toBe(false)
    expect(attachmentCrossesObstacle({ x: 0, y: 0 }, { x: 10, y: 20 }, box)).toBe(false)
  })
})
