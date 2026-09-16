import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { useUiStore } from '@/state/uiStore'
import { PROJECT_ID, RUN_ID } from '@/test/fixtures'
import { COMPONENT_ID } from '@/test/inspectorFixtures'
import { renderApp } from '@/test/renderApp'
import {
  renderWorkspaceScene,
  WORKSPACE_SCENE_URL,
  workspaceSceneServer,
} from '@/test/workspaceScene'

const DESTINATIONS = ['run-agents', 'architecture', 'inspector'] as const

function skipLink(target: typeof DESTINATIONS[number]) {
  const link = document.querySelector<HTMLAnchorElement>(
    `a[href="#workspace-${target}-heading"]`,
  )
  expect(link).not.toBeNull()
  return link!
}

describe('workspace — keyboard entry and pane navigation', () => {
  it.each(DESTINATIONS)('reaches %s from the first three Tab stops without changing the URL', async (target) => {
    const user = userEvent.setup()
    const { router } = renderApp(WORKSPACE_SCENE_URL, { fetchImpl: workspaceSceneServer() })
    await screen.findByRole('main')
    const before = router.state.location.href

    for (const destination of DESTINATIONS) {
      await user.tab()
      expect(skipLink(destination)).toHaveFocus()
      if (destination === target) break
    }
    await user.keyboard('{Enter}')
    const heading = document.getElementById(`workspace-${target}-heading`)
    await waitFor(() => expect(heading).toHaveFocus())
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(heading?.tagName).toBe('H2')
    expect(router.state.location.href).toBe(before)
    expect(router.state.location.hash).toBe('')

    // Repeated navigation must still focus the target after the first request
    // has been handled; it cannot rely only on a change in the target name.
    act(() => skipLink(target).focus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(heading).toHaveFocus())
    expect(router.state.location.href).toBe(before)
  })

  for (const target of ['run-agents', 'inspector'] as const) {
    it.each([false, true])(`opens the hidden ${target} destination while retaining context (architecture focus: %s)`, async (architectureFocus) => {
      const user = userEvent.setup()
      const { router } = await renderWorkspaceScene()
      const before = router.state.location.href
      const selectionBefore = useUiStore.getState().selectedComponentId
      act(() => {
        useUiStore.getState().setLeftCollapsed(true)
        useUiStore.getState().setRightCollapsed(true)
        if (architectureFocus) useUiStore.getState().enterArchitectureFocus()
      })
      expect(document.getElementById(`workspace-${target}-heading`)).toBeNull()
      act(() => skipLink(target).focus())
      await user.keyboard('{Enter}')
      const heading = await screen.findByRole('heading', {
        level: 2,
        name: target === 'run-agents' ? 'Runs und Agents' : 'Inspector',
      })
      await waitFor(() => expect(heading).toHaveFocus())
      expect(heading).toBeVisible()
      const state = useUiStore.getState()
      expect(target === 'run-agents' ? state.leftCollapsed : state.rightCollapsed).toBe(false)
      expect(target === 'run-agents' ? state.rightCollapsed : state.leftCollapsed).toBe(true)
      expect(state.architectureFocus).toBe(false)
      expect(state.selectedComponentId).toBe(selectionBefore)
      expect(state.selectedComponentId).toBe(COMPONENT_ID)
      expect(router.state.location.href).toBe(before)
      expect(router.state.location.search).toEqual({ component: COMPONENT_ID })
    })
  }

  it('keeps the inspector deep-focus URL when jumping to the folded agent pane', async () => {
    const user = userEvent.setup()
    const { router } = renderApp(`${WORKSPACE_SCENE_URL}&focus=diffs&layout=left-right`, {
      fetchImpl: workspaceSceneServer(),
    })
    await screen.findByTestId('inspector-context')
    await waitFor(() => expect(useUiStore.getState().leftCollapsed).toBe(true))
    const before = router.state.location.href
    act(() => skipLink('run-agents').focus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(document.getElementById('workspace-run-agents-heading')).toHaveFocus())
    expect(useUiStore.getState().leftCollapsed).toBe(false)
    expect(router.state.location.href).toBe(before)
    expect(screen.getByTestId('deep-focus-banner')).toBeInTheDocument()
    expect(screen.getByTestId('inspector-context')).toHaveAttribute('data-component-id', COMPONENT_ID)
    expect(screen.getByTestId('inspector-context')).toHaveAttribute('data-run-id', RUN_ID)
  })
})

describe('workspace — document and heading structure', () => {
  it('has one main, one project/run title and a complete pane, section, plan and revision outline', async () => {
    await renderWorkspaceScene()
    const main = screen.getByRole('main')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const title = screen.getByRole('heading', { level: 1 })
    expect(main).toContainElement(title)
    expect(title).toHaveTextContent(PROJECT_ID)
    expect(title).toHaveTextContent(RUN_ID)
    expect(within(main).getAllByRole('heading', { level: 2 })).toHaveLength(3)
    for (const destination of DESTINATIONS) {
      expect(document.getElementById(`workspace-${destination}-heading`)?.tagName).toBe('H2')
    }
    expect(within(screen.getByTestId('run-state')).getByRole('heading', { level: 3 })).toHaveTextContent('Runzustand')
    expect(document.getElementById('run-agents-heading')?.tagName).toBe('H3')
    expect(document.getElementById('run-plans-heading')?.tagName).toBe('H3')
    const plans = screen.getByTestId('plan-revisions')
    expect(within(plans).getAllByRole('heading', { level: 4 }).length).toBeGreaterThan(0)
    expect(within(plans).getAllByRole('heading', { level: 5 })).toHaveLength(2)
    for (const target of ['feedback', 'diffs', 'risks', 'problems', 'active-changes']) {
      expect(within(screen.getByTestId(`inspector-${target}`)).getByRole('heading', { level: 3 })).toBeInTheDocument()
    }
  })

  it('keeps history under a section heading without creating another page title', async () => {
    renderApp(`${WORKSPACE_SCENE_URL}&history=true`, { fetchImpl: workspaceSceneServer() })
    const history = await screen.findByTestId('inspector-history')
    expect(within(history).getByRole('heading', { level: 3 })).toHaveTextContent('Historie')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('updates the localized document title while keeping reported IDs and restores the previous title on exit', async () => {
    const previous = document.title
    const { i18n, unmount } = await renderWorkspaceScene({ language: 'de' })
    await waitFor(() => {
      expect(document.title).toContain(PROJECT_ID)
      expect(document.title).toContain(RUN_ID)
    })
    const german = document.title
    await act(async () => { await i18n.changeLanguage('en') })
    await waitFor(() => expect(document.title).not.toBe(german))
    expect(document.title).toContain(PROJECT_ID)
    expect(document.title).toContain(RUN_ID)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PROJECT_ID)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(RUN_ID)
    expect(skipLink('architecture')).toHaveAccessibleName(/Architecture/i)
    unmount()
    expect(document.title).toBe(previous)
  })
})
