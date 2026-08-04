import { describe, expect, it } from 'vitest'

import { WORK_STATE_BY_ID, resolveWorkState } from './workStates'

describe('resolveWorkState', () => {
  it('reports nothing when the agent reported nothing', () => {
    expect(resolveWorkState({})).toBeNull()
  })

  it('maps a planned change to "geplant"', () => {
    expect(resolveWorkState({ change: { state: 'planned', operation: 'add' } })).toBe(
      'planned',
    )
  })

  it('maps an applied change to "kürzlich angewandt"', () => {
    expect(resolveWorkState({ change: { state: 'applied', operation: 'modify' } })).toBe(
      'recently_applied',
    )
  })

  it('maps an applied removal to "entfernt"', () => {
    expect(resolveWorkState({ change: { state: 'applied', operation: 'remove' } })).toBe(
      'removed',
    )
  })

  it('prefers a running work step over a merely planned change', () => {
    expect(
      resolveWorkState({
        hasActiveWorkStep: true,
        change: { state: 'planned', operation: 'modify' },
      }),
    ).toBe('active')
  })

  it('exposes a label for every state', () => {
    for (const definition of Object.values(WORK_STATE_BY_ID)) {
      expect(definition.label.length).toBeGreaterThan(0)
    }
  })
})
