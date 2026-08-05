import type { i18n as I18n } from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MISSING_KEY_PREFIX, MISSING_KEY_SUFFIX, createI18n } from './createI18n'
import { bindDocumentLanguage } from './documentLanguage'
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isSupportedLanguage,
  resolveInitialLanguage,
  storeLanguage,
} from './languages'

/**
 * A key nobody translated. The typed `t()` refuses it at compile time — which
 * is the point of the typing — so the runtime behaviour has to be reached
 * through a widened signature. That is exactly the situation being tested: a
 * key that survived in the code after the catalogue lost it.
 */
function looseT(instance: I18n): (key: string) => string {
  return instance.t as unknown as (key: string) => string
}

afterEach(() => {
  document.documentElement.lang = ''
})

describe('language resolution', () => {
  it('is German when nothing was ever chosen', () => {
    expect(resolveInitialLanguage(localStorage)).toBe('de')
    expect(DEFAULT_LANGUAGE).toBe('de')
  })

  it('uses a stored choice', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en')

    expect(resolveInitialLanguage(localStorage)).toBe('en')
  })

  it('falls back to German for a stored language that is no longer supported', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr')

    expect(resolveInitialLanguage(localStorage)).toBe('de')
    expect(isSupportedLanguage('fr')).toBe(false)
  })

  it('discards a stored language the cockpit no longer supports', () => {
    // Somebody chose French; a later release dropped it. The cockpit comes up
    // in German — and does not keep a preference around that nothing can act
    // on and nothing can show.
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr')

    expect(resolveInitialLanguage(localStorage)).toBe('de')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
    // …and the next start reads a clean slate rather than repeating the fall-back.
    expect(resolveInitialLanguage(localStorage)).toBe('de')
  })

  it('leaves a supported choice and an empty storage alone', () => {
    const removed: string[] = []
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      removeItem: (key: string) => removed.push(key),
    }

    expect(resolveInitialLanguage(storage)).toBe('de')
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en')
    expect(resolveInitialLanguage(storage)).toBe('en')

    // Nothing was stored the first time and the second value is supported, so
    // the clean-up never ran: it is a reaction to a dropped language, not a
    // write on every start-up.
    expect(removed).toEqual([])
  })

  it('starts in German when storage cannot be read at all', () => {
    const blocked = {
      getItem() {
        throw new Error('access denied')
      },
    }

    expect(resolveInitialLanguage(blocked)).toBe('de')
    expect(resolveInitialLanguage(null)).toBe('de')
  })

  it('starts in the language that was last chosen', () => {
    storeLanguage('en', localStorage)

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
    expect(resolveInitialLanguage(localStorage)).toBe('en')
    // The default path — the one `main.tsx` takes — reads the same value.
    expect(createI18n().language).toBe('en')
  })

  it('keeps working when the preference cannot be written', () => {
    const blocked = {
      getItem: () => null,
      setItem() {
        throw new Error('quota exceeded')
      },
    }

    // The language the user asked for is already on screen; refusing the switch
    // because it could not be remembered would trade a session for a byte.
    expect(() => storeLanguage('en', blocked)).not.toThrow()
    expect(() => storeLanguage('en', null)).not.toThrow()
  })
})

describe('initialisation', () => {
  it('is finished, in its final language, before anything can render', () => {
    const i18n = createI18n({ language: 'en' })

    // No await anywhere: the catalogues are bundled, so `init()` took the
    // synchronous path. A caller that renders on the next line already renders
    // English — there is no first paint in another language to correct.
    expect(i18n.isInitialized).toBe(true)
    expect(i18n.language).toBe('en')
    expect(i18n.t('projects:list.title')).toBe('Projects')
  })

  it('renders both languages from the same catalogue keys', () => {
    const de = createI18n({ language: 'de' })
    const en = createI18n({ language: 'en' })

    expect(de.t('projects:list.title')).toBe('Projekte')
    expect(en.t('projects:list.title')).toBe('Projects')
    expect(de.t('projects:empty.title')).toBe('Noch keine Projekte gemeldet')
    expect(en.t('projects:empty.title')).toBe('No projects reported yet')
  })

  it('interpolates a reported value without changing a byte of it', () => {
    const de = createI18n({ language: 'de' })
    const en = createI18n({ language: 'en' })
    const projectId = 'shop-platform/orders & billing'

    expect(de.t('projects:item.openLabel', { projectId })).toBe(
      `Projekt ${projectId} öffnen`,
    )
    expect(en.t('projects:item.openLabel', { projectId })).toBe(
      `Open project ${projectId}`,
    )
  })
})

describe('document language', () => {
  it('sets <html lang> and follows every change', async () => {
    const i18n = createI18n({ language: 'de' })
    const unbind = bindDocumentLanguage(i18n)

    expect(document.documentElement.lang).toBe('de')

    await i18n.changeLanguage('en')
    expect(document.documentElement.lang).toBe('en')

    unbind()
    await i18n.changeLanguage('de')
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('missing keys', () => {
  it('answers in German when a key exists only in the fallback language', () => {
    const i18n = createI18n({ language: 'en', dev: false })
    i18n.addResource('de', 'projects', 'fallbackProbe', 'Nur auf Deutsch')

    // The English reader sees German rather than a hole. This is why a key that
    // is missing in one language is invisible at runtime, and why
    // `npm run check:locales` exists.
    expect(looseT(i18n)('projects:fallbackProbe')).toBe('Nur auf Deutsch')
  })

  it('is loud in development: console.error plus a marked rendering', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const i18n = createI18n({ language: 'de', dev: true })

    const rendered = looseT(i18n)('projects:item.thisKeyWasNeverTranslated')

    expect(rendered).toBe(
      `${MISSING_KEY_PREFIX}item.thisKeyWasNeverTranslated${MISSING_KEY_SUFFIX}`,
    )
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('missing translation key "projects:item.thisKeyWasNeverTranslated"'),
    )
  })

  it('is a defined fallback in production: the key itself, never an empty slot', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const i18n = createI18n({ language: 'de', dev: false })

    const rendered = looseT(i18n)('projects:item.thisKeyWasNeverTranslated')

    expect(rendered).toBe('item.thisKeyWasNeverTranslated')
    expect(rendered).not.toBe('')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('treats an emptied translation as missing rather than rendering nothing', () => {
    const i18n = createI18n({ language: 'en', dev: false })
    i18n.addResource('en', 'projects', 'emptiedProbe', '')
    i18n.addResource('de', 'projects', 'emptiedProbe', 'Vorhanden')

    // `returnEmptyString: false` — an empty string is the one broken
    // translation a reader never notices.
    expect(looseT(i18n)('projects:emptiedProbe')).toBe('Vorhanden')
  })
})
