import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { AppliedComponent, Component, Relationship, SavedView } from '@/api/types'
import { projectArchitecture } from '@/canvas/graphProjection'

import { resolveArchitectureView } from './resolveArchitectureView'

interface Fixture {
  name: string
  model: { components: Component[]; relationships: Relationship[] }
  view: SavedView
  expected: Record<string, unknown>
}
const fixtures = JSON.parse(readFileSync('../api/examples/model-view-mcp/view-resolution.json', 'utf8')) as Fixture[]

describe('shared architecture view resolution', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const { model, ...diagnostics } = resolveArchitectureView(fixture.model, fixture.view)
      expect({ ...diagnostics, componentIds: model.components.map((c) => c.componentId), relationshipIds: model.relationships.map((r) => r.relationshipId) }).toEqual(fixture.expected)
      for (const component of model.components) expect(fixture.model.components).toContain(component)
      for (const relationship of model.relationships) expect(fixture.model.relationships).toContain(relationship)
      // Raw descriptors flow into the actual projection without fabricated provenance.
      expect(() => projectArchitecture(model)).not.toThrow()
    })
  }
  it('preserves applied descriptor provenance and the input arrays', () => {
    const component = { componentId: 'node-aa', name: 'A', kind: 'service', parentComponentId: null, appliedByAgentId: 'agent-aa', position: 9 } as AppliedComponent
    const components = Object.freeze([Object.freeze(component)])
    const resolved = resolveArchitectureView({ components, relationships: [] }, { viewId: 'all-view', name: 'All', kind: 'architecture', selection: { mode: 'all' }, orientation: 'top-down', collapsedComponentIds: [] })
    expect(resolved.model.components[0]).toBe(component)
    expect(resolved.model.components[0]?.appliedByAgentId).toBe('agent-aa')
  })
})
