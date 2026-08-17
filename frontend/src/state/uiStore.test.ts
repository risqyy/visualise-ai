import { describe, expect, it } from 'vitest'

import { DEEP_FOCUS_PANE_LAYOUT, resetUiStore, useUiStore } from '@/state/uiStore'

describe('architecture focus pane arrangement', () => {
  it('folds both side panes and restores the exact previous arrangement', () => {
    const previousLayout = {
      'workspace-left': 23,
      'workspace-center': 47,
      'workspace-right': 30,
    }
    useUiStore.setState({
      layout: previousLayout,
      leftCollapsed: true,
      rightCollapsed: false,
    })

    useUiStore.getState().enterArchitectureFocus()

    expect(useUiStore.getState()).toMatchObject({
      architectureFocus: true,
      layout: previousLayout,
      leftCollapsed: true,
      rightCollapsed: true,
      paneStateBeforeArchitectureFocus: {
        layout: previousLayout,
        leftCollapsed: true,
        rightCollapsed: false,
      },
    })

    // A user can still change unrelated transient state while the side panes
    // are folded; leaving focus must restore only the arrangement it replaced.
    useUiStore.getState().setSelectedComponentId('platform.orders')
    useUiStore.getState().exitArchitectureFocus()

    expect(useUiStore.getState()).toMatchObject({
      architectureFocus: false,
      layout: previousLayout,
      leftCollapsed: true,
      rightCollapsed: false,
      paneStateBeforeArchitectureFocus: null,
      selectedComponentId: 'platform.orders',
    })
  })

  it('does not overwrite the snapshot when the action is activated twice', () => {
    const initialLayout = { ...useUiStore.getState().layout }
    useUiStore.getState().enterArchitectureFocus()
    useUiStore.getState().setLayout({
      'workspace-left': 10,
      'workspace-center': 70,
      'workspace-right': 20,
    })
    useUiStore.getState().enterArchitectureFocus()
    useUiStore.getState().exitArchitectureFocus()

    expect(useUiStore.getState().layout).toEqual(initialLayout)
  })

  it('persists the original panes when deep focus and architecture focus are nested', () => {
    const original = {
      layout: {
        'workspace-left': 24,
        'workspace-center': 51,
        'workspace-right': 25,
      },
      leftCollapsed: false,
      rightCollapsed: true,
    }
    useUiStore.setState(original)

    useUiStore.getState().enterDeepFocus('diffs')
    useUiStore.getState().enterArchitectureFocus()

    const persisted = JSON.parse(localStorage.getItem('visualise-ai.ui') ?? '{}').state
    expect(persisted).toMatchObject(original)
    expect(persisted.layout).not.toEqual(DEEP_FOCUS_PANE_LAYOUT)

    // Unwinding the inner mode keeps deep focus's split; unwinding the outer
    // mode restores the exact user arrangement captured before either mode.
    useUiStore.getState().exitArchitectureFocus()
    expect(useUiStore.getState().deepFocus).toBe('diffs')
    expect(useUiStore.getState().layout).toEqual(DEEP_FOCUS_PANE_LAYOUT)
    useUiStore.getState().exitDeepFocus()
    expect(useUiStore.getState()).toMatchObject(original)
  })

  it('uses the original panes when architecture focus contains deep focus too', () => {
    const original = {
      layout: {
        'workspace-left': 21,
        'workspace-center': 55,
        'workspace-right': 24,
      },
      leftCollapsed: true,
      rightCollapsed: false,
    }
    useUiStore.setState(original)

    useUiStore.getState().enterArchitectureFocus()
    useUiStore.getState().enterDeepFocus('feedback')

    const persisted = JSON.parse(localStorage.getItem('visualise-ai.ui') ?? '{}').state
    expect(persisted).toMatchObject(original)

    useUiStore.getState().exitDeepFocus()
    expect(useUiStore.getState().architectureFocus).toBe(true)
    expect(useUiStore.getState().leftCollapsed).toBe(true)
    expect(useUiStore.getState().rightCollapsed).toBe(true)
    useUiStore.getState().exitArchitectureFocus()
    expect(useUiStore.getState()).toMatchObject(original)
  })

  it('resets focus state between tests and workspaces', () => {
    useUiStore.getState().enterArchitectureFocus()
    resetUiStore()

    expect(useUiStore.getState().architectureFocus).toBe(false)
    expect(useUiStore.getState().paneStateBeforeArchitectureFocus).toBeNull()
  })
})
