import { describe, expect, it } from 'vitest'

import {
  INITIAL_CAMERA_POLICY,
  MIN_FIT_VIEWPORT,
  onLayoutReady,
  onProjectChanged,
  onUserFitRequest,
  type CameraPolicyInput,
} from './cameraPolicy'

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
