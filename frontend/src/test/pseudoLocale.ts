import type { i18n as I18n } from 'i18next'

import { DEFAULT_LANGUAGE, createI18n } from '@/i18n'
import { NAMESPACES, resources, type Namespace } from '@/i18n/resources'

/**
 * The pseudo-locale: German, 30–40 % longer.
 *
 * ## What it is for
 *
 * German is already one of the longest-running languages the cockpit will ever
 * be written in, so a layout that survives German survives most translations —
 * *most*, not all. The question this locale asks is the one no real catalogue
 * can ask today: what happens when a translation is longer than anything either
 * catalogue currently contains? A pane title that fits at 100 % and is cut off
 * at 135 % is a layout defect that exists **now**, and it would be discovered by
 * the first translator rather than by the test suite.
 *
 * ## Why it is not a third language
 *
 * The product speaks two languages, and the language switch shows exactly two
 * segments. This locale therefore:
 *
 * * is **not** in `SUPPORTED_LANGUAGES`, so it cannot appear in the switch, in
 *   `<html lang>` or in a stored preference;
 * * is **not** a directory under `src/i18n/locales`, so `npm run check:locales`
 *   never sees it — a generated catalogue that had to be kept in key parity by
 *   hand would be a second catalogue to maintain and a new way to go red for a
 *   reason nobody cares about;
 * * is derived from the German catalogue by a pure function, so it cannot
 *   drift: a key added in #42's successor is lengthened the day it is added.
 *
 * It is installed onto the German slot of one i18next instance. The application
 * renders exactly as it renders in German — same language code, same plural
 * rules, same formatting — with every one of its own words longer.
 *
 * ## Why it lives in `src/test/`
 *
 * It is test scaffolding, not a product feature. Nothing outside a test imports
 * it, so it never reaches the bundle, and `scripts/check-ui-strings.mjs` treats
 * everything under `test/` as test code.
 */

/**
 * How much longer a pseudo string is than its German original.
 *
 * The issue asks for 30–40 %; 35 % sits in the middle, so the rounding at both
 * ends of a short string still lands inside the band (see
 * `src/i18n/pseudoLocale.test.ts`, which asserts exactly that).
 */
export const PSEUDO_EXPANSION = 0.35

/** The band the expansion has to stay inside, asserted rather than assumed. */
export const PSEUDO_EXPANSION_RANGE = { min: 0.3, max: 0.4 } as const

/**
 * The padding.
 *
 * Latin letters and German umlauts on purpose: every font the cockpit uses has
 * them, so a browser measures the padding the way it measures a real
 * translation. A filler of box-drawing or Cyrillic characters would fall back
 * to a different font and quietly measure something else. It starts with a
 * space so the padding wraps as words rather than turning a label into one
 * unbreakable token — a line that cannot wrap overflows for a reason that has
 * nothing to do with its length.
 */
const FILLER = ' ähnlich lange wörter'

/** Exactly `length` characters of filler. */
function filler(length: number): string {
  let padding = ''
  while (padding.length < length) padding += FILLER
  return padding.slice(0, length)
}

/**
 * One translated string, lengthened.
 *
 * The original is kept as the prefix and the padding is **appended**, which is
 * what keeps the transformation safe for the two things a catalogue string can
 * contain besides words:
 *
 * * `{{interpolations}}` — untouched, so the reported values they carry still
 *   arrive byte-identical;
 * * `<0>…</0>` slots of `<Trans>` — untouched, so the markup still nests.
 *
 * It also keeps the string readable, which matters more than it sounds: a test
 * that fails on a pseudo rendering has to be debuggable from the screenshot.
 */
export function lengthenText(text: string): string {
  const padding = Math.round(text.length * PSEUDO_EXPANSION)
  return padding === 0 ? text : text + filler(padding)
}

type Catalogue = { [key: string]: string | Catalogue }

/** Deep-maps every leaf of a catalogue through {@link lengthenText}. */
export function lengthenCatalogue<T>(catalogue: T): T {
  const source = catalogue as unknown as Catalogue
  const result: Catalogue = {}
  for (const [key, value] of Object.entries(source)) {
    result[key] =
      typeof value === 'string' ? lengthenText(value) : lengthenCatalogue(value)
  }
  return result as unknown as T
}

/** The whole reference catalogue, lengthened, namespace by namespace. */
export function pseudoResources(): Record<Namespace, unknown> {
  const bundles = {} as Record<Namespace, unknown>
  for (const namespace of NAMESPACES) {
    bundles[namespace] = lengthenCatalogue(resources[DEFAULT_LANGUAGE][namespace])
  }
  return bundles
}

/**
 * An initialised i18next instance that renders the cockpit in the pseudo-locale.
 *
 * ## The clone is not optional
 *
 * `i18next.init({ resources })` keeps a **reference** to the object it is
 * given, and `addResourceBundle` writes through that reference. Installing the
 * pseudo catalogue without the clone below therefore replaces the German
 * catalogue of `src/i18n/resources.ts` for the rest of the worker process —
 * every later `createI18n()` in the same test file would come up in the
 * pseudo-locale, and the failure would surface in an unrelated test.
 *
 * Cloning the instance's own store first confines the write to this instance.
 * `pseudoLocale.test.ts` asserts that a plain `createI18n()` built afterwards
 * still answers in real German, so the guard is known to hold rather than
 * believed to.
 */
export function createPseudoI18n(): I18n {
  const instance = createI18n({ language: DEFAULT_LANGUAGE, dev: false })

  instance.store.data = structuredClone(instance.store.data)

  const bundles = pseudoResources()
  for (const namespace of NAMESPACES) {
    instance.addResourceBundle(DEFAULT_LANGUAGE, namespace, bundles[namespace], false, true)
  }

  return instance
}
