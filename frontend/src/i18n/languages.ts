/**
 * The languages the cockpit speaks, how the first one is chosen, and how a
 * choice is kept.
 *
 * German is the product's language; English is the second one. The list is
 * ordered, and its first entry is the default — an unreadable screen is worse
 * than an untranslated one, so a language is only ever used when its catalogue
 * exists (see `./resources`).
 */
export const SUPPORTED_LANGUAGES = ['de', 'en'] as const

export type Language = (typeof SUPPORTED_LANGUAGES)[number]

/** Used when nothing else decides — see `resolveInitialLanguage`. */
export const DEFAULT_LANGUAGE: Language = 'de'

/**
 * `localStorage` key of the user's explicit choice.
 *
 * Written by the language switch (#36) and read at start-up, namespaced like
 * `visualise-ai.ui` (the persisted UI store) rather than being a bare
 * `language`.
 */
export const LANGUAGE_STORAGE_KEY = 'visualise-ai.language'

/**
 * The slice of `Storage` the preference needs.
 *
 * Reading is required, writing and removing are optional: a caller may hand in
 * a read-only double, and a browser may refuse either half at any time. Every
 * access below is guarded, so nothing here can be the reason the cockpit fails
 * to start.
 */
export type LanguageStorage = Pick<Storage, 'getItem'> &
  Partial<Pick<Storage, 'setItem' | 'removeItem'>>

export function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  )
}

/**
 * The language to start in — and the one place a dropped language is cleaned
 * up.
 *
 * A stored, still-supported choice wins; everything else is German.
 *
 * The browser's `Accept-Language` is deliberately *not* consulted. The
 * requirement is that German is the language without a stored choice (#38), and
 * a navigator sniff would break exactly that for a user whose browser is set to
 * English but who never asked the cockpit for English.
 *
 * ## A stored language the cockpit no longer supports
 *
 * Somebody chose `fr`, and a later release dropped `fr`. Reading it is not an
 * error: the value is treated as absent and the cockpit comes up in German
 * (#38). What #36 adds is that the value is also **removed**. Leaving it would
 * keep a preference in the browser that nothing can act on and nothing can
 * show — the switch would paint German while storage claims French, and the
 * next release that happens to reintroduce `fr` would silently resurrect a
 * choice the user made years ago.
 *
 * The removal lives inside the resolver rather than in a separate clean-up
 * step, because there is exactly one moment at which the cockpit compares a
 * stored value against the supported set, and a second implementation of that
 * comparison is a second chance to get it wrong.
 */
export function resolveInitialLanguage(
  storage: LanguageStorage | null | undefined = safeLocalStorage(),
): Language {
  const stored = readStored(storage)
  if (isSupportedLanguage(stored)) return stored
  // Only a value that is really there is discarded — "nothing stored" is the
  // normal case and must not cause a write.
  if (stored !== null) discardStored(storage)
  return DEFAULT_LANGUAGE
}

/**
 * Persists an explicit choice, so the next visit starts in it.
 *
 * A failed write is swallowed on purpose. Private-mode and quota-exhausted
 * browsers throw here, and the language the user just asked for is already on
 * screen; refusing the switch because the preference could not be *remembered*
 * would trade a working session for a stored byte.
 */
export function storeLanguage(
  language: Language,
  storage: LanguageStorage | null | undefined = safeLocalStorage(),
): void {
  try {
    storage?.setItem?.(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // See above.
  }
}

function readStored(storage: LanguageStorage | null | undefined): string | null {
  if (!storage) return null
  try {
    return storage.getItem(LANGUAGE_STORAGE_KEY)
  } catch {
    // Private-mode and blocked-storage browsers throw on access. A cockpit that
    // refuses to start because it could not read a preference is worse than one
    // that starts in German.
    return null
  }
}

function discardStored(storage: LanguageStorage | null | undefined): void {
  try {
    storage?.removeItem?.(LANGUAGE_STORAGE_KEY)
  } catch {
    // A browser that will not let the value go leaves it there. The cockpit
    // still runs in German, because the value is unsupported either way.
  }
}

function safeLocalStorage(): LanguageStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
