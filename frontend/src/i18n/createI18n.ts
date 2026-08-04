import i18next, { type i18n } from 'i18next'
import { initReactI18next } from 'react-i18next'

import {
  DEFAULT_LANGUAGE,
  type Language,
  SUPPORTED_LANGUAGES,
  resolveInitialLanguage,
} from './languages'
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resources'

/**
 * Marker a missing key is rendered as in development.
 *
 * Loud on purpose: a bare key looks like a label somebody wrote, whereas
 * `⟦projects:list.title⟧` cannot be mistaken for finished text — and it is
 * greppable in a test.
 */
export const MISSING_KEY_PREFIX = '⟦'
export const MISSING_KEY_SUFFIX = '⟧'

export interface CreateI18nOptions {
  /** Defaults to `resolveInitialLanguage()` — a stored choice, else German. */
  language?: Language
  /**
   * Development behaviour for missing keys. Defaults to `import.meta.env.DEV`;
   * tests pass it explicitly so both halves of the rule can be exercised.
   */
  dev?: boolean
}

/**
 * Builds an initialised i18next instance.
 *
 * A factory rather than a module-level singleton, for the same reason
 * `createAppRouter` is one: every test gets its own instance with its own
 * language and cannot leak it into the next one.
 *
 * The returned instance is **already initialised** when this function returns.
 * The catalogues are statically imported (`./resources`) and `initImmediate` is
 * off, so `init()` takes the synchronous path — the caller can decide the
 * language before it renders anything, and the first paint is already in the
 * final language.
 *
 * ## Missing keys
 *
 * The runtime rule covers a key that resolves in *no* language:
 *
 * * development — `missingKeyHandler` writes to `console.error`, and the key is
 *   rendered wrapped in `⟦ ⟧`;
 * * production — the key itself is rendered. Never an empty slot: an empty
 *   string is the one failure mode nobody notices, which is also why
 *   `returnEmptyString` is off, so an accidentally emptied translation falls
 *   back instead of silently rendering nothing.
 *
 * A key that is missing in *one* language is a different failure: German
 * answers for it through `fallbackLng`, so the screen stays readable and
 * nothing shows up at runtime. That case is caught statically instead, by
 * `npm run check:locales`.
 */
export function createI18n(options: CreateI18nOptions = {}): i18n {
  const dev = options.dev ?? import.meta.env.DEV
  const language = options.language ?? resolveInitialLanguage()

  const instance = i18next.createInstance()

  instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    resources,
    ns: [...NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    // The catalogues are bundled; nothing is fetched, so nothing may be
    // deferred to a later tick.
    initImmediate: false,
    // React escapes on render. Escaping here as well would corrupt reported
    // values interpolated into an accessible name (see `ReportedText`).
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    // i18next prints a vendor notice on init. The browser console of a cockpit
    // is a diagnostic surface, and an advert in it costs attention.
    showSupportNotice: false,
    saveMissing: dev,
    missingKeyHandler: dev
      ? (lngs, ns, key) => {
          console.error(
            `[i18n] missing translation key "${ns}:${key}" for ${lngs.join(', ')}`,
          )
        }
      : false,
    parseMissingKeyHandler: (key: string) =>
      dev ? `${MISSING_KEY_PREFIX}${key}${MISSING_KEY_SUFFIX}` : key,
  })

  return instance
}
