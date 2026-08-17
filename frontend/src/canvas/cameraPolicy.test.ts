import { describe, expect, it } from 'vitest'

import {
  FIT_VIEW_PADDING,
  INITIAL_CAMERA_POLICY,
  MIN_FIT_VIEWPORT,
  isBoundsFullyVisible,
  onLayoutReady,
  onProjectChanged,
  onUserFitRequest,
  viewportForBounds,
  viewportForFocus,
  type CameraPolicyInput,
} from './cameraPolicy'
import { MIN_LEGIBLE_FONT_SIZE_PX, MIN_READABLE_ZOOM } from './detailLevel'
import { LEAF_NODE_SIZE } from './graphProjection'

/** A settled 1920 × 1080 workspace: the centre pane is ~1036 × 933. */
const SURFACE = { width: 1036, height: 933 }

function input(overrides: Partial<CameraPolicyInput> = {}): CameraPolicyInput {
  return {
    projectId: 'visualise-ai',
    hasLayout: true,
    viewport: SURFACE,
    userMovedCamera: false,
    ...overrides,
  }
}

describe('camera policy', () => {
  it('fits the view once, for the first model of a project', () => {
    const first = onLayoutReady(INITIAL_CAMERA_POLICY, input())
    expect(first.fit).toBe('initial-model')

    expect(onLayoutReady(first.state, input()).fit).toBeNull()
  })

  it('never fits again because the model changed', () => {
    let state = onLayoutReady(INITIAL_CAMERA_POLICY, input()).state

    // A component was added, one was removed, a snapshot replaced everything —
    // every one of these produces a new layout, and none of them may move the
    // camera the user set.
    for (let update = 0; update < 5; update += 1) {
      const decision = onLayoutReady(state, input())
      expect(decision.fit).toBeNull()
      state = decision.state
    }
  })

  it('waits for a layout before considering a fit', () => {
    const decision = onLayoutReady(INITIAL_CAMERA_POLICY, input({ hasLayout: false }))
    expect(decision.fit).toBeNull()
    expect(decision.state).toBe(INITIAL_CAMERA_POLICY)
  })

  it('waits for the surface to have a usable size', () => {
    // The panes measure themselves asynchronously; fitting against a pane that
    // is still a few pixels wide leaves the model at minimum zoom.
    const tooSmall = onLayoutReady(
      INITIAL_CAMERA_POLICY,
      input({ viewport: { width: MIN_FIT_VIEWPORT - 1, height: 900 } }),
    )
    expect(tooSmall.fit).toBeNull()
    expect(tooSmall.state.fittedProjectId).toBeNull()

    // Once it has one, the first fit happens against the real size.
    const settled = onLayoutReady(tooSmall.state, input())
    expect(settled.fit).toBe('initial-model')
    expect(settled.state.fittedSize).toEqual(SURFACE)
  })

  it('re-fits while the surface is still settling, but not after the user took over', () => {
    const initial = onLayoutReady(
      INITIAL_CAMERA_POLICY,
      input({ viewport: { width: 400, height: 900 } }),
    )
    expect(initial.fit).toBe('initial-model')

    // The pane grew to its real width before the user touched anything.
    const resized = onLayoutReady(initial.state, input())
    expect(resized.fit).toBe('surface-resized')
    expect(resized.state.fittedSize).toEqual(SURFACE)

    // The same size again changes nothing.
    expect(onLayoutReady(resized.state, input()).fit).toBeNull()

    // And once the user has panned or zoomed, even a resize leaves the camera
    // alone: it is theirs from that moment on.
    expect(
      onLayoutReady(
        resized.state,
        input({ viewport: { width: 700, height: 933 }, userMovedCamera: true }),
      ).fit,
    ).toBeNull()
  })

  it('does not treat a live update as a resize', () => {
    const state = onLayoutReady(INITIAL_CAMERA_POLICY, input()).state
    // Same surface, new model, user has not touched anything: still no move.
    expect(onLayoutReady(state, input()).fit).toBeNull()
  })

  it('always honours an explicit user request without consuming the initial fit', () => {
    const request = onUserFitRequest(INITIAL_CAMERA_POLICY)
    expect(request.fit).toBe('user-request')
    expect(request.state).toEqual(INITIAL_CAMERA_POLICY)

    expect(onUserFitRequest(onUserFitRequest(INITIAL_CAMERA_POLICY).state).fit).toBe(
      'user-request',
    )
  })

  it('treats the first model of another project as an initial one again', () => {
    const fitted = onLayoutReady(
      INITIAL_CAMERA_POLICY,
      input({ projectId: 'project-a' }),
    ).state

    expect(onProjectChanged(fitted, 'project-a')).toBe(fitted)

    const switched = onProjectChanged(fitted, 'project-b')
    expect(switched).toEqual(INITIAL_CAMERA_POLICY)
    expect(onLayoutReady(switched, input({ projectId: 'project-b' })).fit).toBe(
      'initial-model',
    )
  })
})

describe('where the camera goes', () => {
  /** The layout of `visualise-ai-self`, all 28 components expanded. */
  const WHOLE_MODEL = { x: 0, y: 0, width: 4684, height: 1263 }
  /** The same model on its system and container level, everything else closed. */
  const TOP_LEVELS = { x: 0, y: 0, width: 1944, height: 518 }

  it('centres a model that fits, exactly like a plain fit does', () => {
    const bounds = { x: 0, y: 0, width: 600, height: 400 }
    const viewport = viewportForBounds(bounds, SURFACE, { minZoom: 0.12 })

    // Small model, so the fit is capped at 1 rather than blown up.
    expect(viewport.zoom).toBe(1)
    expect(viewport.x).toBeCloseTo(SURFACE.width / 2 - 300, 5)
    expect(viewport.y).toBeCloseTo(SURFACE.height / 2 - 200, 5)
  })

  it('never opens a large model below the readable zoom', () => {
    const automatic = viewportForBounds(TOP_LEVELS, SURFACE, {
      minZoom: MIN_READABLE_ZOOM,
      overflow: 'start',
    })

    // Fitting all of it would need 0.48; the floor wins.
    expect(automatic.zoom).toBe(MIN_READABLE_ZOOM)
    expect(LEAF_NODE_SIZE.width * automatic.zoom).toBeGreaterThan(170)
    expect(13 * automatic.zoom).toBeGreaterThanOrEqual(MIN_LEGIBLE_FONT_SIZE_PX)
  })

  it('holds the floor however many components there are', () => {
    for (const width of [2_000, 20_000, 200_000]) {
      const viewport = viewportForBounds({ x: 0, y: 0, width, height: width / 4 }, SURFACE, {
        minZoom: MIN_READABLE_ZOOM,
        overflow: 'start',
      })
      expect(viewport.zoom).toBe(MIN_READABLE_ZOOM)
    }
  })

  it('anchors an oversized model at its top-left corner rather than its middle', () => {
    const anchored = viewportForBounds(TOP_LEVELS, SURFACE, {
      minZoom: MIN_READABLE_ZOOM,
      overflow: 'start',
    })
    const centred = viewportForBounds(TOP_LEVELS, SURFACE, {
      minZoom: MIN_READABLE_ZOOM,
    })

    // The layout runs left to right with the callers first, so its beginning is
    // where the picture is read from. Centring would start in mid-sentence.
    const gap = (SURFACE.width * FIT_VIEW_PADDING) / (2 * (1 + FIT_VIEW_PADDING))
    expect(anchored.x).toBeCloseTo(gap, 5)
    expect(centred.x).toBeLessThan(0)

    // The height fits at this zoom, so that axis is centred either way.
    expect(anchored.y).toBeCloseTo(centred.y, 5)
  })

  it('lets an explicit request zoom out as far as the whole model needs', () => {
    const overview = viewportForBounds(WHOLE_MODEL, SURFACE, { minZoom: 0.12 })

    // This is the number the issue complains about — and it is fine here,
    // because the user asked to see everything at once.
    expect(overview.zoom).toBeCloseTo(0.2, 2)
    expect(overview.zoom).toBeLessThan(MIN_READABLE_ZOOM)
  })

  it('pans a focus that would fall off the edge back onto the surface', () => {
    // A node four levels down, far to the right of a model that does not fit at
    // the readable zoom. Without the focus it sat past the right edge: drawn,
    // selected, described by the inspector — and nowhere on screen.
    const node = { x: 1700, y: 300, width: 228, height: 96 }

    const blind = viewportForBounds(TOP_LEVELS, SURFACE, {
      minZoom: MIN_READABLE_ZOOM,
      overflow: 'start',
    })
    expect(node.x * blind.zoom + blind.x + node.width * blind.zoom).toBeGreaterThan(
      SURFACE.width,
    )

    const focused = viewportForBounds(TOP_LEVELS, SURFACE, {
      minZoom: MIN_READABLE_ZOOM,
      overflow: 'start',
      focus: node,
    })

    const left = node.x * focused.zoom + focused.x
    const top = node.y * focused.zoom + focused.y
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(left + node.width * focused.zoom).toBeLessThanOrEqual(SURFACE.width)
    expect(top + node.height * focused.zoom).toBeLessThanOrEqual(SURFACE.height)

    // Panned, never zoomed: the readability floor is not the price of a link.
    expect(focused.zoom).toBe(blind.zoom)
  })

  it('leaves the camera alone for a focus that is already on screen', () => {
    const options = {
      minZoom: MIN_READABLE_ZOOM,
      overflow: 'start' as const,
    }
    const without = viewportForBounds(TOP_LEVELS, SURFACE, options)
    const withFocus = viewportForBounds(TOP_LEVELS, SURFACE, {
      ...options,
      focus: { x: 40, y: 40, width: 228, height: 96 },
    })
    expect(withFocus).toEqual(without)
  })

  it('moves an explicit focus by the minimum pan and preserves zoom', () => {
    const current = { x: 0, y: 0, zoom: 0.77 }
    const focused = viewportForFocus(
      current,
      { x: 1500, y: 100, width: 228, height: 96 },
      SURFACE,
    )

    expect(focused.zoom).toBe(current.zoom)
    expect(focused.x).toBeLessThan(current.x)
    expect(focused.y).toBe(current.y)

    // Once visible, the same explicit action is a no-op rather than a recenter.
    const repeated = viewportForFocus(
      focused,
      { x: 1500, y: 100, width: 228, height: 96 },
      SURFACE,
    )
    expect(repeated.zoom).toBe(focused.zoom)
    expect(repeated.x).toBeCloseTo(focused.x, 10)
    expect(repeated.y).toBeCloseTo(focused.y, 10)
  })

  it('only marks a selection for jumping when it crosses the real viewport edge', () => {
    const current = { x: 0, y: 0, zoom: 1 }
    const nearRightEdge = { x: 800, y: 100, width: 228, height: 96 }
    const justOffscreen = { x: 809, y: 100, width: 228, height: 96 }

    expect(isBoundsFullyVisible(current, nearRightEdge, SURFACE)).toBe(true)
    expect(isBoundsFullyVisible(current, justOffscreen, SURFACE)).toBe(false)
  })

  it('shows where an oversized focus begins rather than where it ends', () => {
    // A container wider than the surface cannot be contained; its top-left is
    // the part worth showing, for the same reason `overflow: start` exists.
    const huge = { x: 900, y: 0, width: 4000, height: 200 }
    const viewport = viewportForBounds(TOP_LEVELS, SURFACE, {
      minZoom: MIN_READABLE_ZOOM,
      overflow: 'start',
      focus: huge,
    })
    const left = huge.x * viewport.zoom + viewport.x
    expect(left).toBeGreaterThan(0)
    expect(left).toBeLessThan(SURFACE.width / 2)
  })

  it('never returns a zoom outside the canvas limits', () => {
    const clamped = viewportForBounds({ x: 0, y: 0, width: 10, height: 10 }, SURFACE, {
      minZoom: MIN_READABLE_ZOOM,
      maxZoom: 1,
    })
    expect(clamped.zoom).toBe(1)
  })
})
