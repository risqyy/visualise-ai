import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SUPPORTED_LANGUAGES, type Language } from '@/i18n'
import { renderApp } from '@/test/renderApp'
import { createPseudoI18n } from '@/test/pseudoLocale'
import { renderWorkspaceScene } from '@/test/workspaceScene'

import { MISSING_KEY_PREFIX } from './createI18n'

/**
 * Every name a screen reader reads out, in every language, on both surfaces.
 *
 * The individual accessible names are asserted where they belong — the graph in
 * `canvas/ArchitectureAccessibility.test.tsx`, the chrome in
 * `routes/pages/WorkspacePage.i18n.test.tsx`. What is missing from both is the
 * *sweep*: a rule that holds for names nobody has written yet.
 *
 * `aria-label`, `title`, `placeholder` and screen-reader-only text are the four
 * places a translation can be forgotten without anybody seeing it. A visible
 * pane title that stayed German shows up in the first English screenshot; an
 * `aria-label` that stayed German shows up when a blind user files a bug.
 *
 * Three properties are checked here, and each of them covers text that does not
 * exist yet:
 *
 * 1. **Nothing renders a key.** Not the `⟦…⟧` marker of a key that resolves in
 *    no language, and not a bare `area.element` that slipped through as a
 *    string literal.
 * 2. **Everything a user can operate has a name**, in every language.
 * 3. **The names really change with the language** — a set that is identical in
 *    German and English would pass rules 1 and 2 while being untranslated.
 */

/** Attributes that carry a name a screen reader will read. */
const NAME_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'aria-description'] as const

/** Controls a user is expected to be able to reach and operate. */
const OPERABLE = 'button, a[href], input, select, textarea, [role="tab"], [role="button"]'

/**
 * A string that is a translation key rather than a translation.
 *
 * `item.openLabel`, `projects:list.title` — lower-camel segments separated by
 * dots and no spaces. A real sentence has a space in it; a real single word has
 * no dot in it. File paths and component ids look the same, which is why this is
 * only ever applied to text the cockpit owns and never to a reported value.
 */
const LOOKS_LIKE_A_KEY = /^[a-z][A-Za-z0-9]*([.:][A-Za-z0-9]+)+$/

interface Names {
  /** Every value of every name-bearing attribute, in document order. */
  attributes: { element: string; attribute: string; value: string }[]
  /** Every screen-reader-only text. */
  screenReaderOnly: string[]
  /** Controls without any accessible name at all. */
  unnamed: string[]
  /** How many controls were looked at — an empty sweep passes everything. */
  operable: number
}

/**
 * A stable description of one element.
 *
 * React's `useId` produces `data-testid` values like `_r_ab_` that count
 * renders, so two renderings of the same screen disagree on them. Dropping them
 * keeps the comparison about the screen rather than about the order the tests
 * ran in.
 */
function describeElement(element: Element): string {
  const testId = element.getAttribute('data-testid')
  const stable = testId === null || /^_r_/.test(testId) ? null : testId
  return `${element.tagName.toLowerCase()}${stable === null ? '' : `[${stable}]`}`
}

/** The name a screen reader would announce, as far as jsdom can tell. */
function accessibleNameOf(element: Element): string {
  const label = element.getAttribute('aria-label')
  if (label !== null && label.trim() !== '') return label.trim()

  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy !== null) {
    const named = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim()
    if (named !== '') return named
  }

  const text = (element.textContent ?? '').trim()
  if (text !== '') return text

  return (element.getAttribute('title') ?? '').trim()
}

function collectNames(container: HTMLElement): Names {
  const attributes: Names['attributes'] = []
  for (const attribute of NAME_ATTRIBUTES) {
    for (const element of container.querySelectorAll(`[${attribute}]`)) {
      attributes.push({
        element: describeElement(element),
        attribute,
        value: element.getAttribute(attribute) ?? '',
      })
    }
  }

  const screenReaderOnly = [...container.querySelectorAll('.sr-only')].map(
    (element) => (element.textContent ?? '').trim(),
  )

  const operable = [...container.querySelectorAll(OPERABLE)].filter(
    (element) => element.getAttribute('aria-hidden') !== 'true',
  )
  const unnamed = operable
    .filter((element) => accessibleNameOf(element) === '')
    .map(describeElement)

  return { attributes, screenReaderOnly, unnamed, operable: operable.length }
}

/** The project list and the whole cockpit — the two surfaces #42 migrated. */
async function namesOfEverySurface(language: Language): Promise<Names> {
  const list = renderApp('/projects', { language })
  await screen.findAllByRole('link')
  const listNames = collectNames(list.container)
  list.unmount()

  const workspace = await renderWorkspaceScene({ language })
  const workspaceNames = collectNames(workspace.container)
  workspace.unmount()

  return {
    attributes: [...listNames.attributes, ...workspaceNames.attributes],
    screenReaderOnly: [...listNames.screenReaderOnly, ...workspaceNames.screenReaderOnly],
    unnamed: [...listNames.unnamed, ...workspaceNames.unnamed],
    operable: listNames.operable + workspaceNames.operable,
  }
}

describe('accessible names — nothing renders a key instead of a translation', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    it(`resolves every name-bearing attribute and screen-reader text in ${language}`, async () => {
      const names = await namesOfEverySurface(language)

      const unresolved = names.attributes
        .filter((entry) => entry.value.includes(MISSING_KEY_PREFIX))
        .map((entry) => `${entry.element} ${entry.attribute}="${entry.value}"`)
      expect(unresolved).toEqual([])

      const keyShaped = names.attributes
        .filter((entry) => LOOKS_LIKE_A_KEY.test(entry.value))
        .map((entry) => `${entry.element} ${entry.attribute}="${entry.value}"`)
      expect(keyShaped).toEqual([])

      const emptyNames = names.attributes
        .filter((entry) => entry.attribute === 'aria-label' && entry.value.trim() === '')
        .map((entry) => entry.element)
      expect(emptyNames).toEqual([])

      // The surfaces really were rendered — an empty sweep passes everything.
      expect(names.attributes.length).toBeGreaterThan(20)
      expect(names.screenReaderOnly.length).toBeGreaterThan(3)
    })

    it(`gives every operable control an accessible name in ${language}`, async () => {
      const names = await namesOfEverySurface(language)

      expect(names.unnamed).toEqual([])
      // Without this the assertion above would also pass on an empty screen.
      expect(names.operable).toBeGreaterThan(10)
    })
  }
})

describe('accessible names — the two languages really differ', () => {
  it('translates the names rather than describing the same screen twice', async () => {
    const german = await namesOfEverySurface('de')
    const english = await namesOfEverySurface('en')

    // Same screen, same controls, in the same order: the sweep compares like
    // with like rather than two different renderings.
    expect(english.attributes.map((entry) => `${entry.element} ${entry.attribute}`)).toEqual(
      german.attributes.map((entry) => `${entry.element} ${entry.attribute}`),
    )

    const changed = german.attributes.filter(
      (entry, index) => entry.value !== english.attributes[index]?.value,
    )
    // Most names are ours and change; the rest are the ones that are the same
    // word in both catalogues ("Inspector", "Runs", "DE") or that carry a
    // reported value. A single-digit number here would mean the English
    // catalogue is answering with German through `fallbackLng`.
    expect(changed.length).toBeGreaterThan(15)
  })

  it('translates the screen-reader-only texts as well', async () => {
    const german = await namesOfEverySurface('de')
    const english = await namesOfEverySurface('en')

    expect(english.screenReaderOnly.length).toBe(german.screenReaderOnly.length)
    const changed = german.screenReaderOnly.filter(
      (text, index) => text !== english.screenReaderOnly[index],
    )
    expect(changed.length).toBeGreaterThan(0)
  })
})

describe('accessible names — a translation 35 per cent longer keeps every one of them', () => {
  it('names every control, resolves every key and drops nothing', async () => {
    const workspace = await renderWorkspaceScene({ i18n: createPseudoI18n() })
    const names = collectNames(workspace.container)

    expect(names.unnamed).toEqual([])
    expect(names.operable).toBeGreaterThan(10)
    expect(
      names.attributes.filter((entry) => entry.value.includes(MISSING_KEY_PREFIX)),
    ).toEqual([])

    // A longer translation may not silently lose an accessible name: the same
    // controls, the same attributes, in the same order as in German.
    workspace.unmount()

    const german = await renderWorkspaceScene({ language: 'de' })
    const germanNames = collectNames(german.container)
    german.unmount()

    expect(names.attributes.map((entry) => `${entry.element} ${entry.attribute}`)).toEqual(
      germanNames.attributes.map((entry) => `${entry.element} ${entry.attribute}`),
    )
    // …and every one of them really is the longer text, not the German fallback.
    const identical = names.attributes.filter(
      (entry, index) => entry.value === germanNames.attributes[index]?.value,
    )
    expect(identical.length).toBeLessThan(names.attributes.length / 2)
  })
})
