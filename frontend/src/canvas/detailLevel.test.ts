import { describe, expect, it } from 'vitest'

import {
  DETAIL_LEVEL_LABELS,
  DETAIL_LEVEL_THRESHOLDS,
  INITIAL_EXPANDED_DEPTH,
  MIN_LEGIBLE_FONT_SIZE_PX,
  MIN_READABLE_ZOOM,
  NODE_LABEL_FONT_SIZE_PX,
  detailLevelForZoom,
  effectiveLabelSize,
  isReadableZoom,
  showsTags,
  showsTechnology,
  unfoldsBundles,
} from './detailLevel'
import { LEAF_NODE_SIZE } from './graphProjection'

describe('progressive detail levels', () => {
  it('shows only name and kind when zoomed out', () => {
    const level = detailLevelForZoom(0.3)
    expect(level).toBe('overview')
    expect(showsTechnology(level)).toBe(false)
    expect(showsTags(level)).toBe(false)
    expect(unfoldsBundles(level)).toBe(false)
  })

  it('adds technology at medium zoom and tags when zoomed in', () => {
    const standard = detailLevelForZoom(DETAIL_LEVEL_THRESHOLDS.standard)
    expect(standard).toBe('standard')
    expect(showsTechnology(standard)).toBe(true)
    expect(showsTags(standard)).toBe(false)

    const full = detailLevelForZoom(DETAIL_LEVEL_THRESHOLDS.full)
    expect(full).toBe('full')
    expect(showsTechnology(full)).toBe(true)
    expect(showsTags(full)).toBe(true)
    expect(unfoldsBundles(full)).toBe(true)
  })

  it('is monotonic and total', () => {
    const order = { overview: 0, standard: 1, full: 2 }
    let previous = -1
    for (let zoom = 0.05; zoom <= 3; zoom += 0.05) {
      const current = order[detailLevelForZoom(zoom)]
      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
    // A broken zoom value must not produce an undefined level.
    expect(detailLevelForZoom(Number.NaN)).toBe('standard')
    expect(DETAIL_LEVEL_LABELS[detailLevelForZoom(Number.POSITIVE_INFINITY)]).toBeTruthy()
  })

  it('does not let the level influence the node box, and therefore the layout', () => {
    // The size is a constant, not a function of the level: if it were, zooming
    // would re-layout the graph and move everything under the camera.
    expect(LEAF_NODE_SIZE).toEqual({ width: 228, height: 96 })
  })
})

describe('the readable zoom', () => {
  it('is the zoom at which the node name reaches the smallest type of the design system', () => {
    // Not a chosen number: the node name is 13 px and the product's own floor
    // for legible type is 10 px, so the canvas may not scale a name below
    // 10 / 13 ≈ 0.769. Rounded up, never down.
    expect(NODE_LABEL_FONT_SIZE_PX).toBe(13)
    expect(MIN_LEGIBLE_FONT_SIZE_PX).toBe(10)
    expect(MIN_READABLE_ZOOM).toBe(0.77)
    expect(MIN_READABLE_ZOOM).toBeGreaterThanOrEqual(
      MIN_LEGIBLE_FONT_SIZE_PX / NODE_LABEL_FONT_SIZE_PX,
    )
  })

  it('measures readability as an effective size, not as a zoom level', () => {
    expect(effectiveLabelSize(MIN_READABLE_ZOOM)).toBeGreaterThanOrEqual(
      MIN_LEGIBLE_FONT_SIZE_PX,
    )
    expect(isReadableZoom(MIN_READABLE_ZOOM)).toBe(true)
    // The zoom a 28-component model used to be fitted to: a 2.6 px name.
    expect(isReadableZoom(0.2)).toBe(false)
    expect(effectiveLabelSize(0.2)).toBeCloseTo(2.6, 5)
  })

  it('turns the leaf box into something with room for a name', () => {
    const width = LEAF_NODE_SIZE.width * MIN_READABLE_ZOOM
    const height = LEAF_NODE_SIZE.height * MIN_READABLE_ZOOM
    expect(Math.round(width)).toBe(176)
    expect(Math.round(height)).toBe(74)
    // Against 46 × 20 at the old fitted zoom.
    expect(Math.round(LEAF_NODE_SIZE.width * 0.2)).toBe(46)
  })

  it('is a readable level, not the lowest detail level', () => {
    // A model opened at the readable zoom shows technology as well as names.
    expect(detailLevelForZoom(MIN_READABLE_ZOOM)).toBe('standard')
  })

  it('opens on the system and container levels', () => {
    expect(INITIAL_EXPANDED_DEPTH).toBe(1)
  })
})
