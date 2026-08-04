/**
 * Progressive detail levels of the architecture canvas.
 *
 * A v0 model can carry a few hundred components. Rendering every technology
 * string, every tag and every relationship label at every zoom level turns the
 * overview into noise long before that. The canvas therefore shows strictly
 * more the closer the user is:
 *
 * | level      | nodes                        | edges                                  |
 * | ---------- | ---------------------------- | -------------------------------------- |
 * | `overview` | name + kind                  | bundled, count badge only              |
 * | `standard` | + technology                 | bundled, kind badge + count            |
 * | `full`     | + tags                       | bundles fanned out, one label per edge |
 *
 * Two rules keep this from becoming a source of surprise:
 *
 * 1. The **node box size never changes** with the level (see
 *    `LEAF_NODE_SIZE`). Only the content inside it does, so the layout — and
 *    therefore the position of everything under the camera — is invariant.
 * 2. The levels are a *shortcut*, not a gate. Anything hidden at `overview`
 *    remains reachable by interaction at that same zoom level: a bundle can be
 *    unfolded by clicking it, and the inspector always has the full detail.
 */
export type DetailLevel = 'overview' | 'standard' | 'full'

/**
 * Zoom thresholds. Chosen so that the default `fitView` of a mid-sized model at
 * 1920 × 1080 lands in `standard`, a fitted large model in `overview`, and
 * reading a single component in `full`.
 */
export const DETAIL_LEVEL_THRESHOLDS = {
  /** At or above this zoom the technology metadata appears. */
  standard: 0.62,
  /** At or above this zoom tags appear and edge bundles fan out. */
  full: 1.15,
} as const

export function detailLevelForZoom(zoom: number): DetailLevel {
  if (!Number.isFinite(zoom)) return 'standard'
  if (zoom >= DETAIL_LEVEL_THRESHOLDS.full) return 'full'
  if (zoom >= DETAIL_LEVEL_THRESHOLDS.standard) return 'standard'
  return 'overview'
}

export const DETAIL_LEVEL_LABELS: Record<DetailLevel, string> = {
  overview: 'Übersicht',
  standard: 'Standard',
  full: 'Vollständig',
}

export const DETAIL_LEVEL_DESCRIPTIONS: Record<DetailLevel, string> = {
  overview: 'Nur Name und Art. Parallele Beziehungen sind gebündelt.',
  standard: 'Zusätzlich die gemeldete Technologie. Parallele Beziehungen sind gebündelt.',
  full: 'Zusätzlich Tags. Gebündelte Beziehungen sind einzeln aufgefächert.',
}

/** `true` once the level is detailed enough to show technology metadata. */
export function showsTechnology(level: DetailLevel): boolean {
  return level !== 'overview'
}

/** `true` once the level is detailed enough to show tags. */
export function showsTags(level: DetailLevel): boolean {
  return level === 'full'
}

/**
 * `true` once bundles are unfolded automatically. Below this level a bundle can
 * still be unfolded by clicking it — the zoom is a shortcut, not a gate.
 */
export function unfoldsBundles(level: DetailLevel): boolean {
  return level === 'full'
}
