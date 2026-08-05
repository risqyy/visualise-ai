import { describe, expect, it } from 'vitest'

import {
  LARGE_COMPONENTS,
  LARGE_DEEP_ANCESTORS,
  LARGE_DEEP_COMPONENT_ID,
  LARGE_RELATIONSHIPS,
  NESTED_COMPONENTS,
  NESTED_RELATIONSHIPS,
  reorder,
} from '@/test/architectureFixtures'

import {
  ancestorIds,
  collapseGraph,
  containerIds,
  initialCollapsedIds,
} from './collapse'
import { INITIAL_EXPANDED_DEPTH } from './detailLevel'
import {
  LEAF_NODE_SIZE,
  projectArchitecture,
  projectionSignature,
  resolveEdgeBundle,
} from './graphProjection'

const nested = projectArchitecture({
  components: NESTED_COMPONENTS,
  relationships: NESTED_RELATIONSHIPS,
})

const large = projectArchitecture({
  components: LARGE_COMPONENTS,
  relationships: LARGE_RELATIONSHIPS,
})

describe('initial disclosure', () => {
  it('opens the top levels and closes every container below them', () => {
    const collapsed = new Set(initialCollapsedIds(large.nodes))

    for (const node of large.nodes) {
      if (!node.data.isCompound) continue
      expect(collapsed.has(node.id)).toBe(node.data.depth >= INITIAL_EXPANDED_DEPTH)
    }

    // The rule is about the hierarchy, not about the number of components:
    // `mesh` is the only container that stays open, whatever is inside it.
    expect(initialCollapsedIds(large.nodes)).not.toContain('mesh')
  })

  it('leaves a flat model alone — there is nothing to disclose progressively', () => {
    const flat = projectArchitecture({
      components: NESTED_COMPONENTS.filter((one) => one.parentComponentId === null),
      relationships: [],
    })
    expect(initialCollapsedIds(flat.nodes)).toEqual([])
    expect(containerIds(flat.nodes)).toEqual([])
  })

  it('is deterministic, whatever order the read API sent its rows in', () => {
    const shuffled = projectArchitecture({
      components: reorder(LARGE_COMPONENTS),
      relationships: reorder(LARGE_RELATIONSHIPS),
    })
    expect(initialCollapsedIds(shuffled.nodes)).toEqual(initialCollapsedIds(large.nodes))
  })
})

describe('ancestors of a component', () => {
  it('names the containers a deep link has to open, root first', () => {
    expect(ancestorIds(large.nodes, LARGE_DEEP_COMPONENT_ID)).toEqual([
      ...LARGE_DEEP_ANCESTORS,
    ])
  })

  it('is empty for a root and for a component that is not in the snapshot', () => {
    expect(ancestorIds(large.nodes, 'mesh')).toEqual([])
    expect(ancestorIds(large.nodes, 'nothing-like-this')).toEqual([])
  })
})

describe('collapsing the graph', () => {
  it('is the identity when nothing is collapsed', () => {
    const visible = collapseGraph(large.nodes, large.edges, [])
    expect(visible.nodes).toBe(large.nodes)
    expect(visible.edges).toBe(large.edges)
    expect(visible.hiddenComponentIds.size).toBe(0)
  })

  it('hides exactly the descendants of the collapsed containers', () => {
    const collapsed = initialCollapsedIds(large.nodes)
    const visible = collapseGraph(large.nodes, large.edges, collapsed)

    expect(large.nodes).toHaveLength(32)
    // One system, four services, two stores, one external client.
    expect(visible.nodes.map((node) => node.id)).toEqual([
      'edge.client',
      'mesh',
      'mesh.db',
      'mesh.queue',
      'mesh.s1',
      'mesh.s2',
      'mesh.s3',
      'mesh.s4',
    ])
    expect(visible.hiddenComponentIds.size).toBe(32 - 8)
    expect(visible.hiddenComponentIds.has(LARGE_DEEP_COMPONENT_ID)).toBe(true)
  })

  it('draws a collapsed container as a leaf-sized box that says how much it holds', () => {
    const visible = collapseGraph(large.nodes, large.edges, ['mesh.s1'])
    const service = visible.nodes.find((node) => node.id === 'mesh.s1')
    const expanded = large.nodes.find((node) => node.id === 'mesh.s1')

    // The type does not change: React Flow remounts a node whose type changed,
    // and a remounted node is measured from the DOM instead of from the layout.
    expect(service?.type).toBe(expanded?.type)
    expect(service?.width).toBe(LEAF_NODE_SIZE.width)
    expect(service?.height).toBe(LEAF_NODE_SIZE.height)
    expect(service?.data.collapsed).toBe(true)
    // Two modules with two leaves each.
    expect(service?.data.hiddenDescendantCount).toBe(6)
    // It is still known to be a container, so it can be opened again.
    expect(service?.data.isCompound).toBe(true)
  })

  it('lifts a relationship onto the nearest visible ancestor instead of dropping it', () => {
    const visible = collapseGraph(large.nodes, large.edges, initialCollapsedIds(large.nodes))

    // Eight leaves write to the store; with every service closed that is one
    // drawn edge per service, and each of them still carries its two reported
    // relationships individually.
    const toStore = visible.edges.filter((edge) => edge.target === 'mesh.db')
    expect(toStore.map((edge) => edge.source)).toEqual([
      'mesh.s1',
      'mesh.s2',
      'mesh.s3',
      'mesh.s4',
    ])

    const first = toStore[0]
    expect(first?.data?.bundled).toBe(true)
    expect(resolveEdgeBundle(first!).map((one) => one.relationship.relationshipId)).toEqual([
      'lr-1a1',
      'lr-1b1',
    ])
  })

  it('does not draw a relationship whose two ends collapsed into the same box', () => {
    const inner = projectArchitecture({
      components: NESTED_COMPONENTS,
      relationships: NESTED_RELATIONSHIPS,
    })
    // `platform.core.orders → platform.core.billing` would become a self loop
    // on `platform.core`; a loop on a container states nothing.
    const withInternal = collapseGraph(
      inner.nodes,
      [
        ...inner.edges,
        {
          ...inner.edges[0]!,
          id: 'rel:platform.core.orders~>platform.core.billing',
          source: 'platform.core.orders',
          target: 'platform.core.billing',
          data: {
            ...inner.edges[0]!.data!,
            sourceComponentId: 'platform.core.orders',
            targetComponentId: 'platform.core.billing',
          },
        },
      ],
      ['platform.core'],
    )

    expect(
      withInternal.edges.some(
        (edge) => edge.source === 'platform.core' && edge.target === 'platform.core',
      ),
    ).toBe(false)
  })

  it('keeps the canonical order, so the ELK layout stays deterministic', () => {
    const collapsed = initialCollapsedIds(large.nodes)
    const once = collapseGraph(large.nodes, large.edges, collapsed)

    const shuffled = projectArchitecture({
      components: reorder(LARGE_COMPONENTS),
      relationships: reorder(LARGE_RELATIONSHIPS),
    })
    const twice = collapseGraph(
      shuffled.nodes,
      shuffled.edges,
      [...collapsed].reverse(),
    )

    expect(projectionSignature(twice)).toBe(projectionSignature(once))
    expect(twice.nodes.map((node) => node.id)).toEqual(once.nodes.map((node) => node.id))
    expect(twice.edges.map((edge) => edge.id)).toEqual(once.edges.map((edge) => edge.id))
  })

  it('ignores a collapsed id that is not a container of this snapshot', () => {
    const visible = collapseGraph(nested.nodes, nested.edges, [
      'platform.db',
      'gone.missing',
    ])
    expect(visible.nodes).toBe(nested.nodes)
    expect(visible.collapsedComponentIds.size).toBe(0)
  })
})
