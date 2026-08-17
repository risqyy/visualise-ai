import { describe, expect, it } from 'vitest'

import { spatialNeighbor, toSpatialNodes, type SpatialNode } from './spatialNavigation'

const nodes: SpatialNode[] = [
  { id: 'source', x: 100, y: 100, width: 40, height: 40, order: 0 },
  { id: 'down', x: 100, y: 220, width: 40, height: 40, order: 1 },
  { id: 'down-right', x: 220, y: 220, width: 40, height: 40, order: 2 },
  { id: 'right', x: 220, y: 100, width: 40, height: 40, order: 3 },
  { id: 'up', x: 100, y: -20, width: 40, height: 40, order: 4 },
]

describe('spatialNeighbor', () => {
  it('chooses the nearest visible node in each direction', () => {
    expect(spatialNeighbor(nodes, 'source', 'ArrowDown', 'top-down')).toBe('down')
    expect(spatialNeighbor(nodes, 'source', 'ArrowRight', 'top-down')).toBe('right')
    expect(spatialNeighbor(nodes, 'source', 'ArrowUp', 'top-down')).toBe('up')
    expect(spatialNeighbor(nodes, 'source', 'ArrowLeft', 'top-down')).toBeNull()
  })

  it('uses actual layout coordinates in either graph orientation', () => {
    const leftRight: SpatialNode[] = [
      { id: 'left', x: 0, y: 100, width: 40, height: 40, order: 0 },
      { id: 'middle', x: 100, y: 100, width: 40, height: 40, order: 1 },
      { id: 'right', x: 200, y: 100, width: 40, height: 40, order: 2 },
    ]

    expect(spatialNeighbor(leftRight, 'middle', 'ArrowLeft', 'left-right')).toBe('left')
    expect(spatialNeighbor(leftRight, 'middle', 'ArrowRight', 'left-right')).toBe('right')
    expect(spatialNeighbor(leftRight, 'middle', 'ArrowUp', 'left-right')).toBeNull()
  })

  it('breaks equal geometry ties by the stable node id', () => {
    const tied = [
      { id: 'zeta', x: 0, y: 100, width: 20, height: 20, order: 0 },
      { id: 'alpha', x: 0, y: 100, width: 20, height: 20, order: 1 },
      { id: 'source', x: 0, y: 0, width: 20, height: 20, order: 2 },
    ]
    expect(spatialNeighbor(tied, 'source', 'ArrowDown', 'top-down')).toBe('alpha')
  })
})

describe('toSpatialNodes', () => {
  it('resolves nested React Flow positions to the visible absolute layout', () => {
    expect(
      toSpatialNodes([
        {
          id: 'root',
          position: { x: 10, y: 20 },
          width: 200,
          height: 200,
        },
        {
          id: 'child',
          parentId: 'root',
          position: { x: 30, y: 40 },
          width: 80,
          height: 50,
        },
      ]),
    ).toEqual([
      { id: 'root', x: 10, y: 20, width: 200, height: 200, order: 0 },
      { id: 'child', x: 40, y: 60, width: 80, height: 50, order: 1 },
    ])
  })
})
