import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasVoice, CountText } from './canvasAccessibility'

/**
 * The voice the accessible names of the canvas are built with.
 *
 * `canvasAccessibility.ts` is pure and free of React — the same discipline
 * `graphProjection.ts` follows, and the reason its rules can be tested without
 * rendering anything. It therefore cannot hold a `t` of its own, and it must
 * not: counted nouns are localised (#40) and so are the sentences around them
 * (#42), and a module-local table of either would be a second one next to the
 * catalogues. This hook is the one seam between the two.
 *
 * The identity is stable per language, so the memo that builds the node and
 * edge labels is not invalidated on every render — and it *does* change when
 * the language does, which is exactly what makes the accessible names follow a
 * language switch.
 */
export function useCanvasVoice(): CanvasVoice {
  const { t } = useTranslation('canvas')
  const { t: tCommon } = useTranslation('common')

  return useMemo<CanvasVoice>(() => {
    const count: CountText = (noun, value) => tCommon(`count.${noun}`, { count: value })
    return { t, count }
  }, [t, tCommon])
}
