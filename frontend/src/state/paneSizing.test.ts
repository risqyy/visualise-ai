import { describe, expect, it } from 'vitest'

import {
  COLLAPSED_PANE_SIZE,
  DEEP_FOCUS_PANE_LAYOUT,
  DEFAULT_PANE_LAYOUT,
  MIN_SUPPORTED_WIDTH,
  PANE_IDS,
  PANE_MAX_WIDTH,
  PANE_MIN_WIDTH_PX,
  type PaneId,
  type PaneLayout,
} from '@/state/uiStore'

/**
 * The pane geometry of issue #41, asserted as arithmetic.
 *
 * jsdom lays nothing out — every element is 0 × 0 — so `react-resizable-panels`
 * cannot be observed resolving a constraint here. What *can* be checked, and
 * what actually breaks in practice, is whether the numbers the panel group is
 * given are consistent with each other at the widths the cockpit is used at.
 * The rendered result is measured in Chromium by `e2e/tests/08-viewport.spec.ts`.
 */

/**
 * Widths the cockpit has to work at.
 *
 * 1280 and 1440 are the desktop windows named in issue #41, 1920 is the
 * mandatory acceptance surface (epic #1), and 1536 / 1280 are what that
 * acceptance surface becomes at 125 % and 150 % browser zoom — which is the
 * same measurement, since zoom changes the CSS viewport and nothing else.
 */
const SUPPORTED_WIDTHS = [1280, 1440, 1536, 1920] as const

/** Two 1 px separators sit between the three panes. */
const SEPARATOR_WIDTH = 2

/** A pane's share of `windowWidth`, in pixels. A missing key is a test failure. */
function paneWidth(layout: PaneLayout, paneId: PaneId, windowWidth: number): number {
  const share = layout[paneId]
  if (share === undefined) throw new Error(`layout has no entry for ${paneId}`)
  return (share / 100) * (windowWidth - SEPARATOR_WIDTH)
}

const railWidth = (windowWidth: number) =>
  (COLLAPSED_PANE_SIZE / 100) * (windowWidth - SEPARATOR_WIDTH)

const sumOfShares = (layout: PaneLayout) =>
  Object.values(layout).reduce((total, share) => total + share, 0)

describe('pane minimums', () => {
  it('are absolute pixels, so they do not shrink with the window', () => {
    // The regression this guards: percentage minimums looked fine at 1920 and
    // let a pane fall to 154 px at 1280.
    for (const minimum of Object.values(PANE_MIN_WIDTH_PX)) {
      expect(typeof minimum).toBe('number')
      expect(minimum).toBeGreaterThan(0)
    }
  })

  it('fit together into the narrowest supported window', () => {
    const total =
      PANE_MIN_WIDTH_PX[PANE_IDS.left] +
      PANE_MIN_WIDTH_PX[PANE_IDS.center] +
      PANE_MIN_WIDTH_PX[PANE_IDS.right] +
      SEPARATOR_WIDTH

    expect(total).toBeLessThanOrEqual(MIN_SUPPORTED_WIDTH)
    // Every supported width is at least the narrowest one; a new entry that
    // undercuts it would need its own decision, not a silent pass.
    for (const width of SUPPORTED_WIDTHS) {
      expect(width).toBeGreaterThanOrEqual(MIN_SUPPORTED_WIDTH)
    }
  })

  it('give the architecture surface the most room of the three', () => {
    expect(PANE_MIN_WIDTH_PX[PANE_IDS.center]).toBeGreaterThan(
      PANE_MIN_WIDTH_PX[PANE_IDS.left],
    )
    expect(PANE_MIN_WIDTH_PX[PANE_IDS.center]).toBeGreaterThan(
      PANE_MIN_WIDTH_PX[PANE_IDS.right],
    )
  })

  it('stay below what a collapsed rail is allowed to be', () => {
    // A collapsed pane is deliberately far below its minimum — `collapsedSize`
    // is the escape hatch that makes the rail possible at all.
    expect(railWidth(MIN_SUPPORTED_WIDTH)).toBeLessThan(
      PANE_MIN_WIDTH_PX[PANE_IDS.left],
    )
  })
})

describe('default split', () => {
  it('adds up to the whole window and names every pane', () => {
    for (const layout of [DEFAULT_PANE_LAYOUT, DEEP_FOCUS_PANE_LAYOUT]) {
      expect(sumOfShares(layout)).toBe(100)
      expect(Object.keys(layout).sort()).toEqual([...Object.values(PANE_IDS)].sort())
    }
  })

  it('keeps the architecture surface the widest pane at every supported width', () => {
    // The product rule of ADR 0008, stated as a share so it holds at any width.
    for (const width of SUPPORTED_WIDTHS) {
      const left = paneWidth(DEFAULT_PANE_LAYOUT, PANE_IDS.left, width)
      const center = paneWidth(DEFAULT_PANE_LAYOUT, PANE_IDS.center, width)
      const right = paneWidth(DEFAULT_PANE_LAYOUT, PANE_IDS.right, width)

      expect(center).toBeGreaterThan(left)
      expect(center).toBeGreaterThan(right)
      expect(center).toBeGreaterThan(left + right)
    }
  })

  it('never asks the architecture surface for less than its minimum', () => {
    // The side panes may well be clamped up at 1280 — that is what a minimum is
    // for, and the space comes out of the centre. The centre itself must never
    // need clamping, because there is nothing left to take it from.
    for (const width of SUPPORTED_WIDTHS) {
      const center = paneWidth(DEFAULT_PANE_LAYOUT, PANE_IDS.center, width)
      expect(center).toBeGreaterThanOrEqual(PANE_MIN_WIDTH_PX[PANE_IDS.center])
    }
  })

  it('leaves every pane its minimum even where a share falls short of it', () => {
    // What the panel group has to be able to resolve at the narrowest width:
    // clamp the short pane up and take the difference from a pane that has it.
    const width = MIN_SUPPORTED_WIDTH
    const clamped = {
      left: Math.max(
        paneWidth(DEFAULT_PANE_LAYOUT, PANE_IDS.left, width),
        PANE_MIN_WIDTH_PX[PANE_IDS.left],
      ),
      right: Math.max(
        paneWidth(DEFAULT_PANE_LAYOUT, PANE_IDS.right, width),
        PANE_MIN_WIDTH_PX[PANE_IDS.right],
      ),
    }
    const remainingForCenter = width - SEPARATOR_WIDTH - clamped.left - clamped.right

    expect(remainingForCenter).toBeGreaterThanOrEqual(PANE_MIN_WIDTH_PX[PANE_IDS.center])
    expect(remainingForCenter).toBeGreaterThan(clamped.left)
    expect(remainingForCenter).toBeGreaterThan(clamped.right)
  })
})

describe('deep focus split', () => {
  it('folds the run pane into its rail and keeps the canvas above its minimum', () => {
    expect(DEEP_FOCUS_PANE_LAYOUT[PANE_IDS.left]).toBe(COLLAPSED_PANE_SIZE)

    for (const width of SUPPORTED_WIDTHS) {
      const center = paneWidth(DEEP_FOCUS_PANE_LAYOUT, PANE_IDS.center, width)
      expect(center).toBeGreaterThanOrEqual(PANE_MIN_WIDTH_PX[PANE_IDS.center])
    }
  })

  it('fits inside the inspector maximum', () => {
    // Deep focus is the one documented exception to "the canvas is the widest
    // pane" (ADR 0008). Tightening the maximum below it would silently turn the
    // mode into a clamped, slightly-off split instead of failing loudly.
    const inspectorMax = Number.parseFloat(PANE_MAX_WIDTH.right)
    expect(PANE_MAX_WIDTH.right.endsWith('%')).toBe(true)
    expect(DEEP_FOCUS_PANE_LAYOUT[PANE_IDS.right] ?? 0).toBeLessThanOrEqual(inspectorMax)
    expect(DEEP_FOCUS_PANE_LAYOUT[PANE_IDS.right] ?? 0).toBeGreaterThan(0)
  })

  it('caps the run pane below half the window, so it can never dominate', () => {
    const runPaneMax = Number.parseFloat(PANE_MAX_WIDTH.left)
    expect(PANE_MAX_WIDTH.left.endsWith('%')).toBe(true)
    expect(runPaneMax).toBeLessThan(50)
  })
})
