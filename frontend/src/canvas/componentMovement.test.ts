import { describe, expect, it } from 'vitest'

import { appliedComponent } from '@/test/architectureFixtures'
import { isComponentMoveClear } from './componentMovement'
import { projectArchitecture, type ArchitectureNode } from './graphProjection'

function fixture(): ArchitectureNode[] {
  const { nodes } = projectArchitecture({
    components: [
      appliedComponent({ componentId: 'group', parentComponentId: null, kind: 'service', name: 'Group' }),
      appliedComponent({ componentId: 'child', parentComponentId: 'group', kind: 'module', name: 'Child' }),
      appliedComponent({ componentId: 'peer', parentComponentId: null, kind: 'service', name: 'Peer' }),
    ],
    relationships: [],
  })
  return nodes.map((node) => ({ ...node,
    position: node.id === 'child' ? { x: 40, y: 80 } :
      node.id === 'peer' ? { x: 600, y: 0 } : { x: 0, y: 0 },
    width: node.id === 'group' ? 400 : 100,
    height: node.id === 'group' ? 300 : 70,
  }))
}

describe('local component movement', () => {
  it('allows free moves without mutating the model and rejects overlapping cards', () => {
    const nodes = fixture()
    const before = structuredClone(nodes)
    expect(isComponentMoveClear(nodes, 'peer', { x: 450, y: 50 })).toBe(true)
    expect(isComponentMoveClear(nodes, 'peer', { x: 350, y: 50 })).toBe(false)
    expect(isComponentMoveClear(nodes, 'peer', { x: 410, y: 50 })).toBe(false)
    expect(nodes).toEqual(before)
  })

  it('keeps nested components below their container title and inside its bounds', () => {
    const nodes = fixture()
    expect(isComponentMoveClear(nodes, 'child', { x: 150, y: 100 })).toBe(true)
    expect(isComponentMoveClear(nodes, 'child', { x: 40, y: 0 })).toBe(false)
    expect(isComponentMoveClear(nodes, 'child', { x: 350, y: 100 })).toBe(false)
  })

  it('moves a compound with its descendants but rejects a collision with an outside peer', () => {
    const nodes = fixture()
    expect(isComponentMoveClear(nodes, 'group', { x: 100, y: 100 })).toBe(true)
    expect(isComponentMoveClear(nodes, 'group', { x: 300, y: 0 })).toBe(false)
  })

  it('rejects non-finite coordinates and absent components', () => {
    expect(isComponentMoveClear(fixture(), 'peer', { x: Infinity, y: 0 })).toBe(false)
    expect(isComponentMoveClear(fixture(), 'missing', { x: 0, y: 0 })).toBe(false)
  })

  it('does not reject rigid compound moves because of an existing narrow internal gap', () => {
    const nodes = fixture()
    const child = nodes.find((node) => node.id === 'child')!
    nodes.push({ ...child, id: 'child-two', position: { x: 160, y: 80 } })
    expect(isComponentMoveClear(nodes, 'group', { x: 100, y: 100 })).toBe(true)
    expect(isComponentMoveClear(nodes, 'child', { x: 60, y: 80 })).toBe(false)
  })
})
