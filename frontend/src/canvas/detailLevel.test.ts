import { describe, expect, it } from 'vitest'

import { translateWith } from '@/test/translate'

import {
  DETAIL_LEVEL_LABEL_KEYS,
  DETAIL_LEVEL_THRESHOLDS,
  INITIAL_EXPANDED_DEPTH,
  MIN_LEGIBLE_FONT_SIZE_PX,
  MIN_PRIMARY_TEXT_SIZE_PX,
  MIN_SECONDARY_TEXT_SIZE_PX,
  MIN_READABLE_ZOOM,
  NODE_LABEL_FONT_SIZE_PX,
  detailLevelForZoom,
  effectiveLabelSize,
  effectiveSecondaryTextSize,
  isReadableZoom,
  isSecondaryTextReadable,
  showsKind,
  showsTags,
  showsTechnology,
  unfoldsBundles,
} from './detailLevel'
import { LEAF_NODE_SIZE } from './graphProjection'

describe('progressive detail levels', () => {
  it('shows only the primary name in the readable overview', () => {
    const level = detailLevelForZoom(0.94)
    expect(level).toBe('overview')
    expect(showsKind(level)).toBe(false)
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
    const order = { minimal: 0, overview: 1, standard: 2, full: 3 }
    let previous = -1
    for (let zoom = 0.05; zoom <= 3; zoom += 0.05) {
      const current = order[detailLevelForZoom(zoom)]
      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
    // A broken zoom value must not produce an undefined level.
    expect(detailLevelForZoom(Number.NaN)).toBe('minimal')
    // …and the level it produces still resolves to a real word, not a bare key.
    const t = translateWith('canvas')
    expect(t(DETAIL_LEVEL_LABEL_KEYS[detailLevelForZoom(Number.POSITIVE_INFINITY)])).toBe(
      'Karte',
    )
  })

  it('does not let the level influence the node box, and therefore the layout', () => {
    // The size is a constant, not a function of the level: if it were, zooming
    // would re-layout the graph and move everything under the camera.
    expect(LEAF_NODE_SIZE).toEqual({ width: 228, height: 96 })
  })
})

describe('the readable zoom', () => {
  it('is the zoom at which the node name reaches the smallest type of the design system', () => {
    // Not a chosen number: the node name is 13 px and the documented primary
    // text floor is 12 px, so the canvas may not scale it below 12 / 13 ≈
    // 0.923. Rounded up, never down.
    expect(NODE_LABEL_FONT_SIZE_PX).toBe(13)
    expect(MIN_PRIMARY_TEXT_SIZE_PX).toBe(12)
    expect(MIN_SECONDARY_TEXT_SIZE_PX).toBe(10)
    expect(MIN_LEGIBLE_FONT_SIZE_PX).toBe(MIN_PRIMARY_TEXT_SIZE_PX)
    expect(MIN_READABLE_ZOOM).toBe(0.93)
    expect(MIN_READABLE_ZOOM).toBeGreaterThanOrEqual(
      MIN_PRIMARY_TEXT_SIZE_PX / NODE_LABEL_FONT_SIZE_PX,
    )
  })

  it('measures readability as an effective size, not as a zoom level', () => {
    expect(effectiveLabelSize(MIN_READABLE_ZOOM)).toBeGreaterThanOrEqual(
      MIN_PRIMARY_TEXT_SIZE_PX,
    )
    expect(isReadableZoom(MIN_READABLE_ZOOM)).toBe(true)
    // The zoom a 28-component model used to be fitted to: a 2.6 px name.
    expect(isSecondaryTextReadable(1)).toBe(true)
    expect(isSecondaryTextReadable(0.99)).toBe(false)
    expect(effectiveSecondaryTextSize(0.77)).toBeCloseTo(7.7, 5)
    expect(isReadableZoom(0.2)).toBe(false)
    expect(effectiveLabelSize(0.2)).toBeCloseTo(2.6, 5)
  })

  it('turns the leaf box into something with room for a name', () => {
    const width = LEAF_NODE_SIZE.width * MIN_READABLE_ZOOM
    const height = LEAF_NODE_SIZE.height * MIN_READABLE_ZOOM
    expect(Math.round(width)).toBe(212)
    expect(Math.round(height)).toBe(89)
    // Against 46 × 20 at the old fitted zoom.
    expect(Math.round(LEAF_NODE_SIZE.width * 0.2)).toBe(46)
  })

  it('is a readable level, not the lowest detail level', () => {
    // A model opened at the readable zoom shows primary names only. 10 px
    // metadata waits for zoom 1, where it is still 10 px effective.
    expect(detailLevelForZoom(MIN_READABLE_ZOOM)).toBe('overview')
  })

  it('opens on the system and container levels', () => {
    expect(INITIAL_EXPANDED_DEPTH).toBe(1)
  })
})
