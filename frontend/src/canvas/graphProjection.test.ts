import { describe, expect, it } from 'vitest'

import type { AppliedComponent, AppliedRelationship } from '@/api/types'
import {
  ALL_RELATIONSHIP_KINDS,
  BUNDLED_TOPIC_CHANNELS,
  NESTED_COMPONENTS,
  NESTED_RELATIONSHIPS,
  appliedComponent,
  appliedRelationship,
  reorder,
} from '@/test/architectureFixtures'
import type { ChangeOverlay, ChangeOverlayModel } from './changeOverlays'

import {
  COMPONENT_NODE_TYPE,
  COMPOUND_NODE_TYPE,
  bundleEdgeId,
  countRelationships,
  diagnosticsCount,
  isProjectionClean,
  projectArchitecture,
  projectionSignature,
  resolveEdgeBundle,
  type ArchitectureEdge,
} from './graphProjection'

const model = { components: NESTED_COMPONENTS, relationships: NESTED_RELATIONSHIPS }

function edgeById(edges: ArchitectureEdge[], id: string): ArchitectureEdge {
  const edge = edges.find((candidate) => candidate.id === id)
  if (!edge) throw new Error(`edge ${id} missing; have ${edges.map((e) => e.id).join(', ')}`)
  return edge
}

describe('projectArchitecture — nested snapshot', () => {
  it('translates every component and every relationship without losing anything', () => {
    const { nodes, edges, diagnostics } = projectArchitecture(model)

    expect(isProjectionClean(diagnostics)).toBe(true)
    expect(diagnosticsCount(diagnostics)).toBe(0)

    // Every component became exactly one node.
    expect(nodes).toHaveLength(NESTED_COMPONENTS.length)
    expect(nodes.map((node) => node.id).sort()).toEqual(
      NESTED_COMPONENTS.map((component) => component.componentId).sort(),
    )

    // Every relationship is carried by exactly one edge, and none was merged
    // away: eight relationships on six edges, because three NATS topics share
    // a node pair.
    expect(countRelationships(edges)).toBe(NESTED_RELATIONSHIPS.length)
    expect(edges).toHaveLength(6)

    const carried = edges
      .flatMap((edge) => edge.data?.relationships ?? [])
      .map((relationship) => relationship.relationshipId)
      .sort()
    expect(carried).toEqual(
      NESTED_RELATIONSHIPS.map((relationship) => relationship.relationshipId).sort(),
    )

    // All six kinds of the contract survive the projection.
    const kinds = new Set(
      edges.flatMap((edge) => edge.data?.relationships ?? []).map((r) => r.kind),
    )
    expect([...kinds].sort()).toEqual([...ALL_RELATIONSHIP_KINDS].sort())
  })

  it('builds the compound structure over four levels', () => {
    const { nodes } = projectArchitecture(model)
    const byId = new Map(nodes.map((node) => [node.id, node]))

    expect(byId.get('platform')?.parentId).toBeUndefined()
    expect(byId.get('platform.api')?.parentId).toBe('platform')
    expect(byId.get('platform.api.http')?.parentId).toBe('platform.api')
    expect(byId.get('platform.api.http.router')?.parentId).toBe('platform.api.http')

    expect(byId.get('platform')?.data.depth).toBe(0)
    expect(byId.get('platform.api')?.data.depth).toBe(1)
    expect(byId.get('platform.api.http')?.data.depth).toBe(2)
    expect(byId.get('platform.api.http.router')?.data.depth).toBe(3)

    // Containers are compound nodes, everything else is a leaf.
    expect(byId.get('platform')?.type).toBe(COMPOUND_NODE_TYPE)
    expect(byId.get('platform.api.http')?.type).toBe(COMPOUND_NODE_TYPE)
    expect(byId.get('platform.api.http.router')?.type).toBe(COMPONENT_NODE_TYPE)
    expect(byId.get('platform.db')?.type).toBe(COMPONENT_NODE_TYPE)

    expect(byId.get('platform')?.data.childCount).toBe(4)
    expect(byId.get('platform.api.http.router')?.data.childCount).toBe(0)

    // Children are constrained to their container and, as React Flow requires,
    // always appear after it in the node list.
    for (const node of nodes) {
      if (node.parentId === undefined) continue
      expect(node.extent).toBe('parent')
      const parentIndex = nodes.findIndex((candidate) => candidate.id === node.parentId)
      const ownIndex = nodes.findIndex((candidate) => candidate.id === node.id)
      expect(parentIndex).toBeGreaterThanOrEqual(0)
      expect(parentIndex).toBeLessThan(ownIndex)
    }
  })

  it('produces the same graph regardless of the input order', () => {
    const straight = projectArchitecture(model)
    const shuffled = projectArchitecture({
      components: reorder(NESTED_COMPONENTS),
      relationships: reorder(NESTED_RELATIONSHIPS),
    })

    expect(shuffled.nodes.map((node) => node.id)).toEqual(
      straight.nodes.map((node) => node.id),
    )
    expect(shuffled.edges.map((edge) => edge.id)).toEqual(
      straight.edges.map((edge) => edge.id),
    )
    expect(projectionSignature(shuffled)).toBe(projectionSignature(straight))
  })
})

describe('projectArchitecture — bundling and NATS topics', () => {
  it('bundles parallel relationships into one edge that stays resolvable', () => {
    const { edges } = projectArchitecture(model)
    const bundle = edgeById(edges, bundleEdgeId('platform.core.orders', 'platform.bus'))

    expect(bundle.data?.bundled).toBe(true)
    expect(bundle.data?.relationships).toHaveLength(3)

    // The individual relationships are reachable and identifiable — each with
    // its own channel and operation, which is what makes the bundle a rendering
    // rather than a merge.
    const resolved = resolveEdgeBundle(bundle)
    expect(resolved).toHaveLength(3)
    // Ordered by `relationshipId`, so the order is stable across refetches.
    expect(resolved.map((entry) => entry.relationship.relationshipId)).toEqual([
      'r-05',
      'r-06',
      'r-07',
    ])
    expect(resolved.map((entry) => entry.relationship.channel).sort()).toEqual([
      ...BUNDLED_TOPIC_CHANNELS,
    ])
    expect(resolved.map((entry) => entry.discriminator).sort()).toEqual([
      ...BUNDLED_TOPIC_CHANNELS,
    ])
    for (const entry of resolved) {
      expect(entry.relationship.operation).toBe('publish')
      expect(entry.displayName).toBe(`NATS · ${entry.relationship.channel}`)
      expect(entry.total).toBe(3)
    }
    expect(resolved.map((entry) => entry.index)).toEqual([0, 1, 2])
  })

  it('keeps separate NATS topics as separate relationships', () => {
    const { edges } = projectArchitecture(model)
    const topics = edges
      .flatMap((edge) => edge.data?.relationships ?? [])
      .filter((relationship) => relationship.kind === 'nats_topic')

    // Three reported topics stay three relationships with three distinct ids
    // and three distinct channels. Nothing is aggregated.
    expect(topics).toHaveLength(3)
    expect(new Set(topics.map((topic) => topic.relationshipId)).size).toBe(3)
    expect(topics.map((topic) => topic.channel).sort()).toEqual([...BUNDLED_TOPIC_CHANNELS])
  })

  it('leaves a single relationship unbundled', () => {
    const { edges } = projectArchitecture(model)
    const single = edgeById(edges, bundleEdgeId('platform.core.orders', 'platform.db'))

    expect(single.data?.bundled).toBe(false)
    expect(resolveEdgeBundle(single)).toHaveLength(1)
    expect(resolveEdgeBundle(single)[0]?.relationship.relationshipId).toBe('r-03')
  })

  it('does not bundle across directions', () => {
    const components: AppliedComponent[] = [
      appliedComponent({ componentId: 'a', name: 'A', kind: 'service', parentComponentId: null }),
      appliedComponent({ componentId: 'b', name: 'B', kind: 'service', parentComponentId: null }),
    ]
    const relationships: AppliedRelationship[] = [
      appliedRelationship({
        relationshipId: 'x',
        sourceComponentId: 'a',
        targetComponentId: 'b',
        kind: 'http',
      }),
      appliedRelationship({
        relationshipId: 'y',
        sourceComponentId: 'b',
        targetComponentId: 'a',
        kind: 'http',
      }),
    ]

    const { edges } = projectArchitecture({ components, relationships })
    expect(edges).toHaveLength(2)
    expect(edges.every((edge) => edge.data?.bundled === false)).toBe(true)
  })
})

describe('projectArchitecture — model and overlay counts', () => {
  it('keeps proposed elements out of the applied model count', () => {
    const proposal = appliedComponent({
      componentId: 'platform.proposal',
      name: 'Proposed component',
      kind: 'module',
      parentComponentId: null,
    })
    const proposalRelationship = appliedRelationship({
      relationshipId: 'r-proposal',
      sourceComponentId: 'platform.proposal',
      targetComponentId: 'platform.db',
      kind: 'dependency',
    })
    const proposalOverlay: ChangeOverlay = {
      targetKind: 'component',
      targetId: proposal.componentId,
      state: 'planned',
      presence: 'proposal',
      operation: 'add',
      contributions: [],
      agentIds: [],
      descriptor: proposal,
    }
    const relationshipOverlay: ChangeOverlay = {
      ...proposalOverlay,
      targetKind: 'relationship',
      targetId: proposalRelationship.relationshipId,
      descriptor: proposalRelationship,
    }
    const overlay: ChangeOverlayModel = {
      components: new Map(),
      relationships: new Map(),
      extraComponents: [{ component: proposal, overlay: proposalOverlay }],
      extraRelationships: [{ relationship: proposalRelationship, overlay: relationshipOverlay }],
      counts: { planned: 2, active: 0, recently_applied: 0, removed: 0 },
      total: 2,
    }

    const projection = projectArchitecture({
      components: NESTED_COMPONENTS,
      relationships: NESTED_RELATIONSHIPS,
      overlay,
    })

    expect(projection.appliedNodeCount).toBe(NESTED_COMPONENTS.length)
    expect(projection.overlayNodeCount).toBe(1)
    expect(projection.appliedEdgeCount).toBe(6)
    expect(projection.overlayEdgeCount).toBe(1)
  })
})

describe('projectArchitecture — robustness', () => {
  it('renders a component with a missing parent as a root instead of dropping it', () => {
    const components: AppliedComponent[] = [
      appliedComponent({
        componentId: 'root',
        name: 'Root',
        kind: 'system',
        parentComponentId: null,
      }),
      appliedComponent({
        componentId: 'orphan',
        name: 'Orphan',
        kind: 'service',
        parentComponentId: 'gone-in-this-snapshot',
      }),
    ]

    const { nodes, diagnostics } = projectArchitecture({ components, relationships: [] })

    expect(nodes).toHaveLength(2)
    const orphan = nodes.find((node) => node.id === 'orphan')
    expect(orphan?.parentId).toBeUndefined()
    expect(orphan?.data.depth).toBe(0)
    expect(diagnostics.orphanedParents).toEqual([
      { componentId: 'orphan', missingParentComponentId: 'gone-in-this-snapshot' },
    ])
  })

  it('breaks a hierarchy cycle deterministically instead of looping forever', () => {
    const components: AppliedComponent[] = [
      appliedComponent({ componentId: 'c-b', name: 'B', kind: 'module', parentComponentId: 'c-a' }),
      appliedComponent({ componentId: 'c-a', name: 'A', kind: 'module', parentComponentId: 'c-c' }),
      appliedComponent({ componentId: 'c-c', name: 'C', kind: 'module', parentComponentId: 'c-b' }),
      appliedComponent({
        componentId: 'c-leaf',
        name: 'Leaf',
        kind: 'module',
        parentComponentId: 'c-c',
      }),
    ]

    const { nodes, diagnostics } = projectArchitecture({ components, relationships: [] })

    // Every component is still rendered exactly once.
    expect(nodes).toHaveLength(4)
    expect(nodes.map((node) => node.id).sort()).toEqual(['c-a', 'c-b', 'c-c', 'c-leaf'])

    expect(diagnostics.hierarchyCycles).toEqual([['c-a', 'c-b', 'c-c']])

    // The alphabetically first member of the cycle is cut loose, which turns
    // the cycle into a chain and gives every node exactly one path to a root.
    const byId = new Map(nodes.map((node) => [node.id, node]))
    expect(byId.get('c-a')?.parentId).toBeUndefined()
    expect(byId.get('c-b')?.parentId).toBe('c-a')
    expect(byId.get('c-c')?.parentId).toBe('c-b')
    expect(byId.get('c-leaf')?.parentId).toBe('c-c')

    // …and the same repair happens whatever order the rows arrive in.
    const shuffled = projectArchitecture({
      components: reorder(components),
      relationships: [],
    })
    expect(shuffled.nodes.map((node) => `${node.id}<${node.parentId ?? ''}`)).toEqual(
      nodes.map((node) => `${node.id}<${node.parentId ?? ''}`),
    )
    expect(shuffled.diagnostics.hierarchyCycles).toEqual([['c-a', 'c-b', 'c-c']])
  })

  it('handles a component that is its own parent', () => {
    const components: AppliedComponent[] = [
      appliedComponent({
        componentId: 'self',
        name: 'Self',
        kind: 'module',
        parentComponentId: 'self',
      }),
    ]

    const { nodes, diagnostics } = projectArchitecture({ components, relationships: [] })

    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.parentId).toBeUndefined()
    expect(diagnostics.hierarchyCycles).toEqual([['self']])
  })

  it('drops relationships with an endpoint outside the snapshot and reports them', () => {
    const components: AppliedComponent[] = [
      appliedComponent({ componentId: 'a', name: 'A', kind: 'service', parentComponentId: null }),
    ]
    const relationships: AppliedRelationship[] = [
      appliedRelationship({
        relationshipId: 'r1',
        sourceComponentId: 'a',
        targetComponentId: 'b',
        kind: 'http',
      }),
      appliedRelationship({
        relationshipId: 'r2',
        sourceComponentId: 'z',
        targetComponentId: 'a',
        kind: 'grpc',
      }),
    ]

    const { edges, diagnostics } = projectArchitecture({ components, relationships })

    expect(edges).toHaveLength(0)
    expect(diagnostics.danglingRelationships).toEqual([
      { relationshipId: 'r1', missingComponentId: 'b', endpoint: 'target' },
      { relationshipId: 'r2', missingComponentId: 'z', endpoint: 'source' },
    ])
  })

  it('keeps the first of two components sharing an id', () => {
    const components: AppliedComponent[] = [
      appliedComponent({
        componentId: 'dup',
        name: 'First',
        kind: 'service',
        parentComponentId: null,
      }),
      appliedComponent({
        componentId: 'dup',
        name: 'Second',
        kind: 'module',
        parentComponentId: null,
      }),
    ]

    const { nodes, diagnostics } = projectArchitecture({ components, relationships: [] })

    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.data.component.name).toBe('First')
    expect(diagnostics.duplicateComponentIds).toEqual(['dup'])
  })

  it('returns an empty graph for an empty snapshot', () => {
    const projection = projectArchitecture({ components: [], relationships: [] })
    expect(projection.nodes).toEqual([])
    expect(projection.edges).toEqual([])
    expect(isProjectionClean(projection.diagnostics)).toBe(true)
  })
})
