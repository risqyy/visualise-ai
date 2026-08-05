/**
 * The languages the cockpit speaks, and how the first one is chosen.
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
 * Nothing in this issue writes it; the language switch that does is #36. The
 * key is defined here so the reader and the future writer cannot drift apart,
 * and it is namespaced like `visualise-ai.ui` (the persisted UI store) rather
 * than being a bare `language`.
 */
export const LANGUAGE_STORAGE_KEY = 'visualise-ai.language'

export function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  )
}

/**
 * The language to start in.
 *
 * A stored, still-supported choice wins; everything else is German.
 *
 * The browser's `Accept-Language` is deliberately *not* consulted. The
 * requirement is that German is the language without a stored choice (#38), and
 * a navigator sniff would break exactly that for a user whose browser is set to
 * English but who never asked the cockpit for English. A stored value that is
 * no longer supported is treated as absent rather than as an error, which is
 * also the behaviour #36 has to keep.
 */
export function resolveInitialLanguage(
  storage: Pick<Storage, 'getItem'> | null | undefined = safeLocalStorage(),
): Language {
  const stored = readStored(storage)
  return isSupportedLanguage(stored) ? stored : DEFAULT_LANGUAGE
}

function readStored(storage: Pick<Storage, 'getItem'> | null | undefined): string | null {
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

function safeLocalStorage(): Pick<Storage, 'getItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
