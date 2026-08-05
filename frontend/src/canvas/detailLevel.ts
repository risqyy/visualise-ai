import type { CanvasKey } from '@/i18n'

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

// ---------------------------------------------------------------------------
// Readability: the floor under the *automatic* camera
// ---------------------------------------------------------------------------

/**
 * `font-size` of the text that identifies a node — the component name in
 * `ComponentNode` and in the `CompoundNode` header (`text-[13px]`).
 *
 * It is repeated here as a number because the readable zoom below is derived
 * from it. A change to the class has to change this constant, and
 * `detailLevel.test.ts` is what makes that visible.
 */
export const NODE_LABEL_FONT_SIZE_PX = 13

/**
 * The smallest type the design system renders at zoom 1: `text-[10px]`, used
 * for the kind badge, the technology row, the tags and the legends.
 *
 * This is the product's own legibility floor. It is not a number invented for
 * this rule — it is the size the cockpit already considers readable everywhere
 * that is *not* under a zoom transform.
 */
export const MIN_LEGIBLE_FONT_SIZE_PX = 10

/**
 * Smallest zoom at which a node is still readable.
 *
 * The canvas draws its nodes inside a CSS transform, so every glyph on them is
 * scaled by the zoom: the effective size of the component name is
 * `NODE_LABEL_FONT_SIZE_PX × zoom`. Requiring that product to stay at or above
 * the product's own legibility floor gives
 *
 * ```
 * 13 px × zoom ≥ 10 px   ⇒   zoom ≥ 10 / 13 ≈ 0.7692
 * ```
 *
 * rounded *up* to 0.77, so the floor is never undercut by the rounding. At that
 * zoom a leaf node measures 228 × 96 × 0.77 ≈ 176 × 74 CSS px and its name
 * renders at 10.0 px — against 46 × 20 px and 2.6 px at the zoom a 28-component
 * model used to be fitted to.
 *
 * The floor applies to the **automatic** camera only: the first picture of a
 * project, which the user did not ask for. An explicit "Gesamtes Modell
 * einpassen" still zooms out as far as the model needs, because the user asked
 * for the overview and knows what they traded for it.
 */
export const MIN_READABLE_ZOOM =
  Math.ceil((MIN_LEGIBLE_FONT_SIZE_PX / NODE_LABEL_FONT_SIZE_PX) * 100) / 100

/** Effective size of the node label on screen at a given zoom, in CSS px. */
export function effectiveLabelSize(zoom: number): number {
  return NODE_LABEL_FONT_SIZE_PX * zoom
}

/** `true` when a node's name is at or above the legibility floor at this zoom. */
export function isReadableZoom(zoom: number): boolean {
  return effectiveLabelSize(zoom) >= MIN_LEGIBLE_FONT_SIZE_PX
}

// ---------------------------------------------------------------------------
// Progressive disclosure: how much of the hierarchy is open to begin with
// ---------------------------------------------------------------------------

/**
 * Hierarchy levels a project opens with.
 *
 * `1` means: root components (depth 0) and their direct children (depth 1) are
 * drawn, and every container **below** that starts collapsed. On a reported
 * architecture that is exactly the system and container level — the levels that
 * describe what the thing *is*, rather than how one of its parts is built.
 *
 * Depth is a property of the reported hierarchy, not of the zoom, so the rule
 * is independent of the number of components: a model with 30, 300 or 3000
 * components opens with the same handful of top-level boxes.
 *
 * The disclosure is deliberately **not** driven by the zoom. Showing or hiding
 * a container's children changes the ELK input and therefore the layout; if
 * that were bound to the zoom, zooming in would move every box under the
 * camera — the one motion ADR 0008 exists to prevent. Expanding is an explicit
 * act instead, and the camera stays where it was while the boxes rearrange.
 */
export const INITIAL_EXPANDED_DEPTH = 1

/**
 * Every text the disclosure controls show, as translation keys.
 *
 * Collected in one object rather than spread over the components so two
 * controls cannot drift into naming the same action differently. Since #42 the
 * values are keys of the `canvas` namespace instead of German strings; a key
 * that does not exist there is a `tsc` error, not a bare label in the browser.
 */
export const DISCLOSURE_LABEL_KEYS = {
  expand: 'tool.expand',
  collapse: 'tool.collapse',
  /** Takes the counted hidden components as `{{hidden}}`. */
  expandHidden: 'tool.expandHidden',
  fitWholeModel: 'tool.fitWholeModel',
  fitWholeModelHint: 'tool.fitWholeModelHint',
  backToOverview: 'tool.backToOverview',
  backToOverviewHint: 'tool.backToOverviewHint',
  /** Takes `{{visible}}` and `{{total}}`. */
  visibility: 'visibility.summary',
  visibilityHint: 'visibility.hint',
} as const satisfies Record<string, CanvasKey>

export const DETAIL_LEVEL_LABEL_KEYS: Record<DetailLevel, CanvasKey> = {
  overview: 'detail.overviewLabel',
  standard: 'detail.standardLabel',
  full: 'detail.fullLabel',
}

export const DETAIL_LEVEL_DESCRIPTION_KEYS: Record<DetailLevel, CanvasKey> = {
  overview: 'detail.overviewDescription',
  standard: 'detail.standardDescription',
  full: 'detail.fullDescription',
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
