import { describe, expect, it } from 'vitest'

import { MISSING_KEY_PREFIX } from '@/i18n'
import { translateWith } from '@/test/translate'

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

  it('shows nothing for a retracted change — the agent withdrew it', () => {
    expect(resolveWorkState({ change: { state: 'retracted', operation: 'add' } })).toBeNull()
    expect(
      resolveWorkState({ change: { state: 'retracted', operation: 'remove' } }),
    ).toBeNull()
  })

  it('still reports a running work step when the change was retracted', () => {
    expect(
      resolveWorkState({
        hasActiveWorkStep: true,
        change: { state: 'retracted', operation: 'modify' },
      }),
    ).toBe('active')
  })

  it('prefers a running work step over a merely planned change', () => {
    expect(
      resolveWorkState({
        hasActiveWorkStep: true,
        change: { state: 'planned', operation: 'modify' },
      }),
    ).toBe('active')
  })

  it('exposes a label for every state, in both languages', () => {
    // The label is the colour-independent channel, so it may not be missing in
    // either catalogue — and a bare key would not be a label.
    for (const language of ['de', 'en'] as const) {
      const t = translateWith('canvas', language)
      for (const definition of Object.values(WORK_STATE_BY_ID)) {
        const label = t(definition.labelKey)
        expect(label.length).toBeGreaterThan(0)
        expect(label).not.toContain(MISSING_KEY_PREFIX)
      }
    }
  })
})
