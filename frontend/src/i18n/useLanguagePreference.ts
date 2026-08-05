import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DEFAULT_LANGUAGE,
  type Language,
  isSupportedLanguage,
  storeLanguage,
} from './languages'

export interface LanguagePreference {
  /** The language the cockpit is rendering in right now. */
  language: Language
  /** Switches to another language and remembers it. A no-op for the active one. */
  choose: (language: Language) => void
}

/**
 * Reading and changing the cockpit's language.
 *
 * The whole of the language switch is these two lines of behaviour, and both
 * of them are about what the switch must **not** do.
 *
 * `choose` calls `i18n.changeLanguage` and nothing else. It does not navigate,
 * it does not touch the UI store, and above all it does not reload: every text
 * on screen already comes from the instance (#42), so a `languageChanged` event
 * re-renders the cockpit in place. The URL, the selected component, the pane
 * sizes, the collapsed containers and the canvas camera are therefore preserved
 * by *omission* rather than by being saved and restored — which is the only way
 * to preserve state that nothing enumerates. A `location.reload()` would throw
 * away exactly the transient half of the UI store (camera, disclosure,
 * selection), which `uiStore.ts` deliberately does not persist.
 *
 * `language` is read back from the instance rather than kept in state of its
 * own, so a component can never translate in one language while it believes it
 * is in another, and an unknown value coming out of i18next resolves to German
 * the same way a stored one does.
 */
export function useLanguagePreference(): LanguagePreference {
  const { i18n } = useTranslation()
  const active = i18n.resolvedLanguage ?? i18n.language
  const language = isSupportedLanguage(active) ? active : DEFAULT_LANGUAGE

  const choose = useCallback(
    (next: Language) => {
      if (next === language) return
      // Stored first: the write is what makes the *next* visit start here, and
      // it must not depend on the re-render that follows succeeding.
      storeLanguage(next)
      void i18n.changeLanguage(next)
    },
    [i18n, language],
  )

  return { language, choose }
}
