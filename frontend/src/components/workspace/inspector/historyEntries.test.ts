import { describe, expect, it } from 'vitest'

import { EVENT_TYPES } from '@/api/types'
import { HISTORY_ENTRIES, historyEntry } from '@/test/inspectorFixtures'

import { translateWith } from '@/test/translate'

import { buildHistoryItems, EVENT_TYPE_LABEL_KEY } from './historyEntries'

describe('buildHistoryItems', () => {
  it('keeps every reported entry, including the ones that were taken back', () => {
    const items = buildHistoryItems(HISTORY_ENTRIES)

    expect(items).toHaveLength(HISTORY_ENTRIES.length)
    expect(items.map((item) => item.entry.serverEventId)).toEqual(
      HISTORY_ENTRIES.map((entry) => entry.serverEventId),
    )
  })

  it('marks the corrected entry without replacing it', () => {
    const items = buildHistoryItems(HISTORY_ENTRIES)
    const original = items.find((item) => item.entry.position === 10)
    const correction = items.find((item) => item.kind === 'correction')

    expect(original?.isCorrected).toBe(true)
    expect(original?.kind).toBe('reported')
    expect(original?.entry.type).toBe('feedback.published')
    expect(correction?.referencesClientEventId).toBe(original?.entry.clientEventId)
    expect(correction?.reason).toBe('Die Rundungsaussage war falsch herum formuliert.')
    expect(correction?.correctedType).toBe('feedback.published')
  })

  it('marks the retracted entry without removing it', () => {
    const items = buildHistoryItems(HISTORY_ENTRIES)
    const original = items.find((item) => item.entry.position === 11)
    const retraction = items.find((item) => item.kind === 'retraction')

    expect(original?.isRetracted).toBe(true)
    expect(original?.entry.type).toBe('diff.reported')
    expect(retraction?.referencesClientEventId).toBe(original?.entry.clientEventId)
    expect(retraction?.reason).toBe(
      'Der gemeldete Diff gehörte zu einer anderen Komponente.',
    )
  })

  it('degrades a malformed correction payload to a plain entry', () => {
    const items = buildHistoryItems([
      historyEntry({ type: 'correction.issued', payload: { nonsense: true } }),
    ])

    expect(items[0]?.kind).toBe('reported')
    expect(items[0]?.reason).toBeNull()
    expect(items[0]?.referencesClientEventId).toBeNull()
  })

  it('labels every event type of the closed catalogue, in both languages', () => {
    for (const language of ['de', 'en'] as const) {
      const t = translateWith('inspector', language)
      for (const type of EVENT_TYPES) {
        // A label that is missing from a catalogue would resolve to the key
        // itself, which still contains the dot-separated key path.
        expect(t(EVENT_TYPE_LABEL_KEY[type])).toBeTruthy()
        expect(t(EVENT_TYPE_LABEL_KEY[type])).not.toContain('eventType.')
      }
    }
  })
})
