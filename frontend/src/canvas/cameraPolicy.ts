/**
 * When the canvas is allowed to move the camera by itself.
 *
 * The cockpit is watched while an agent works, and events arrive while the user
 * is reading. A canvas that re-centres itself on every incoming
 * `component.change_applied` makes the tool unusable exactly when it matters,
 * so the rule is deliberately narrow:
 *
 * > The camera moves by itself only while the surface is still settling into
 * > its first picture of a project. After that it belongs to the user.
 *
 * Concretely, three things and nothing else move it:
 *
 * 1. the first laid-out model of a project,
 * 2. a change of the *surface size* before the user has touched the camera —
 *    the three panes measure themselves asynchronously, so the very first fit
 *    can otherwise be computed against a pane that is still 100 px wide,
 * 3. an explicit click on "Einpassen".
 *
 * **A live update is never one of them** — not a new component, not a new
 * relationship, not a replacing snapshot. Data changes the model under a camera
 * that stays exactly where it was.
 *
 * The rule lives in this module rather than inside the canvas component so it
 * can be exercised directly, without a rendered React Flow.
 */
export type FitViewReason = 'initial-model' | 'surface-resized' | 'user-request'

export interface ViewportSize {
  width: number
  height: number
}

export interface CameraPolicyState {
  /** Project whose model has already been fitted, if any. */
  fittedProjectId: string | null
  /** Surface size that fit was computed against. */
  fittedSize: ViewportSize | null
}

export const INITIAL_CAMERA_POLICY: CameraPolicyState = {
  fittedProjectId: null,
  fittedSize: null,
}

/**
 * Smallest surface worth fitting to. Below this the pane is collapsed or has
 * not measured itself yet, and a fit would only produce a camera the user has
 * to undo.
 */
export const MIN_FIT_VIEWPORT = 240

export interface CameraPolicyInput {
  projectId: string
  /** `true` once a layout for this project exists and could be fitted. */
  hasLayout: boolean
  /** Current size of the canvas surface. */
  viewport: ViewportSize
  /** `true` once the user panned or zoomed themselves. */
  userMovedCamera: boolean
}

export interface CameraPolicyDecision {
  state: CameraPolicyState
  /** Non-null when the camera may be moved, carrying the reason why. */
  fit: FitViewReason | null
}

/**
 * Decides whether the arrival of a laid-out model — or a resize of the surface
 * it is drawn on — should move the camera.
 *
 * Called on every render with a layout. It returns a reason at most once per
 * project, plus while the surface is still finding its size and the user has
 * not taken over. A model that grows, shrinks or is replaced produces `null`,
 * which is the whole point.
 */
export function onLayoutReady(
  state: CameraPolicyState,
  input: CameraPolicyInput,
): CameraPolicyDecision {
  const { projectId, hasLayout, viewport, userMovedCamera } = input

  if (!hasLayout) return { state, fit: null }
  if (viewport.width < MIN_FIT_VIEWPORT || viewport.height < MIN_FIT_VIEWPORT) {
    return { state, fit: null }
  }

  if (state.fittedProjectId !== projectId) {
    return {
      state: { fittedProjectId: projectId, fittedSize: viewport },
      fit: 'initial-model',
    }
  }

  const settling =
    !userMovedCamera &&
    state.fittedSize !== null &&
    (state.fittedSize.width !== viewport.width ||
      state.fittedSize.height !== viewport.height)

  if (settling) {
    return { state: { ...state, fittedSize: viewport }, fit: 'surface-resized' }
  }

  return { state, fit: null }
}

/** The user pressed "fit view". Always allowed, and does not change the state. */
export function onUserFitRequest(state: CameraPolicyState): CameraPolicyDecision {
  return { state, fit: 'user-request' }
}

/**
 * Switching to another project makes that project's first model an initial one
 * again — the camera of project A means nothing in project B.
 */
export function onProjectChanged(
  state: CameraPolicyState,
  projectId: string,
): CameraPolicyState {
  return state.fittedProjectId === projectId ? state : INITIAL_CAMERA_POLICY
}

// ---------------------------------------------------------------------------
// Where the camera goes when it is allowed to move
// ---------------------------------------------------------------------------

/** Bounding box of the laid-out graph, in flow coordinates. */
export interface LayoutBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CameraViewport {
  x: number
  y: number
  zoom: number
}

/** Share of the surface kept free around the model. */
export const FIT_VIEW_PADDING = 0.1
/** Never zoom *in* to fit: a two-component model must not fill the screen. */
export const FIT_VIEW_MAX_ZOOM = 1

export interface ViewportOptions {
  /**
   * Smallest zoom the result may use. The automatic first camera passes the
   * readable zoom here, an explicit "fit the whole model" passes the canvas
   * minimum — that difference *is* the readability rule.
   */
  minZoom: number
  maxZoom?: number
  padding?: number
  /**
   * How to place a model that does not fit at `minZoom`. `center` keeps the
   * middle of the model on screen, `start` puts its top-left corner there.
   *
   * The initial camera uses `start`: the layout runs left to right with the
   * callers first (ADR 0008), so its top-left corner is where an architecture
   * is read from. Landing in the geometric middle of a model that does not fit
   * drops the reader somewhere in the middle of a sentence.
   */
  overflow?: 'center' | 'start'
}

/**
 * The viewport that shows `bounds` on a surface of `surface`.
 *
 * Deliberately computed here rather than taken from React Flow's
 * `getViewportForBounds`: the camera has to be a pure function of the ELK
 * layout (ADR 0008), and the two rules this canvas adds — a floor under the
 * zoom and an anchored overflow — are exactly the two things that function does
 * not do. With `minZoom` at the canvas minimum and `overflow: 'center'` it
 * reproduces React Flow's result.
 */
export function viewportForBounds(
  bounds: LayoutBounds,
  surface: ViewportSize,
  options: ViewportOptions,
): CameraViewport {
  const padding = options.padding ?? FIT_VIEW_PADDING
  const maxZoom = options.maxZoom ?? FIT_VIEW_MAX_ZOOM
  const overflow = options.overflow ?? 'center'

  const fitZoom = Math.min(
    surface.width / (bounds.width * (1 + padding)),
    surface.height / (bounds.height * (1 + padding)),
  )
  const zoom = clamp(fitZoom, Math.min(options.minZoom, maxZoom), maxZoom)

  return {
    x: axisOffset(surface.width, bounds.x, bounds.width, zoom, padding, overflow),
    y: axisOffset(surface.height, bounds.y, bounds.height, zoom, padding, overflow),
    zoom,
  }
}

function axisOffset(
  surfaceSize: number,
  boundsStart: number,
  boundsSize: number,
  zoom: number,
  padding: number,
  overflow: 'center' | 'start',
): number {
  const scaled = boundsSize * zoom
  // The same gap `padding` would leave on each side of a model that fits, so an
  // anchored model is inset exactly as far as a centred one.
  const gap = (surfaceSize * padding) / (2 * (1 + padding))
  if (overflow === 'start' && scaled + 2 * gap > surfaceSize) {
    return gap - boundsStart * zoom
  }
  return surfaceSize / 2 - (boundsStart + boundsSize / 2) * zoom
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
