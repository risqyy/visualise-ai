import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { DEFAULT_PANE_LAYOUT } from '@/state/uiStore'
import { PROJECT_ID, RUN_ID } from '@/test/fixtures'
import { renderApp } from '@/test/renderApp'

const WORKSPACE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}`

describe('workspace panes', () => {
  it('mounts all three panes with the architecture in the centre', async () => {
    renderApp(WORKSPACE_URL)

    expect(await screen.findByTestId('pane-run-agents')).toBeInTheDocument()
    expect(screen.getByTestId('pane-architecture')).toBeInTheDocument()
    expect(screen.getByTestId('pane-inspector')).toBeInTheDocument()
  })

  it('collapses and expands the side panes independently of each other', async () => {
    const user = userEvent.setup()
    renderApp(WORKSPACE_URL)

    await screen.findByTestId('pane-run-agents')

    const leftToggle = screen.getByRole('button', { name: 'Run- und Agent-Bereich' })
    const rightToggle = screen.getByRole('button', { name: 'Inspector' })
    expect(leftToggle).toHaveAttribute('aria-expanded', 'true')
    expect(rightToggle).toHaveAttribute('aria-expanded', 'true')

    // Collapsing the left pane must not touch the right one.
    await user.click(leftToggle)
    expect(screen.queryByTestId('pane-run-agents')).not.toBeInTheDocument()
    expect(screen.getByTestId('pane-rail-left')).toBeInTheDocument()
    expect(screen.getByTestId('pane-inspector')).toBeInTheDocument()
    expect(screen.getByTestId('pane-architecture')).toBeInTheDocument()
    expect(leftToggle).toHaveAttribute('aria-expanded', 'false')
    expect(rightToggle).toHaveAttribute('aria-expanded', 'true')

    // Collapsing the right pane must not re-expand the left one.
    await user.click(rightToggle)
    expect(screen.queryByTestId('pane-inspector')).not.toBeInTheDocument()
    expect(screen.getByTestId('pane-rail-right')).toBeInTheDocument()
    expect(screen.queryByTestId('pane-run-agents')).not.toBeInTheDocument()
    expect(screen.getByTestId('pane-architecture')).toBeInTheDocument()

    // The rail of a collapsed pane always offers the way back.
    await user.click(screen.getByRole('button', { name: 'Inspector ausklappen' }))
    expect(screen.getByTestId('pane-inspector')).toBeInTheDocument()
    expect(screen.queryByTestId('pane-run-agents')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Run- und Agent-Bereich ausklappen' }))
    expect(screen.getByTestId('pane-run-agents')).toBeInTheDocument()
    expect(screen.getByTestId('pane-inspector')).toBeInTheDocument()
  })

  it('persists pane collapse state to localStorage', async () => {
    const user = userEvent.setup()
    renderApp(WORKSPACE_URL)

    await screen.findByTestId('pane-run-agents')
    await user.click(screen.getByRole('button', { name: 'Run- und Agent-Bereich' }))

    const persisted = localStorage.getItem('visualise-ai.ui')
    expect(persisted).toBeTruthy()
    expect(JSON.parse(persisted ?? '{}').state).toMatchObject({
      leftCollapsed: true,
      rightCollapsed: false,
    })
  })
})

describe('deep focus', () => {
  it('is driven by the focus search parameter and can be left again', async () => {
    const user = userEvent.setup()
    const { router } = renderApp(
      `${WORKSPACE_URL}?component=shop-platform.orders.domain&focus=feedback`,
    )

    expect(await screen.findByTestId('deep-focus-banner')).toBeVisible()
    // The architecture context stays visible while the inspector is enlarged;
    // the run pane folds into its rail to make room.
    expect(screen.getByTestId('pane-architecture')).toBeInTheDocument()
    expect(screen.getByTestId('pane-rail-left')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Beenden/ }))

    expect(screen.queryByTestId('deep-focus-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('pane-run-agents')).toBeInTheDocument()
    expect(router.state.location.search).toEqual({
      component: 'shop-platform.orders.domain',
    })
  })

  it('does not persist the temporary deep-focus arrangement', async () => {
    renderApp(`${WORKSPACE_URL}?component=shop-platform.orders.domain&focus=diffs`)

    await screen.findByTestId('deep-focus-banner')

    // A reload without `?focus=` must come back in the normal split.
    const persisted = JSON.parse(localStorage.getItem('visualise-ai.ui') ?? '{}')
    expect(persisted.state).toMatchObject({
      leftCollapsed: false,
      layout: DEFAULT_PANE_LAYOUT,
    })
  })
})
