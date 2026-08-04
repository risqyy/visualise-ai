import { describe, expect, it } from 'vitest'

import { nextScrollTop } from './scrollStability'

/**
 * The arithmetic of the scroll anchor.
 *
 * jsdom has no layout engine, so `getBoundingClientRect` is all zeros there and
 * the DOM part of `useStableScroll` cannot be exercised meaningfully in a unit
 * test. The correction itself can, and it is where an off-by-one would move the
 * reader; the behavioural guarantee is asserted end to end in
 * `InspectorPane.test.tsx`.
 */
describe('nextScrollTop', () => {
  it('moves the viewport by exactly the amount the anchor moved', () => {
    expect(nextScrollTop(400, 120, 2000)).toBe(520)
  })

  it('corrects upwards when content above the anchor disappeared', () => {
    expect(nextScrollTop(400, -120, 2000)).toBe(280)
  })

  it('never scrolls above the top', () => {
    expect(nextScrollTop(40, -200, 2000)).toBe(0)
  })

  it('never scrolls past the end of the content', () => {
    expect(nextScrollTop(1900, 300, 2000)).toBe(2000)
  })

  it('leaves the offset alone when nothing moved', () => {
    expect(nextScrollTop(613, 0, 2000)).toBe(613)
  })
})
