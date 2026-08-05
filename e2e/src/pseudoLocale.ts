import type { Page } from '@playwright/test'

/**
 * The pseudo-locale, applied to a running page.
 *
 * ## What it is
 *
 * Every word the **cockpit** owns, 35 % longer. Every value an **agent**
 * reported, untouched.
 *
 * Issue #37 asks for "a pseudo-locale or artificially 30–40 % lengthened
 * texts". The frontend suite takes the first half of that sentence: it derives
 * a longer catalogue from the German one and hands it to i18next
 * (`frontend/src/test/pseudoLocale.ts`). That answers whether anything gets
 * *lost*; it cannot answer whether anything gets *cut off*, because jsdom has
 * no layout engine.
 *
 * This file takes the second half, in the only place where the question is
 * decidable: the real browser, against the built deployment. Adding a third
 * catalogue to the product instead was rejected — the cockpit speaks two
 * languages, and a shipped language that the switch deliberately hides is a
 * feature nobody asked for, sitting in the production bundle forever so that a
 * test can look at it.
 *
 * ## Why the expansion is the same 35 %
 *
 * The two halves have to describe the same locale or neither of them proves
 * anything about the other. They are two implementations of one rule, and each
 * asserts the rule for itself: `pseudoLocale.test.ts` on the catalogue, the
 * check below on the DOM it produced.
 *
 * ## What is deliberately not touched
 *
 * `[data-reported]` and everything inside `translate="no"`. Those are the
 * agent's bytes (ADR 0014). Leaving them alone is what makes the third
 * rendering a *third* proof of the byte-identity property rather than a
 * repetition of the first two: in this rendering every translated string on
 * screen differs from both catalogues, so a reported value that had
 * accidentally been routed through `t()` could not come out unchanged.
 */

/** How much longer a pseudo string is. Mirrors `PSEUDO_EXPANSION`. */
export const PSEUDO_EXPANSION = 0.35

/**
 * The padding. Mirrors the frontend's `FILLER`.
 *
 * Latin letters and umlauts, so the browser measures it with the same font it
 * measures a real translation with, and starting with a space so it wraps as
 * words instead of turning a label into one unbreakable token.
 */
export const PSEUDO_FILLER = ' ähnlich lange wörter'

/** A token that is in every lengthened string and in no real translation. */
export const PSEUDO_MARKER = 'ähnlich'

export interface PseudoLocaleReport {
  /** Text nodes that were lengthened. */
  textNodes: number
  /** Name-bearing attributes that were lengthened. */
  attributes: number
  /** Nodes left alone because they carry reported data. */
  keptReported: number
}

/**
 * Lengthens every text the cockpit owns on the page as it currently stands.
 *
 * Returns what it did, because a transformation that silently touched nothing
 * would make every assertion after it pass for the wrong reason.
 */
export async function applyPseudoLocale(page: Page): Promise<PseudoLocaleReport> {
  return page.evaluate(
    ({ expansion, filler }) => {
      const pad = (text: string): string => {
        const length = Math.round(text.length * expansion)
        if (length === 0) return text
        let padding = ''
        while (padding.length < length) padding += filler
        return text + padding.slice(0, length)
      }

      const isReported = (node: Node | null): boolean => {
        let element =
          node instanceof Element ? node : (node?.parentElement ?? null)
        while (element !== null) {
          if (
            element.hasAttribute('data-reported') ||
            element.getAttribute('translate') === 'no'
          ) {
            return true
          }
          element = element.parentElement
        }
        return false
      }

      let textNodes = 0
      let attributes = 0
      let keptReported = 0

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const pending: Text[] = []
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const parent = node.parentElement
        if (parent === null) continue
        if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue
        if ((node.data ?? '').trim().length < 2) continue
        if (isReported(node)) {
          keptReported += 1
          continue
        }
        pending.push(node)
      }
      for (const node of pending) {
        node.data = pad(node.data)
        textNodes += 1
      }

      for (const attribute of ['aria-label', 'title', 'placeholder']) {
        for (const element of Array.from(document.querySelectorAll(`[${attribute}]`))) {
          const value = element.getAttribute(attribute) ?? ''
          if (value.trim().length < 2) continue
          if (isReported(element)) {
            keptReported += 1
            continue
          }
          element.setAttribute(attribute, pad(value))
          attributes += 1
        }
      }

      document.documentElement.setAttribute('data-pseudo-locale', 'applied')
      return { textNodes, attributes, keptReported }
    },
    { expansion: PSEUDO_EXPANSION, filler: PSEUDO_FILLER },
  )
}

/**
 * Whether the lengthened text is still what the browser is laying out.
 *
 * The expansion is a DOM edit, and React owns this DOM. A re-render between the
 * edit and the measurement would quietly restore the short texts and every
 * layout assertion after it would then be measuring German again — green, and
 * nothing tested. This is the guard against that; it is asserted, not logged.
 */
export async function pseudoLocaleStillApplied(page: Page): Promise<boolean> {
  return page.evaluate(
    (marker) =>
      document.documentElement.getAttribute('data-pseudo-locale') === 'applied' &&
      (document.body.innerText ?? '').includes(marker),
    PSEUDO_MARKER,
  )
}
