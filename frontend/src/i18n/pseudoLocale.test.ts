import { describe, expect, it } from 'vitest'

import {
  PSEUDO_EXPANSION_RANGE,
  createPseudoI18n,
  lengthenText,
  pseudoResources,
} from '@/test/pseudoLocale'

import { createI18n } from './createI18n'
import { SUPPORTED_LANGUAGES } from './languages'
import { NAMESPACES, resources } from './resources'

/**
 * The pseudo-locale itself.
 *
 * It exists to stress the layout with translations longer than either catalogue
 * currently contains (#37). A generator that quietly produced *shorter* strings,
 * dropped an interpolation or lost a key would make every test built on it pass
 * for the wrong reason, so the generator is checked before anything is rendered
 * with it.
 */

/** `{{name}}` and `{{name, format}}` — the interpolations i18next expands. */
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g

function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)]
    .map((match) => (match[1] ?? '').split(',')[0]?.trim() ?? '')
    .sort()
}

type Catalogue = { [key: string]: string | Catalogue }

/** Flattens a catalogue into `dotted.key -> string`, as the checker script does. */
function flatten(catalogue: unknown, prefix = '', into = new Map<string, string>()) {
  for (const [key, value] of Object.entries(catalogue as Catalogue)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') into.set(path, value)
    else flatten(value, path, into)
  }
  return into
}

/** Every German string of every namespace, with its fully qualified key. */
function germanStrings(): Map<string, string> {
  const all = new Map<string, string>()
  for (const namespace of NAMESPACES) {
    for (const [key, value] of flatten(resources.de[namespace])) {
      all.set(`${namespace}:${key}`, value)
    }
  }
  return all
}

function pseudoStrings(): Map<string, string> {
  const bundles = pseudoResources()
  const all = new Map<string, string>()
  for (const namespace of NAMESPACES) {
    for (const [key, value] of flatten(bundles[namespace])) {
      all.set(`${namespace}:${key}`, value)
    }
  }
  return all
}

describe('the pseudo-locale is longer, and by how much', () => {
  it('lengthens every string of every namespace by 30 to 40 per cent', () => {
    const german = germanStrings()
    const pseudo = pseudoStrings()
    const tooShort: string[] = []
    const tooLong: string[] = []

    for (const [key, source] of german) {
      // Below ten characters the rounding cannot land inside a ten-point band —
      // "DE" would have to grow by 0.7 of a character. Those are the two-letter
      // language codes and nothing else, and they are not what a layout breaks
      // on.
      if (source.length < 10) continue
      const ratio = (pseudo.get(key) ?? '').length / source.length
      if (ratio < 1 + PSEUDO_EXPANSION_RANGE.min) tooShort.push(`${key} ${ratio.toFixed(3)}`)
      if (ratio > 1 + PSEUDO_EXPANSION_RANGE.max) tooLong.push(`${key} ${ratio.toFixed(3)}`)
    }

    expect(tooShort).toEqual([])
    expect(tooLong).toEqual([])
    expect(german.size).toBeGreaterThan(300)
  })

  it('grows the catalogue as a whole by the same share, short strings included', () => {
    const totalGerman = [...germanStrings().values()].reduce((sum, s) => sum + s.length, 0)
    const totalPseudo = [...pseudoStrings().values()].reduce((sum, s) => sum + s.length, 0)
    const ratio = totalPseudo / totalGerman

    expect(ratio).toBeGreaterThanOrEqual(1 + PSEUDO_EXPANSION_RANGE.min)
    expect(ratio).toBeLessThanOrEqual(1 + PSEUDO_EXPANSION_RANGE.max)
  })

  it('keeps the German original readable at the front of every string', () => {
    // A pseudo rendering has to be debuggable from a screenshot: whoever looks
    // at a broken pane has to be able to tell *which* text broke it.
    expect(lengthenText('Architektur')).toMatch(/^Architektur /)
  })
})

describe('the pseudo-locale changes the words and nothing else', () => {
  it('describes exactly the keys the German catalogue describes', () => {
    expect([...pseudoStrings().keys()].sort()).toEqual([...germanStrings().keys()].sort())
  })

  it('never adds, drops or renames an interpolated value', () => {
    const pseudo = pseudoStrings()
    const drifted: string[] = []

    for (const [key, source] of germanStrings()) {
      const before = placeholdersOf(source)
      const after = placeholdersOf(pseudo.get(key) ?? '')
      if (before.join('|') !== after.join('|')) drifted.push(key)
    }

    // This is the property that lets the pseudo rendering carry reported data:
    // `{{projectId}}` still interpolates, so the value still arrives verbatim.
    expect(drifted).toEqual([])
  })

  it('leaves the markup slots of a Trans clause intact', () => {
    // `<agent/>`, `<run/>`, `<field/>` — the named slots a reported value is
    // rendered into inside a translated sentence.
    const tags = (text: string) => [...text.matchAll(/<\/?[A-Za-z][\w-]*\/?>/g)].map((m) => m[0])
    const withSlots = [...germanStrings()].filter(([, value]) => tags(value).length > 0)
    expect(withSlots.length).toBeGreaterThan(0)

    const pseudo = pseudoStrings()
    for (const [key, source] of withSlots) {
      expect(tags(pseudo.get(key) ?? ''), key).toEqual(tags(source))
    }
  })

  it('is never empty where German was not', () => {
    for (const [key, value] of pseudoStrings()) {
      expect(value.trim(), key).not.toBe('')
    }
  })
})

describe('the pseudo-locale stays inside the instance it was installed on', () => {
  it('renders the pseudo text through the instance it was built for', () => {
    const pseudo = createPseudoI18n()
    const real = resources.de.projects.list.title

    expect(pseudo.t('projects:list.title')).not.toBe(real)
    expect(pseudo.t('projects:list.title').startsWith(real)).toBe(true)
  })

  it('leaves the shared German catalogue and every later instance untouched', () => {
    // `i18next.init({ resources })` keeps a *reference* to the module-level
    // catalogue and `addResourceBundle` writes through it. Without the store
    // clone in `createPseudoI18n` this assertion fails — and it fails in some
    // unrelated test three files later, which is why it is pinned here.
    const before = resources.de.projects.list.title
    createPseudoI18n()

    expect(resources.de.projects.list.title).toBe(before)
    expect(createI18n({ language: 'de' }).t('projects:list.title')).toBe(before)
    expect(createI18n({ language: 'en' }).t('projects:list.title')).toBe(
      resources.en.projects.list.title,
    )
  })

  it('is not a language the cockpit offers', () => {
    // The product speaks two languages. The pseudo-locale is installed onto the
    // German slot precisely so that it cannot leak into the switch, into
    // `<html lang>` or into a stored preference.
    const pseudo = createPseudoI18n()

    expect(pseudo.language).toBe('de')
    expect(SUPPORTED_LANGUAGES).toEqual(['de', 'en'])
    expect(pseudo.options.supportedLngs).toEqual(
      expect.arrayContaining([...SUPPORTED_LANGUAGES]),
    )
    // …and no directory of its own, so `npm run check:locales` never sees it.
    expect(Object.keys(resources).sort()).toEqual(['de', 'en'])
  })
})
