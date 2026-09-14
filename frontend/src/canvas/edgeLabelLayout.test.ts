import { describe, expect, it } from 'vitest'

import { appliedComponent, appliedRelationship } from '@/test/architectureFixtures'
import { EDGE_LABEL_HIT_SIZE, EDGE_LABEL_MAX_WIDTH, placeEdgeLabels } from './edgeLabelLayout'
import { attachmentCrossesObstacle, nearestPointOnRoute } from './edgeLabelAttachment'
import type { LayoutPoint } from './elkLayout'
import { projectArchitecture, type ArchitectureEdge, type ArchitectureNode } from './graphProjection'

function fixture(count = 1, self = false) {
  const graph = projectArchitecture({
    components: ['source', 'target'].map((id) => appliedComponent({
      componentId: id, name: id, kind: 'service', parentComponentId: null,
    })),
    relationships: Array.from({ length: count }, (_, index) => appliedRelationship({
      relationshipId: `r${index}`, sourceComponentId: 'source',
      targetComponentId: self ? 'source' : 'target', kind: 'http',
      label: 'A very long relationship description '.repeat(50),
    })),
  })
  graph.nodes = graph.nodes.map((node, index) => ({ ...node, position: { x: 0, y: index * 450 } }))
  return graph
}

function points(result: ReadonlyMap<string, Readonly<Record<string, LayoutPoint>>>): LayoutPoint[] {
  return [...result.values()].flatMap((positions) => Object.values(positions))
}

function expectSeparate(positions: readonly LayoutPoint[], zoom: number) {
  const width = Math.max(EDGE_LABEL_MAX_WIDTH, EDGE_LABEL_MAX_WIDTH / zoom)
  const height = Math.max(EDGE_LABEL_HIT_SIZE, EDGE_LABEL_HIT_SIZE / zoom)
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const first = positions[i] as LayoutPoint
      const second = positions[j] as LayoutPoint
      expect(Math.abs(first.x - second.x) >= width || Math.abs(first.y - second.y) >= height).toBe(true)
    }
  }
}

describe('shared edge label placement', () => {
  it('keeps a short bundle count in the corridor instead of reserving a long description', () => {
    const graph = fixture(3)
    graph.nodes[0]!.position = { x: 0, y: 0 }
    graph.nodes[1]!.position = { x: 318, y: 0 }
    const edge = graph.edges[0]!
    edge.data!.route = [{ x: 228, y: 48 }, { x: 318, y: 48 }]
    const badge = placeEdgeLabels(graph.edges, graph.nodes, { detailLevel: 'standard', zoom: 1 }).get(edge.id)!.badge
    expect(badge).toEqual({ x: 273, y: 48 })
  })
  it.each(['top-down', 'left-right'] as const)('separates dense long labels for %s routes', (orientation) => {
    const graph = fixture(1)
    const template = graph.edges[0] as ArchitectureEdge
    const edges = Array.from({ length: 90 }, (_, index) => ({
      ...template, id: `edge-${index.toString().padStart(3, '0')}`,
      data: { ...template.data!, fallbackOrientation: orientation,
        route: [{ x: 0, y: 200 }, { x: 450, y: 200 }] },
    }))
    const before = structuredClone({ edges, nodes: graph.nodes })
    const first = placeEdgeLabels(edges, graph.nodes, { detailLevel: 'standard', zoom: 0.93 })
    expect(points(first)).toHaveLength(90)
    expectSeparate(points(first), 0.93)
    expect(placeEdgeLabels([...edges].reverse(), [...graph.nodes].reverse(), {
      detailLevel: 'standard', zoom: 0.93,
    })).toEqual(first)
    expect({ edges, nodes: graph.nodes }).toEqual(before)
  })

  it('enumerates only rendered labels, including expanded bundle actions', () => {
    const graph = fixture(3)
    const edge = graph.edges[0] as ArchitectureEdge
    const keys = (level: 'minimal' | 'overview' | 'standard' | 'full', expandedEdgeIds: string[] = []) =>
      Object.keys(placeEdgeLabels(graph.edges, graph.nodes, { detailLevel: level, expandedEdgeIds }).get(edge.id) ?? {})
    expect(keys('minimal', [edge.id])).toEqual(['badge'])
    expect(keys('overview')).toEqual(['badge'])
    expect(keys('standard')).toEqual(['badge'])
    expect(keys('overview', [edge.id])).toEqual(['relationship:r0', 'relationship:r1', 'relationship:r2', 'collapse'])
    expect(keys('full')).toEqual(['badge'])
    expect(keys('full', [edge.id])).toEqual(['relationship:r0', 'relationship:r1', 'relationship:r2', 'collapse'])
    const single = fixture()
    expect(placeEdgeLabels(single.edges, single.nodes, { detailLevel: 'overview' }).size).toBe(0)
  })

  it('reserves independent positions for work-state marks', () => {
    const graph = fixture(3)
    const edge = graph.edges[0] as ArchitectureEdge
    edge.data!.overlays.r0 = {
      targetKind: 'relationship', targetId: 'r0', state: 'active', presence: 'applied',
      operation: null, contributions: [], agentIds: [], descriptor: null,
    }
    const folded = placeEdgeLabels(graph.edges, graph.nodes, { detailLevel: 'standard' }).get(edge.id)!
    expect(Object.keys(folded)).toEqual(['badge', 'overlay'])
    expectSeparate(Object.values(folded), 0.93)
    const expanded = placeEdgeLabels(graph.edges, graph.nodes, { detailLevel: 'full', expandedEdgeIds: [edge.id] }).get(edge.id)!
    expect(Object.keys(expanded)).toContain('overlay:r0')
    // The compact collapse action has a smaller bound; full labels still clear.
    expectSeparate(Object.entries(expanded).filter(([key]) => key !== 'collapse').map(([, point]) => point), 0.93)
  })

  it('keeps self-loop labels outside the complete leaf box after a drag', () => {
    const graph = fixture(1, true)
    graph.nodes[0]!.position = { x: 910, y: 250 }
    const point = points(placeEdgeLabels(graph.edges, graph.nodes, { detailLevel: 'standard', zoom: 1 }))[0]!
    const node = graph.nodes[0]!
    expect(point.x + 120 <= node.position.x || point.x - 120 >= node.position.x + node.width! ||
      point.y + 22 <= node.position.y || point.y - 22 >= node.position.y + node.height!).toBe(true)
  })

  it('moves a crowded label along its own route without creating a diagonal annotation', () => {
    const graph = fixture()
    const edge = graph.edges[0]!
    const route = [{ x: 114, y: 96 }, { x: 114, y: 250 }, { x: 650, y: 250 }, { x: 650, y: 450 }]
    edge.data!.route = route
    graph.nodes[1]!.position = { x: 536, y: 450 }
    const obstruction: ArchitectureNode = {
      ...graph.nodes[0]!, id: 'obstruction', position: { x: 270, y: 200 }, width: 228, height: 96,
    }
    const result = points(placeEdgeLabels(graph.edges, [...graph.nodes, obstruction], {
      detailLevel: 'standard', zoom: 1,
    }))[0]!
    const attachment = nearestPointOnRoute(result, route)
    expect(result).toEqual(attachment)
    expect(result.y).toBeLessThan(450)
    expect(attachmentCrossesObstacle(result, attachment, {
      left: 270, right: 498, top: 200, bottom: 296,
    })).toBe(false)
  })

  it('keeps displaced labels attached through free space instead of crossing a source node', () => {
    const graph = fixture()
    const edge = graph.edges[0]!
    const route = [{ x: 114, y: 96 }, { x: 114, y: 150 }, { x: 400, y: 150 }, { x: 400, y: 450 }]
    edge.data!.route = route
    // Several labels compete for the same short source/target corridor.
    const edges = Array.from({ length: 12 }, (_, index) => ({ ...edge, id: `edge-${index}` }))
    const result = placeEdgeLabels(edges, graph.nodes, { detailLevel: 'standard', zoom: 1 })
    expectSeparate(points(result), 1)
    expect(points(result).some((point) => {
      const attachment = nearestPointOnRoute(point, route)
      return point.x !== attachment.x || point.y !== attachment.y
    })).toBe(true)
    for (const point of points(result)) {
      const attachment = nearestPointOnRoute(point, route)
      expect(attachmentCrossesObstacle(point, attachment, { left: 0, right: 228, top: 0, bottom: 96 })).toBe(false)
      expect(attachmentCrossesObstacle(point, attachment, { left: 0, right: 228, top: 450, bottom: 546 })).toBe(false)
    }
  })

  it('resolves nested coordinates and avoids container titles while using their interior', () => {
    const graph = fixture()
    const leaf = graph.nodes[0]!
    const container: ArchitectureNode = {
      ...leaf, id: 'container', position: { x: 1000, y: 1000 }, width: 2000, height: 1600,
      data: { ...leaf.data, isCompound: true },
    }
    const source = { ...leaf, parentId: 'container', position: { x: 100, y: 100 } }
    const target = { ...graph.nodes[1]!, parentId: 'container', position: { x: 100, y: 550 } }
    const nodes = [target, source, container]
    const result = points(placeEdgeLabels(graph.edges, nodes, { detailLevel: 'standard', zoom: 1 }))[0]!
    expect(result.x).toBeGreaterThan(1000)
    expect(result.y - 22).toBeGreaterThanOrEqual(1040)
    expect(result.y).toBeLessThan(2600)
    expect(result.y - 22).toBeGreaterThan(source.position.y + 1000 + source.height!)
    expect(result.y + 22).toBeLessThan(target.position.y + 1000)
  })

  it('avoids collapsed container contents and updates at map zoom without stale positions', () => {
    const graph = fixture()
    const edge = graph.edges[0]!
    edge.data!.route = [{ x: 110, y: 4 }, { x: 110, y: 92 }]
    graph.nodes[0]!.data.isCompound = true
    graph.nodes[0]!.data.collapsed = true
    const placed = points(placeEdgeLabels(graph.edges, graph.nodes, { detailLevel: 'standard', zoom: 1 }))[0]!
    expect(placed.x - 120 >= 228 || placed.x + 120 <= 0 || placed.y - 22 >= 96 || placed.y + 22 <= 0).toBe(true)
    const bundle = fixture(3)
    const map = placeEdgeLabels(bundle.edges, bundle.nodes, { detailLevel: 'minimal', zoom: 0.2 })
    expect(points(map)).toHaveLength(1)
    expect(placeEdgeLabels([], bundle.nodes, { detailLevel: 'standard' }).size).toBe(0)
  })
})
