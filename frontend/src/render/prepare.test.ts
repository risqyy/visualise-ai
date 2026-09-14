import { describe, expect, it, vi } from 'vitest'
import { prepare, DETAILS, type Settings, type Snapshot } from './prepare'
import { layoutArchitecture } from '@/canvas/elkLayout'
import { boundedIDs, contained, intersects } from './painted'

vi.mock('@/canvas/elkLayout', async (original) => {
  const module = await original<typeof import('@/canvas/elkLayout')>()
  return { ...module, layoutArchitecture: vi.fn(module.layoutArchitecture) }
})
const settings: Settings = { viewport: { width: 800, height: 600, pixelRatio: 1 }, detailLevel: 'standard' }
function fixture(): Snapshot {
  return {
    model: {
      components: [{ componentId: 'aaa', name: 'A', kind: 'service', parentComponentId: null }, { componentId: 'bbb', name: 'B', kind: 'service', parentComponentId: null }],
      relationships: [{ relationshipId: 'a-b', sourceComponentId: 'aaa', targetComponentId: 'bbb', kind: 'dependency' }],
    },
    view: { viewId: 'all-view', name: 'All', kind: 'architecture', selection: { mode: 'all' }, orientation: 'top-down', collapsedComponentIds: [] }, viewRevision: 2,
  }
}
describe('isolated native render preparation', () => {
  it('uses exact native descriptors, ELK routes, camera and explicit detail without provenance fabrication', async () => {
    const snapshot = fixture()
    const result = await prepare(snapshot, settings)
    expect(result.nodes.map((n) => n.data.component)).toEqual(snapshot.model.components)
    expect(result.edges[0]?.data?.route?.length).toBeGreaterThan(1)
    expect(result.edges[0]?.data?.labelRatio).toBeGreaterThan(0)
    expect(result.viewport.zoom).toBe(1)
    expect(result.nodes[1]!.position.y).toBeGreaterThan(result.nodes[0]!.position.y)
    snapshot.view.orientation = 'left-to-right'
    const horizontal = await prepare(snapshot, settings)
    expect(horizontal.nodes[1]!.position.x).toBeGreaterThan(horizontal.nodes[0]!.position.x)
    expect(DETAILS).toEqual({ map: 'minimal', readable: 'overview', standard: 'standard', full: 'full' })
  })
  it('renders an empty selected scope and diagnoses missing references', async () => {
    const snapshot = fixture()
    snapshot.view.selection = { mode: 'explicit', scope: { componentIds: ['removed'], relationshipIds: [] } }
    const result = await prepare(snapshot, settings)
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
    expect(result.resolved.missingReferences.componentIds).toEqual(['removed'])
    expect(result.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
  })
  it('preserves absent ELK self-edge routes so the native self-loop fallback can paint', async () => {
    const snapshot = fixture()
    snapshot.model.relationships = [{ relationshipId: 'self-aa', sourceComponentId: 'aaa', targetComponentId: 'aaa', kind: 'dependency' }]
    const result = await prepare(snapshot, settings)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]?.data?.route).toBeUndefined()
  })
  it('reports native ELK failure rather than producing a fallback image', async () => {
    vi.mocked(layoutArchitecture).mockRejectedValueOnce(new Error('ELK rejected graph'))
    await expect(prepare(fixture(), settings)).rejects.toThrow('ELK rejected graph')
  })
  it('bounds canonical painted IDs and distinguishes intersection from full containment', () => {
    const result = boundedIDs(Array.from({ length: 201 }, (_, i) => `node-${String(i).padStart(3, '0')}`).reverse())
    expect(result.ids).toHaveLength(200)
    expect(result.ids[0]).toBe('node-000')
    expect(result.overflow).toBe(true)
    const partial = { left: -20, top: 0, right: 60, bottom: 50 }
    expect(intersects(partial, 320, 240)).toBe(true)
    expect(contained(partial, 320, 240)).toBe(false)
    expect(intersects({ left: 400, top: 0, right: 420, bottom: 50 }, 320, 240)).toBe(false)
  })
})
