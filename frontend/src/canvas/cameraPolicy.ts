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
