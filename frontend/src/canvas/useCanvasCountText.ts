import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { CountText } from './canvasAccessibility'

/**
 * The counting function the accessible names of the canvas are built with.
 *
 * `canvasAccessibility.ts` is pure and free of React — the same discipline
 * `graphProjection.ts` follows, and the reason its rules can be tested without
 * rendering anything. It therefore cannot hold a `t` of its own, and it must
 * not: counted nouns are localised, and a module-local plural table would be a
 * second one next to the catalogues (`src/i18n`, ADR 0019). This hook is the
 * one seam between the two.
 *
 * The identity is stable per language, so the memo that builds the node and
 * edge labels is not invalidated on every render — and it *does* change when
 * the language does, which is exactly what makes the accessible names follow a
 * language switch.
 */
export function useCanvasCountText(): CountText {
  const { t } = useTranslation('common')
  return useCallback<CountText>((noun, count) => t(`count.${noun}`, { count }), [t])
}
