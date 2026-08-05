import type { i18n } from 'i18next'
import { describe, expect, it } from 'vitest'

import { createI18n } from './createI18n'
import {
  formatNumber,
  formatPercent,
  formatRelativeInstant,
  formatReportedInstant,
  readReportedInstant,
  resolveFormattingLanguage,
} from './formatting'
import type { Language } from './languages'

/**
 * The formatting service, in both languages.
 *
 * German renders a percentage with a non-breaking space and English without one,
 * so the expectations below write that space as the escape `\u00a0` rather than
 * as a character that looks like a space in an editor and is not one in the DOM.
 */

const INSTANT = '2026-08-04T09:12:00Z'
/** `2026-08-04T09:12:00Z` plus three minutes, as the reader's clock. */
const NOW = Date.parse('2026-08-04T09:15:00Z')

function translatorFor(language: Language): i18n['t'] {
  return createI18n({ language, dev: false }).t
}

// ---------------------------------------------------------------------------
// Plurals — the replacement for the hand-written German table in lib/plural.ts
// ---------------------------------------------------------------------------

describe('counted nouns', () => {
  it('is grammatically correct for zero, one and many in German', () => {
    const t = translatorFor('de')

    expect(t('common:count.plan', { count: 0 })).toBe('0 Pläne')
    expect(t('common:count.plan', { count: 1 })).toBe('1 Plan')
    expect(t('common:count.plan', { count: 2 })).toBe('2 Pläne')

    expect(t('common:count.risk', { count: 1 })).toBe('1 Risiko')
    expect(t('common:count.risk', { count: 3 })).toBe('3 Risiken')
    expect(t('common:count.child', { count: 1 })).toBe('1 Kind')
    expect(t('common:count.child', { count: 4 })).toBe('4 Kinder')
    expect(t('common:count.workStep', { count: 13 })).toBe('13 Arbeitsschritte')
  })

  it('is grammatically correct for zero, one and many in English', () => {
    const t = translatorFor('en')

    expect(t('common:count.plan', { count: 0 })).toBe('0 plans')
    expect(t('common:count.plan', { count: 1 })).toBe('1 plan')
    expect(t('common:count.plan', { count: 2 })).toBe('2 plans')

    expect(t('common:count.risk', { count: 1 })).toBe('1 risk')
    expect(t('common:count.risk', { count: 3 })).toBe('3 risks')
    expect(t('common:count.child', { count: 1 })).toBe('1 child')
    expect(t('common:count.child', { count: 4 })).toBe('4 children')
    expect(t('common:count.workStep', { count: 13 })).toBe('13 work steps')
  })

  it('leaves a noun whose German plural equals its singular alone', () => {
    const de = translatorFor('de')
    expect(de('common:count.feedback', { count: 1 })).toBe('1 Feedback')
    expect(de('common:count.feedback', { count: 7 })).toBe('7 Feedback')

    // English does form one, and the catalogue is free to say so: the two
    // languages share a key, not a grammar.
    const en = translatorFor('en')
    expect(en('common:count.feedback', { count: 1 })).toBe('1 feedback entry')
    expect(en('common:count.feedback', { count: 7 })).toBe('7 feedback entries')
  })

  it('formats the counter itself in the reader language', () => {
    expect(translatorFor('de')('common:count.component', { count: 1234 })).toBe(
      '1.234 Komponenten',
    )
    expect(translatorFor('en')('common:count.component', { count: 1234 })).toBe(
      '1,234 components',
    )
  })
})

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

describe('reported instants', () => {
  it('renders the same instant as UTC, labelled, in both languages', () => {
    const german = readReportedInstant(INSTANT, 'de')
    const english = readReportedInstant(INSTANT, 'en')

    expect(german.absolute).toBe('04.08.2026, 09:12:00 UTC')
    expect(english.absolute).toBe('04/08/2026, 09:12:00 UTC')

    // The point of the acceptance criterion: whatever the language does to the
    // separators, the zone is named and it is UTC.
    for (const rendered of [german.absolute, english.absolute]) {
      expect(rendered).toContain('UTC')
    }
  })

  it('shows the reported UTC clock time and never the reader local time', () => {
    // A zone that is deliberately not UTC and not the host default. Whatever the
    // machine running this test believes the time is, 09:12 UTC stays 09:12.
    const offsetInstant = '2026-08-04T11:12:00+02:00'
    const instant = readReportedInstant(offsetInstant, 'de')

    expect(instant.absolute).toBe('04.08.2026, 09:12:00 UTC')
    // …and the reported value itself is kept byte-for-byte for the DOM.
    expect(instant.raw).toBe(offsetInstant)
  })

  it('keeps the reported value verbatim instead of inventing or hiding one', () => {
    const broken = readReportedInstant('kein Zeitstempel', 'de')

    expect(broken.kind).toBe('invalid')
    expect(broken.raw).toBe('kein Zeitstempel')
    expect(broken.absolute).toBe('')
    expect(broken.absolute).not.toContain('Invalid')
    expect(formatReportedInstant('kein Zeitstempel', 'en')).toBeNull()
  })

  it('separates "was not reported" from "is not a point in time"', () => {
    for (const empty of [null, undefined, '', '   ']) {
      const instant = readReportedInstant(empty, 'de')
      expect(instant.kind).toBe('absent')
      expect(instant.absolute).toBe('')
    }
  })
})

describe('relative instants', () => {
  const cases: readonly { name: string; at: string; de: string; en: string }[] = [
    {
      name: 'a moment ago',
      at: '2026-08-04T09:14:58Z',
      de: 'jetzt',
      en: 'now',
    },
    { name: 'seconds', at: '2026-08-04T09:14:20Z', de: 'vor 40 Sekunden', en: '40 seconds ago' },
    { name: 'minutes', at: INSTANT, de: 'vor 3 Minuten', en: '3 minutes ago' },
    { name: 'hours', at: '2026-08-04T04:15:00Z', de: 'vor 5 Stunden', en: '5 hours ago' },
    { name: 'days', at: '2026-08-01T09:15:00Z', de: 'vor 3 Tagen', en: '3 days ago' },
    { name: 'a future report', at: '2026-08-04T09:25:00Z', de: 'in 10 Minuten', en: 'in 10 minutes' },
    { name: 'a very long time ago', at: '2020-01-01T00:00:00Z', de: 'vor 6 Jahren', en: '6 years ago' },
  ]

  for (const testCase of cases) {
    it(`says ${testCase.name} in both languages`, () => {
      const epochMs = Date.parse(testCase.at)
      expect(formatRelativeInstant(epochMs, 'de', NOW)).toBe(testCase.de)
      expect(formatRelativeInstant(epochMs, 'en', NOW)).toBe(testCase.en)
    })
  }

  it('never claims more elapsed time than has elapsed', () => {
    // 59.6 seconds is not a minute, and rounding it up to one would also push it
    // past its own unit ("vor 60 Sekunden").
    const almostAMinute = NOW - 59_600
    expect(formatRelativeInstant(almostAMinute, 'de', NOW)).toBe('vor 59 Sekunden')
    expect(formatRelativeInstant(almostAMinute, 'en', NOW)).toBe('59 seconds ago')

    const almostTwoHours = NOW - (2 * 3_600_000 - 1)
    expect(formatRelativeInstant(almostTwoHours, 'de', NOW)).toBe('vor 1 Stunde')
  })
})

// ---------------------------------------------------------------------------
// Numbers and percentages
// ---------------------------------------------------------------------------

describe('percentages', () => {
  it('follows the conventions of each language', () => {
    expect(formatPercent(90, 'de')).toBe('90\u00a0%')
    expect(formatPercent(90, 'en')).toBe('90%')

    expect(formatPercent(0, 'de')).toBe('0\u00a0%')
    expect(formatPercent(0, 'en')).toBe('0%')
    expect(formatPercent(100, 'de')).toBe('100\u00a0%')
    expect(formatPercent(100, 'en')).toBe('100%')
  })

  it('keeps a reported fraction rather than rounding it into a whole number', () => {
    expect(formatPercent(33.5, 'de')).toBe('33,5\u00a0%')
    expect(formatPercent(33.5, 'en')).toBe('33.5%')
  })

  it('does not turn a non-number into a plausible percentage', () => {
    expect(formatPercent(Number.NaN, 'de')).not.toContain('0')
    expect(formatPercent(Number.NaN, 'en')).not.toContain('0')
  })
})

describe('counters', () => {
  it('groups digits the way each language does', () => {
    expect(formatNumber(1234567, 'de')).toBe('1.234.567')
    expect(formatNumber(1234567, 'en')).toBe('1,234,567')
    expect(formatNumber(0, 'de')).toBe('0')
  })
})

describe('language resolution', () => {
  it('falls back to German for anything the cockpit does not speak', () => {
    expect(resolveFormattingLanguage('en')).toBe('en')
    expect(resolveFormattingLanguage('de')).toBe('de')
    expect(resolveFormattingLanguage('fr')).toBe('de')
    expect(resolveFormattingLanguage(undefined)).toBe('de')
    expect(resolveFormattingLanguage(null)).toBe('de')
  })
})
