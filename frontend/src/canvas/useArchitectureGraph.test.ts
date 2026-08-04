import { describe, expect, it } from 'vitest'

import { NESTED_COMPONENTS, NESTED_RELATIONSHIPS } from '@/test/architectureFixtures'

import { projectArchitecture } from './graphProjection'
import {
  applyTemporaryPositions,
  routesInvalidatedByDrag,
} from './useArchitectureGraph'

const projection = projectArchitecture({
  components: NESTED_COMPONENTS,
  relationships: NESTED_RELATIONSHIPS,
})

describe('applyTemporaryPositions', () => {
  it('moves a node on screen without touching the domain model behind it', () => {
    const before = structuredClone(NESTED_COMPONENTS)

    const moved = applyTemporaryPositions(
      projection.nodes,
      { 'platform.db': { x: 999, y: 111 } },
      null,
    )

    const node = moved.find((candidate) => candidate.id === 'platform.db')
    expect(node?.position).toEqual({ x: 999, y: 111 })
    // The component the node carries is the very object the read API returned,
    // unchanged — the drag lives in the node, never in the model.
    expect(node?.data.component).toEqual(
      NESTED_COMPONENTS.find((component) => component.componentId === 'platform.db'),
    )
    expect(NESTED_COMPONENTS).toEqual(before)

    // Untouched nodes keep their identity, so React Flow does not remount them.
    const untouched = moved.find((candidate) => candidate.id === 'platform.bus')
    expect(untouched).toBe(
      projection.nodes.find((candidate) => candidate.id === 'platform.bus'),
    )
  })

  it('returns the input untouched when nothing was dragged or selected', () => {
    expect(applyTemporaryPositions(projection.nodes, {}, null)).toBe(projection.nodes)
  })

  it('marks exactly the selected node', () => {
    const marked = applyTemporaryPositions(projection.nodes, {}, 'platform.core.orders')
    expect(marked.filter((node) => node.selected)).toHaveLength(1)
    expect(marked.find((node) => node.selected)?.id).toBe('platform.core.orders')
  })
})

describe('routesInvalidatedByDrag', () => {
  it('drops the computed route only for edges of a moved node', () => {
    const invalidated = routesInvalidatedByDrag(projection.edges, {
      'platform.bus': { x: 10, y: 10 },
    })

    expect([...invalidated].sort()).toEqual([
      'rel:platform.core.billing~>platform.bus',
      'rel:platform.core.orders~>platform.bus',
    ])
  })

  it('keeps every route while nothing was dragged', () => {
    expect(routesInvalidatedByDrag(projection.edges, {}).size).toBe(0)
  })
})
