import { describe, expect, it } from 'vitest'

import { createI18n } from './createI18n'

describe('architecture count terminology', () => {
  it.each([
    ['de', 'Beziehungen innerhalb desselben eingeklappten Containers werden absichtlich nicht gezeichnet.'],
    ['en', 'Relationships whose two ends are inside the same collapsed container are intentionally not drawn.'],
  ] as const)('explains intentionally hidden internal relationships in %s', (language, sentence) => {
    const t = createI18n({ language }).getFixedT(language, 'canvas')

    expect(t('visibility.hint')).toContain(sentence)
  })

  it.each([
    ['de', '1 Modellkomponente', '2 Modellkomponenten', '1 Vorschlag', '2 Vorschläge'],
    ['en', '1 model component', '2 model components', '1 proposal', '2 proposals'],
  ] as const)('keeps model and proposal counts distinct in %s', (
    language,
    modelOne,
    modelMany,
    proposalOne,
    proposalMany,
  ) => {
    const t = createI18n({ language }).getFixedT(language, 'canvas')

    expect(t('pane.modelComponents', { count: 1 })).toBe(modelOne)
    expect(t('pane.modelComponents', { count: 2 })).toBe(modelMany)
    expect(t('pane.proposedComponents', { count: 1 })).toBe(`+ ${proposalOne}`)
    expect(t('pane.proposedComponents', { count: 2 })).toBe(`+ ${proposalMany}`)
  })

  it.each([
    [
      'de',
      '1 von 1 Element sichtbar',
      '10 von 29 Elementen sichtbar',
      '1 gemeldete Beziehung',
      '2 gemeldete Beziehungen',
      '1 Verbindung dargestellt',
      '2 Verbindungen dargestellt',
    ],
    [
      'en',
      '1 of 1 element visible',
      '10 of 29 elements visible',
      '1 reported relationship',
      '2 reported relationships',
      '1 connection rendered',
      '2 connections rendered',
    ],
  ] as const)('formats visible and rendered counts in %s', (
    language,
    one,
    many,
    relationshipOne,
    relationshipMany,
    connectionOne,
    connectionMany,
  ) => {
    const t = createI18n({ language }).getFixedT(language, 'canvas')

    expect(t('visibility.summary', { count: 1, visible: 1, total: 1 })).toBe(one)
    expect(t('visibility.summary', { count: 29, visible: 10, total: 29 })).toBe(many)
    expect(t('pane.reportedRelationships', { count: 1 })).toBe(relationshipOne)
    expect(t('pane.reportedRelationships', { count: 2 })).toBe(relationshipMany)
    expect(t('pane.renderedConnections', { count: 1 })).toBe(connectionOne)
    expect(t('pane.renderedConnections', { count: 2 })).toBe(connectionMany)
  })
})
