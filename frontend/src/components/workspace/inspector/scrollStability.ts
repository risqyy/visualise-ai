import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * Keeping the reader's place while the inspector updates underneath them.
 *
 * The cockpit is watched while an agent works, and the read API serves
 * component evidence **newest first**. A `diff.reported` that arrives while
 * someone is reading therefore appears *above* what they are looking at, and a
 * naive re-render moves that content down by the height of the new entry —
 * the reader loses their line even though nothing they selected changed.
 * ADR 0003 states the rule this implements: a live update never disturbs the
 * user.
 *
 * The mechanism is an anchor, not a scroll position:
 *
 * * While the user scrolls, the topmost element carrying `data-scroll-anchor`
 *   that is still visible is remembered together with its distance from the top
 *   of the viewport.
 * * After a content change, that element is looked up again and the scroll
 *   offset is corrected so it sits at the same distance again.
 *
 * Remembering the raw `scrollTop` would be wrong: it is exactly the number that
 * has to change when content is inserted above. Remembering nothing would be
 * wrong too — the browser keeps `scrollTop` and the content slides.
 *
 * Nothing is restored while the viewport is at the very top: there is nothing
 * to lose there, and pinning it would fight the natural "newest on top" view.
 */

/** Attribute an element must carry to be usable as an anchor. */
export const SCROLL_ANCHOR_ATTRIBUTE = 'data-scroll-anchor'

export interface ScrollAnchor {
  /** Value of `data-scroll-anchor` of the remembered element. */
  id: string
  /** Distance in pixels between the viewport top and the element's top. */
  viewportOffset: number
}

/**
 * The corrected scroll offset after the anchored element moved by `shift`
 * pixels, clamped to the scrollable range.
 *
 * Pure so the arithmetic is testable without a layout engine, which jsdom does
 * not have.
 */
export function nextScrollTop(
  currentScrollTop: number,
  shift: number,
  maxScrollTop: number,
): number {
  const target = currentScrollTop + shift
  if (target < 0) return 0
  if (target > maxScrollTop) return maxScrollTop
  return target
}

/** Finds the topmost anchor that is still visible in `viewport`. */
export function findScrollAnchor(viewport: HTMLElement): ScrollAnchor | null {
  const viewportTop = viewport.getBoundingClientRect().top

  for (const element of anchorElements(viewport)) {
    const id = element.getAttribute(SCROLL_ANCHOR_ATTRIBUTE)
    if (!id) continue
    const rect = element.getBoundingClientRect()
    // The first anchor whose bottom edge has not yet left the viewport is what
    // the reader is looking at.
    if (rect.bottom <= viewportTop) continue
    return { id, viewportOffset: rect.top - viewportTop }
  }

  return null
}

function anchorElements(viewport: HTMLElement): HTMLElement[] {
  return [...viewport.querySelectorAll<HTMLElement>(`[${SCROLL_ANCHOR_ATTRIBUTE}]`)]
}

/**
 * Props for the scroll container. Returned as one object so the caller spreads
 * them instead of reading `.ref` in JSX — the two always belong together, and a
 * container that has the callback ref but not the scroll handler would silently
 * never capture an anchor.
 */
export interface StableScrollProps {
  ref: (element: HTMLElement | null) => void
  onScroll: () => void
}

/**
 * Pins the anchored element whenever `signature` changes.
 *
 * `signature` is a cheap description of the rendered content — the ids of the
 * entries in order. It changes exactly when an update inserted, removed or
 * reordered something, and not when an unrelated part of the pane re-rendered.
 */
export function useStableScroll(signature: string): StableScrollProps {
  const viewportRef = useRef<HTMLElement | null>(null)
  const anchorRef = useRef<ScrollAnchor | null>(null)

  const captureAnchor = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    // At the top there is nothing above the reader that could push them down.
    anchorRef.current = viewport.scrollTop <= 0 ? null : findScrollAnchor(viewport)
  }, [])

  const ref = useCallback((element: HTMLElement | null) => {
    viewportRef.current = element
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const anchor = anchorRef.current
    if (!viewport || !anchor) return

    const element = anchorElements(viewport).find(
      (candidate) => candidate.getAttribute(SCROLL_ANCHOR_ATTRIBUTE) === anchor.id,
    )
    // The anchored entry is gone — a retraction, a run switch. Leaving the
    // offset alone is better than guessing a new place for the reader.
    if (!element) return

    const viewportTop = viewport.getBoundingClientRect().top
    const shift = element.getBoundingClientRect().top - viewportTop - anchor.viewportOffset
    if (Math.abs(shift) < 1) return

    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    viewport.scrollTop = nextScrollTop(viewport.scrollTop, shift, maxScrollTop)
  }, [signature])

  return { ref, onScroll: captureAnchor }
}
