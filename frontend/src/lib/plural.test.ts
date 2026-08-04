import { describe, expect, it } from 'vitest'

import { COUNT_LABELS, counted, pluralise } from './plural'

describe('German count labels', () => {
  it('uses the singular for exactly one', () => {
    expect(counted(1, COUNT_LABELS.plan)).toBe('1 Plan')
    expect(counted(1, COUNT_LABELS.risk)).toBe('1 Risiko')
    expect(counted(1, COUNT_LABELS.child)).toBe('1 Kind')
    expect(counted(1, COUNT_LABELS.diff)).toBe('1 Diff')
    expect(counted(1, COUNT_LABELS.agent)).toBe('1 Agent')
    expect(counted(1, COUNT_LABELS.workStep)).toBe('1 Arbeitsschritt')
  })

  it('uses the plural for zero, which German treats like many', () => {
    expect(counted(0, COUNT_LABELS.plan)).toBe('0 Pläne')
    expect(counted(0, COUNT_LABELS.risk)).toBe('0 Risiken')
    expect(counted(0, COUNT_LABELS.problem)).toBe('0 Probleme')
  })

  it('uses the plural for more than one', () => {
    expect(counted(2, COUNT_LABELS.plan)).toBe('2 Pläne')
    expect(counted(13, COUNT_LABELS.workStep)).toBe('13 Arbeitsschritte')
    expect(counted(28, COUNT_LABELS.component)).toBe('28 Komponenten')
  })

  it('leaves nouns whose German plural equals the singular alone', () => {
    expect(counted(1, COUNT_LABELS.feedback)).toBe('1 Feedback')
    expect(counted(7, COUNT_LABELS.feedback)).toBe('7 Feedback')
  })

  it('pluralise returns the word without the number', () => {
    expect(pluralise(1, COUNT_LABELS.relationship)).toBe('Beziehung')
    expect(pluralise(37, COUNT_LABELS.relationship)).toBe('Beziehungen')
  })
})
