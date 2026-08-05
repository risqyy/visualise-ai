import type { TFunction } from 'i18next'

import { createI18n, type Language, type Namespace } from '@/i18n'

/**
 * A `t` bound to one namespace and one language, for unit tests.
 *
 * The pure helpers that build a sentence — `overlayLabel`, `overlayTitle`,
 * `componentKindLabel` — take the `t` of exactly one namespace since #42, so a
 * test of them needs one too. Building it from `createI18n` rather than from a
 * stub is the point: the test then asserts against the **real catalogue**, so a
 * key that was renamed or a translation that was emptied fails here as well.
 *
 * Defaults to German, the reference language.
 */
export function translateWith<const N extends Namespace>(
  namespace: N,
  language: Language = 'de',
): TFunction<N> {
  return createI18n({ language }).getFixedT(null, namespace)
}
