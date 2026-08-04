import { describe, expect, it } from 'vitest'

import {
  DETAIL_LEVEL_LABELS,
  DETAIL_LEVEL_THRESHOLDS,
  detailLevelForZoom,
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
