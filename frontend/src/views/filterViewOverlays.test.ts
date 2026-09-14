import { expect, it } from 'vitest'

import type { SavedView } from '@/api/types'
import { EMPTY_OVERLAY_MODEL, type ChangeOverlay } from '@/canvas/changeOverlays'
import { component } from '@/test/fixtures'

import { filterViewOverlays } from './filterViewOverlays'

it('keeps ancestors structural and bounds proposals and ghosts while retaining shared evidence', () => {
  const view: SavedView = { viewId: 'detail', name: 'Detail', kind: 'architecture', orientation: 'top-down', collapsedComponentIds: [], selection: { mode: 'explicit', scope: { componentIds: ['inside', 'removed'], relationshipIds: ['edge-ok', 'edge-boundary'] } } }
  const mark: ChangeOverlay = { targetKind: 'component', targetId: 'inside', state: 'active', presence: 'proposal', operation: 'add', contributions: [], agentIds: [], descriptor: null }
  const evidence = new Map([['component:outside', []]])
  const overlay = { ...EMPTY_OVERLAY_MODEL, evidence,
    components: new Map(['ancestor', 'inside', 'outside'].map((id) => [id, mark])),
    extraComponents: ['removed', 'outside'].map((id) => ({ component: component({ componentId: id }), overlay: mark })),
    extraRelationships: [
      { relationshipId: 'edge-ok', sourceComponentId: 'inside', targetComponentId: 'removed', kind: 'dependency' as const },
      { relationshipId: 'edge-boundary', sourceComponentId: 'inside', targetComponentId: 'ancestor', kind: 'dependency' as const },
      { relationshipId: 'unselected', sourceComponentId: 'inside', targetComponentId: 'removed', kind: 'dependency' as const },
    ].map((relationship) => ({ relationship, overlay: mark })),
  }
  const result = filterViewOverlays(overlay, view, ['ancestor', 'inside'], [])
  expect([...result.components.keys()]).toEqual(['ancestor', 'inside'])
  expect(result.extraComponents.map((entry) => entry.component.componentId)).toEqual(['removed'])
  expect(result.extraRelationships.map((entry) => entry.relationship.relationshipId)).toEqual(['edge-ok'])
  expect(result.evidence).toBe(evidence)
  expect(result.counts.active).toBe(4)
  expect(result.total).toBe(4)
  expect(filterViewOverlays(overlay, { ...view, selection: { mode: 'all' } }, [], [])).toBe(overlay)
})
