import { describe, expect, it } from 'vitest'

import {
  NESTED_COMPONENTS,
  NESTED_RELATIONSHIPS,
  reorder,
} from '@/test/architectureFixtures'

import { buildElkGraph, describeLayout, layoutArchitecture } from './elkLayout'
import { projectArchitecture } from './graphProjection'

const model = { components: NESTED_COMPONENTS, relationships: NESTED_RELATIONSHIPS }

/** ELK is a real solver; a nested model of this size needs a moment. */
const LAYOUT_TIMEOUT = 30_000

describe('ELK layered layout', () => {
  it(
    'is deterministic: laying out the same model twice gives identical positions',
    async () => {
      const projection = projectArchitecture(model)

      const first = await layoutArchitecture(projection.nodes, projection.edges, {
        direction: 'RIGHT',
      })
      const second = await layoutArchitecture(projection.nodes, projection.edges, {
        direction: 'RIGHT',
      })

      expect(describeLayout(second)).toBe(describeLayout(first))
      expect(second.nodes.map((node) => node.position)).toEqual(
        first.nodes.map((node) => node.position),
      )
      expect(second.bounds).toEqual(first.bounds)
      expect(second.routes).toEqual(first.routes)
    },
    LAYOUT_TIMEOUT,
  )

  it(
    'is independent of the order of the input lists',
    async () => {
      const straight = projectArchitecture(model)
      const shuffled = projectArchitecture({
        components: reorder(NESTED_COMPONENTS),
        relationships: reorder(NESTED_RELATIONSHIPS),
      })

      const fromStraight = await layoutArchitecture(straight.nodes, straight.edges, {
        direction: 'RIGHT',
      })
      const fromShuffled = await layoutArchitecture(shuffled.nodes, shuffled.edges, {
        direction: 'RIGHT',
      })

      expect(describeLayout(fromShuffled)).toBe(describeLayout(fromStraight))
      expect(fromShuffled.routes).toEqual(fromStraight.routes)
    },
    LAYOUT_TIMEOUT,
  )

  it(
    'is also independent of the order the layout function is handed the arrays in',
    async () => {
      const projection = projectArchitecture(model)

      const straight = await layoutArchitecture(projection.nodes, projection.edges, {
        direction: 'RIGHT',
      })
      const reversed = await layoutArchitecture(
        // Reversing the node array would break React Flow's parent-before-child
        // rule, so the layout has to re-derive the hierarchy itself — which it
        // does, from `parentId` rather than from the array order.
        [...projection.nodes].reverse(),
        [...projection.edges].reverse(),
        { direction: 'RIGHT' },
      )

      const straightById = new Map(straight.nodes.map((node) => [node.id, node.position]))
      for (const node of reversed.nodes) {
        expect(node.position).toEqual(straightById.get(node.id))
      }
    },
    LAYOUT_TIMEOUT,
  )

  it(
    'places children inside their container and gives containers a real size',
    async () => {
      const projection = projectArchitecture(model)
      const { nodes } = await layoutArchitecture(projection.nodes, projection.edges, {
        direction: 'RIGHT',
      })
      const byId = new Map(nodes.map((node) => [node.id, node]))

      const container = byId.get('platform.api.http')
      const child = byId.get('platform.api.http.router')
      expect(container).toBeDefined()
      expect(child).toBeDefined()

      // A container is grown by ELK beyond the minimum it started with.
      expect(container?.width ?? 0).toBeGreaterThan(0)
      expect(container?.height ?? 0).toBeGreaterThan(0)

      // React Flow expects a child position relative to its parent, and
      // `extent: 'parent'` requires it to be inside the parent's box.
      expect(child?.position.x ?? -1).toBeGreaterThanOrEqual(0)
      expect(child?.position.y ?? -1).toBeGreaterThanOrEqual(0)
      expect((child?.position.x ?? 0) + (child?.width ?? 0)).toBeLessThanOrEqual(
        container?.width ?? 0,
      )
      expect((child?.position.y ?? 0) + (child?.height ?? 0)).toBeLessThanOrEqual(
        container?.height ?? 0,
      )
    },
    LAYOUT_TIMEOUT,
  )

  it(
    'routes every edge from the source handle to the target handle',
    async () => {
      const projection = projectArchitecture(model)
      const layout = await layoutArchitecture(projection.nodes, projection.edges, {
        direction: 'RIGHT',
      })

      expect(layout.nodes.map((node) => node.id)).toEqual(
        projection.nodes.map((node) => node.id),
      )

      const byId = new Map(layout.nodes.map((node) => [node.id, node]))
      /** Absolute position of a node; React Flow stores children relative. */
      const absolute = (id: string): { x: number; y: number } => {
        let x = 0
        let y = 0
        let current = byId.get(id)
        const guard = new Set<string>()
        while (current && !guard.has(current.id)) {
          guard.add(current.id)
          x += current.position.x
          y += current.position.y
          current = current.parentId ? byId.get(current.parentId) : undefined
        }
        return { x, y }
      }

      for (const edge of projection.edges) {
        const route = layout.routes[edge.id]
        expect(route, `route for ${edge.id}`).toBeDefined()
        const points = route ?? []
        expect(points.length).toBeGreaterThanOrEqual(2)

        const source = byId.get(edge.source)
        const target = byId.get(edge.target)
        const sourceOrigin = absolute(edge.source)
        const targetOrigin = absolute(edge.target)

        // Outgoing handle: right border, vertically centred. Incoming handle:
        // left border, vertically centred. ELK's ports sit on exactly those
        // points, so a route that does not start and end there would be drawn
        // detached from its nodes — which is what happens if the coordinates of
        // a nested edge are not shifted by their common ancestor.
        const start = points[0]
        const end = points[points.length - 1]
        const expectedStart = {
          x: sourceOrigin.x + (source?.width ?? 0),
          y: sourceOrigin.y + (source?.height ?? 0) / 2,
        }
        const expectedEnd = {
          x: targetOrigin.x,
          y: targetOrigin.y + (target?.height ?? 0) / 2,
        }

        // One pixel of tolerance: the ELK ports are 1 × 1, not points.
        expect(Math.abs((start?.x ?? 0) - expectedStart.x), edge.id).toBeLessThanOrEqual(1)
        expect(Math.abs((start?.y ?? 0) - expectedStart.y), edge.id).toBeLessThanOrEqual(1)
        expect(Math.abs((end?.x ?? 0) - expectedEnd.x), edge.id).toBeLessThanOrEqual(1)
        expect(Math.abs((end?.y ?? 0) - expectedEnd.y), edge.id).toBeLessThanOrEqual(1)
      }
    },
    LAYOUT_TIMEOUT,
  )

  it('sorts the graph it hands to ELK and drops self references', () => {
    const projection = projectArchitecture(model)
    const graph = buildElkGraph(
      [...projection.nodes].reverse(),
      [...projection.edges].reverse(),
      { direction: 'RIGHT' },
    )

    expect(graph.children?.map((child) => child.id)).toEqual(['external.payments', 'platform'])
    expect(graph.edges?.map((edge) => edge.id)).toEqual(
      [...projection.edges.map((edge) => edge.id)].sort(),
    )

    // Ports sit exactly where React Flow draws the handles.
    const platform = graph.children?.find((child) => child.id === 'platform')
    expect(platform?.ports?.map((port) => port.id)).toEqual([
      'platform:in',
      'platform:out',
    ])
    expect(platform?.layoutOptions?.['elk.portConstraints']).toBe('FIXED_POS')
  })

  it('lays out an empty model without calling ELK', async () => {
    const layout = await layoutArchitecture([], [])
    expect(layout).toEqual({ nodes: [], routes: {}, bounds: { width: 0, height: 0 } })
  })

  it(
    'uses top-down ports and routes when no direction override is supplied',
    async () => {
      const projection = projectArchitecture(model, 'top-down')
      const graph = buildElkGraph(projection.nodes, projection.edges)
      const platform = graph.children?.find((child) => child.id === 'platform')

      expect(graph.layoutOptions?.['elk.direction']).toBe('DOWN')
      expect(platform?.ports?.map((port) => port.layoutOptions?.['elk.port.side'])).toEqual([
        'NORTH',
        'SOUTH',
      ])

      const layout = await layoutArchitecture(projection.nodes, projection.edges)
      const byId = new Map(layout.nodes.map((node) => [node.id, node]))
      const absolute = (id: string): { x: number; y: number } => {
        let x = 0
        let y = 0
        let current = byId.get(id)
        const guard = new Set<string>()
        while (current && !guard.has(current.id)) {
          guard.add(current.id)
          x += current.position.x
          y += current.position.y
          current = current.parentId ? byId.get(current.parentId) : undefined
        }
        return { x, y }
      }
      for (const edge of projection.edges) {
        const route = layout.routes[edge.id]
        expect(route, `route for ${edge.id}`).toBeDefined()
        const source = byId.get(edge.source)
        const target = byId.get(edge.target)
        const sourceOrigin = absolute(edge.source)
        const targetOrigin = absolute(edge.target)
        const start = route?.[0]
        const end = route?.[route.length - 1]
        expect(Math.abs((start?.x ?? 0) - (sourceOrigin.x + (source?.width ?? 0) / 2))).toBeLessThanOrEqual(1)
        expect(Math.abs((start?.y ?? 0) - (sourceOrigin.y + (source?.height ?? 0)))).toBeLessThanOrEqual(1)
        expect(Math.abs((end?.x ?? 0) - (targetOrigin.x + (target?.width ?? 0) / 2))).toBeLessThanOrEqual(1)
        expect(Math.abs((end?.y ?? 0) - targetOrigin.y)).toBeLessThanOrEqual(1)
      }
    },
    LAYOUT_TIMEOUT,
  )

  it(
    'keeps top-down layouts stable across repeated and permuted solves',
    async () => {
      const projection = projectArchitecture(model, 'top-down')

      const first = await layoutArchitecture(projection.nodes, projection.edges)
      const second = await layoutArchitecture(projection.nodes, projection.edges)
      const fromPermuted = await layoutArchitecture(
        reorder(projection.nodes),
        reorder(projection.edges),
      )

      expect(describeLayout(second)).toBe(describeLayout(first))
      expect(second.routes).toEqual(first.routes)
      const firstById = new Map(first.nodes.map((node) => [node.id, node.position]))
      for (const node of fromPermuted.nodes) {
        expect(node.position).toEqual(firstById.get(node.id))
      }
      expect(fromPermuted.routes).toEqual(first.routes)
    },
    LAYOUT_TIMEOUT,
  )
})
