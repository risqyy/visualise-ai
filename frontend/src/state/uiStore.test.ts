import { describe, expect, it } from 'vitest'

import { resetUiStore, useUiStore } from '@/state/uiStore'

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

  it('resets focus state between tests and workspaces', () => {
    useUiStore.getState().enterArchitectureFocus()
    resetUiStore()

    expect(useUiStore.getState().architectureFocus).toBe(false)
    expect(useUiStore.getState().paneStateBeforeArchitectureFocus).toBeNull()
  })
})
