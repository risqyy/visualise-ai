import { describe, expect, it } from 'vitest'
import { appliedComponent, appliedRelationship, NESTED_COMPONENTS, NESTED_RELATIONSHIPS } from '@/test/architectureFixtures'
import { absoluteNodeBoxes, architectureObstacles, routeArchitectureEdges, segmentIntersectsBox } from './obstacleRouting'
import { projectArchitecture, type ArchitectureEdge, type ArchitectureNode } from './graphProjection'
import { layoutArchitecture } from './elkLayout'
import type { GraphOrientation } from './graphOrientation'

function fixture(orientation: GraphOrientation = 'top-down', count = 1, self = false) {
  const graph = projectArchitecture({
    components: ['source', 'target', 'obstacle'].map((id) => appliedComponent({
      componentId: id, name: id, kind: 'service', parentComponentId: null,
    })),
    relationships: Array.from({ length: count }, (_, index) => appliedRelationship({
      relationshipId: `relation-${index}`, sourceComponentId: 'source', targetComponentId: self ? 'source' : 'target', kind: 'http',
    })),
  }, orientation)
  const positions = { source: { x: 0, y: 0 }, target: { x: 0, y: 500 }, obstacle: { x: 0, y: 240 } }
  graph.nodes = graph.nodes.map((node) => ({ ...node, position: positions[node.id as keyof typeof positions] }))
  return graph
}

function paintedRoutes(edges: ArchitectureEdge[]) {
  return edges.flatMap((edge) => Object.keys(edge.data?.memberRoutes ?? {}).length
    ? Object.values(edge.data!.memberRoutes!) : [edge.data!.route!])
}

function assertClear(edges: ArchitectureEdge[], nodes: ArchitectureNode[]) {
  for (const route of paintedRoutes(edges)) {
    expect(route.length).toBeGreaterThan(1)
    for (let index = 1; index < route.length; index++) {
      const a = route[index - 1]!, b = route[index]!
      expect(a.x === b.x || a.y === b.y, JSON.stringify(route)).toBe(true)
      // No exemption for endpoint bodies: only their boundary may be touched.
      for (const box of architectureObstacles(nodes)) {
        // ELK's 1x1 target ports can extend .5px into the owning border.
        const interior = { left: box.left + 1, right: box.right - 1, top: box.top + 1, bottom: box.bottom - 1 }
        expect(segmentIntersectsBox(a, b, interior), `${box.id}: ${JSON.stringify(route)}`).toBe(false)
      }
    }
  }
}

describe('obstacle-aware architecture routing', () => {
  it.each(['top-down', 'left-right'] as const)('routes missing and stale paths around bodies in %s', (orientation) => {
    const graph = fixture(orientation)
    if (orientation === 'left-right') {
      graph.nodes = graph.nodes.map((node) => ({ ...node, position: { x: node.position.y * 1.6, y: 0 } }))
    }
    const result = routeArchitectureEdges(graph.edges, graph.nodes)
    assertClear(result, graph.nodes)
    const source = absoluteNodeBoxes(graph.nodes).get('source')!
    expect(result[0]!.data!.route![0]).toEqual(orientation === 'top-down'
      ? { x: (source.left + source.right) / 2, y: source.bottom }
      : { x: source.right, y: (source.top + source.bottom) / 2 })
  })

  it('invalidates a safe route when an unrelated component moves into its corridor', () => {
    const graph = fixture()
    const beforeNodes = graph.nodes.map((node) => node.id === 'obstacle' ? { ...node, position: { x: 700, y: 240 } } : node)
    const before = routeArchitectureEdges(graph.edges, beforeNodes)
    const after = routeArchitectureEdges(before, graph.nodes)
    expect(after[0]!.data!.route).not.toEqual(before[0]!.data!.route)
    assertClear(after, graph.nodes)
  })

  it.each(['top-down', 'left-right'] as const)('keeps expanded member paths outside neighbouring bodies in %s', (orientation) => {
    const graph = fixture(orientation, 5)
    graph.nodes = graph.nodes.map((node) => node.id === 'obstacle'
      ? { ...node, position: orientation === 'top-down' ? { x: 140, y: 220 } : { x: 340, y: 75 } }
      : node.id === 'target' && orientation === 'left-right' ? { ...node, position: { x: 750, y: 0 } } : node)
    const result = routeArchitectureEdges(graph.edges, graph.nodes, { expandedEdgeIds: [graph.edges[0]!.id] })
    assertClear(result, graph.nodes)
    expect(Object.keys(result[0]!.data!.memberRoutes!)).toHaveLength(5)
    expect(new Set(paintedRoutes(result).map((route) => JSON.stringify(route))).size).toBe(5)
    for (const route of paintedRoutes(result)) {
      expect(route[0]).toEqual(result[0]!.data!.route![0])
      expect(route.at(-1)).toEqual(result[0]!.data!.route!.at(-1))
    }
  })

  it.each(['top-down', 'left-right'] as const)('keeps self-loops out of their own and adjacent bodies in %s', (orientation) => {
    const graph = fixture(orientation, 3, true)
    graph.nodes = graph.nodes.map((node) => node.id === 'obstacle' ? { ...node, position: { x: 250, y: 0 } } : node)
    const result = routeArchitectureEdges(graph.edges, graph.nodes, { expandedEdgeIds: [graph.edges[0]!.id] })
    assertClear(result, graph.nodes)
    expect(Object.keys(result[0]!.data!.memberRoutes!)).toHaveLength(3)
  })

  it('resolves moved ancestor coordinates and preserves immutable, deterministic input', () => {
    const graph = fixture()
    const parent = { ...graph.nodes[0]!, id: 'parent', position: { x: 500, y: 100 }, width: 350, height: 600,
      data: { ...graph.nodes[0]!.data, isCompound: true } }
    graph.nodes = [parent, ...graph.nodes.map((node) => ({ ...node, parentId: 'parent' }))]
    const before = structuredClone(graph)
    const result = routeArchitectureEdges(graph.edges, graph.nodes)
    const permuted = routeArchitectureEdges([...graph.edges].reverse(), [...graph.nodes].reverse())
    expect(permuted).toEqual([...result].reverse())
    expect(graph).toEqual(before)
    expect(result[0]!.data!.route![0]).toEqual({ x: 614, y: 196 })
    assertClear(result, graph.nodes)
  })

  it('replaces a shared middle lane with a distinct route where space permits', () => {
    const graph = fixture('left-right', 3)
    graph.nodes = graph.nodes.filter((node) => node.id !== 'obstacle').map((node) => node.id === 'target'
      ? { ...node, position: { x: 900, y: 0 } } : node)
    const result = routeArchitectureEdges(graph.edges, graph.nodes, { expandedEdgeIds: [graph.edges[0]!.id] })
    const paths = paintedRoutes(result)
    expect(new Set(paths.map((route) => JSON.stringify(route))).size).toBe(3)
    assertClear(result, graph.nodes)
  })

  it('uses a narrow port approach below a compound title without crossing its text', () => {
    const graph = fixture()
    const parent = { ...graph.nodes[0]!, id: 'parent', position: { x: 0, y: 400 }, width: 600, height: 300,
      data: { ...graph.nodes[0]!.data, isCompound: true } }
    graph.nodes = [parent, ...graph.nodes.filter((node) => node.id !== 'obstacle').map((node) => node.id === 'target'
      ? { ...node, parentId: 'parent', position: { x: 100, y: 52 } } : node)]
    const result = routeArchitectureEdges(graph.edges, graph.nodes)
    assertClear(result, graph.nodes)
    expect(result[0]!.data!.routeCornerRadius).toBe(2)
  })

  it('stores opaque relationship IDs as own route entries without prototype lookups', () => {
    const graph = fixture('top-down', 3)
    const ids = ['__proto__', 'constructor', 'toString']
    graph.edges[0]!.data!.relationships = graph.edges[0]!.data!.relationships.map((relationship, index) => ({
      ...relationship, relationshipId: ids[index]!,
    }))
    const expanded = routeArchitectureEdges(graph.edges, graph.nodes, { expandedEdgeIds: [graph.edges[0]!.id] })
    const routes = expanded[0]!.data!.memberRoutes!
    expect(Object.getPrototypeOf(routes)).toBeNull()
    expect(Object.keys(routes).sort()).toEqual([...ids].sort())
    for (const id of ids) {
      expect(Object.hasOwn(routes, id)).toBe(true)
      expect(Array.isArray(routes[id])).toBe(true)
    }
    assertClear(expanded, graph.nodes)
    const folded = routeArchitectureEdges(graph.edges, graph.nodes)[0]!.data!.memberRoutes!
    for (const id of ids) expect(folded[id]).toBeUndefined()
  })

  it('removes avoidable crossings from otherwise obstacle-free preferred routes', () => {
    const graph = projectArchitecture({
      components: ['a', 'b', 'c', 'd'].map((id) => appliedComponent({ componentId: id, name: id, kind: 'service', parentComponentId: null })),
      relationships: [['a', 'b'], ['c', 'd']].map(([source, target]) => appliedRelationship({
        relationshipId: `${source}-${target}`, sourceComponentId: source!, targetComponentId: target!, kind: 'http',
      })),
    }, 'left-right')
    const positions = { a: { x: 0, y: 0 }, b: { x: 600, y: 0 }, c: { x: 300, y: -200 }, d: { x: 600, y: -200 } }
    graph.nodes = graph.nodes.map((node) => ({ ...node, position: positions[node.id as keyof typeof positions] }))
    const crossing = graph.edges.find((edge) => edge.source === 'c')!
    crossing.data!.route = [{ x: 528, y: -152 }, { x: 560, y: -152 }, { x: 560, y: 80 },
      { x: 580, y: 80 }, { x: 580, y: -152 }, { x: 600, y: -152 }]
    const result = routeArchitectureEdges(graph.edges, graph.nodes)
    expect(result.find((edge) => edge.source === 'c')!.data!.route).toEqual([{ x: 528, y: -152 }, { x: 600, y: -152 }])
    assertClear(result, graph.nodes)
  })

  it.each(['top-down', 'left-right'] as const)('validates real nested ELK output and compound headers in %s', async (orientation) => {
    const graph = projectArchitecture({ components: NESTED_COMPONENTS, relationships: NESTED_RELATIONSHIPS }, orientation)
    const layout = await layoutArchitecture(graph.nodes, graph.edges, { direction: orientation === 'top-down' ? 'DOWN' : 'RIGHT' })
    const seeded = graph.edges.map((edge) => ({ ...edge, data: { ...edge.data!, route: layout.routes[edge.id] ?? [] } }))
    const result = routeArchitectureEdges(seeded, layout.nodes, { expandedEdgeIds: seeded.map((edge) => edge.id) })
    assertClear(result, layout.nodes)
    const moved = layout.nodes.map((node) => !node.parentId ? { ...node, position: { x: node.position.x + 300, y: node.position.y + 90 } } : node)
    const after = routeArchitectureEdges(result, moved, { expandedEdgeIds: seeded.map((edge) => edge.id) })
    assertClear(after, moved)
  }, 30_000)

  it('measures a dense inventory without letting unrelated distant nodes enlarge local search grids', () => {
    const graph = fixture()
    const template = graph.nodes.find((node) => node.id === 'obstacle')!
    const nodes = [...graph.nodes, ...Array.from({ length: 200 }, (_, index) => ({ ...template, id: `distant-${index}`,
      position: { x: 2000 + (index % 20) * 300, y: Math.floor(index / 20) * 160 } }))]
    const start = performance.now()
    const result = routeArchitectureEdges(graph.edges, nodes)
    const elapsed = performance.now() - start
    console.info(`Routing 203 components / blocked path: ${elapsed.toFixed(1)}ms`)
    assertClear(result, nodes)
  })
})
