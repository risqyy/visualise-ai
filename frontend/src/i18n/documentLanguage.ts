import type { i18n } from 'i18next'

/**
 * Keeps `<html lang>` in step with the active language.
 *
 * The attribute is not decoration: screen readers pick their pronunciation from
 * it, and `lang` is what tells a browser's own translation feature which
 * language the page claims to be in. A page that says `lang="de"` while showing
 * English is worse than one that says nothing.
 *
 * Applies the current language immediately and then follows every change, so
 * the language switch of #36 gets this for free. Returns the unsubscribe.
 */
export function bindDocumentLanguage(
  instance: i18n,
  element: HTMLElement | null = typeof document === 'undefined'
    ? null
    : document.documentElement,
): () => void {
  if (!element) return () => {}

  const apply = () => {
    element.lang = instance.resolvedLanguage ?? instance.language
  }

  apply()
  instance.on('languageChanged', apply)

  return () => {
    instance.off('languageChanged', apply)
  }
}
