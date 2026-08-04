import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ProjectResponse } from '@/api/types'
import { PROJECT_ID, RUN_ID, createFakeFetch } from '@/test/fixtures'
import { renderApp } from '@/test/renderApp'

import type { WorkspaceSearch } from './searchParams'

const WORKSPACE_ROUTE_ID = '/projects/$projectId/runs/$runId'
const COMPONENT_ID = 'shop-platform.orders.domain'

function workspaceMatch(router: ReturnType<typeof renderApp>['router']) {
  return router.state.matches.find((match) => match.routeId === WORKSPACE_ROUTE_ID)
}

describe('routing', () => {
  it('redirects the root path to the project list', async () => {
    const { router } = renderApp('/')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/projects')
    })
    expect(await screen.findByRole('heading', { name: 'Projekte' })).toBeVisible()
  })

  it('forwards a project to its current run', async () => {
    const { router } = renderApp(`/projects/${PROJECT_ID}`)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      )
    })
    expect(await screen.findByTestId('pane-architecture')).toBeVisible()
  })

  it('shows an empty state when a project has no run yet', async () => {
    const { router } = renderApp(`/projects/${PROJECT_ID}`, {
      fetchImpl: createFakeFetch({
        [`/api/v1/projects/${PROJECT_ID}`]: {
          projectPosition: 3,
          project: {
            projectId: PROJECT_ID,
            firstSeenAt: '2026-08-04T09:00:00Z',
            lastEventAt: '2026-08-04T09:00:00Z',
            lastPosition: 3,
            currentRunId: null,
            counts: {
              runs: 0,
              openRuns: 0,
              components: 0,
              relationships: 0,
              activeChanges: 0,
            },
          },
        } satisfies ProjectResponse,
      }),
    })

    expect(await screen.findByText('Noch kein Run gemeldet')).toBeVisible()
    expect(router.state.location.pathname).toBe(`/projects/${PROJECT_ID}`)
  })

  it('resolves a direct link to project, run and component into typed params', async () => {
    const { router } = renderApp(
      `/projects/${PROJECT_ID}/runs/${RUN_ID}?component=${COMPONENT_ID}`,
    )

    await screen.findByTestId('pane-inspector')

    const match = workspaceMatch(router)
    expect(match?.params).toEqual({ projectId: PROJECT_ID, runId: RUN_ID })
    expect(match?.search).toEqual({ component: COMPONENT_ID })

    // The three panes are mounted and the inspector is bound to the component.
    expect(screen.getByTestId('pane-run-agents')).toBeInTheDocument()
    expect(screen.getByTestId('pane-architecture')).toBeInTheDocument()
    expect(await screen.findAllByText(COMPONENT_ID)).not.toHaveLength(0)

    // Compile-time proof that the route parameters are typed: the workspace
    // route cannot be built without both of them.
    router.buildLocation({
      to: WORKSPACE_ROUTE_ID,
      params: { projectId: PROJECT_ID, runId: RUN_ID },
    })
    router.buildLocation({
      to: WORKSPACE_ROUTE_ID,
      // @ts-expect-error runId is required by the typed route
      params: { projectId: PROJECT_ID },
    })
  })

  it('accepts every documented search parameter of the workspace', async () => {
    const { router } = renderApp(
      `/projects/${PROJECT_ID}/runs/${RUN_ID}?component=${COMPONENT_ID}&focus=diffs&history=true`,
    )

    await screen.findByTestId('pane-inspector')

    expect(workspaceMatch(router)?.search).toEqual({
      component: COMPONENT_ID,
      focus: 'diffs',
      history: true,
    })
    expect(await screen.findByTestId('deep-focus-banner')).toBeVisible()
  })

  it('falls back cleanly when search parameters are invalid', async () => {
    const { router } = renderApp(
      `/projects/${PROJECT_ID}/runs/${RUN_ID}?component=&focus=runs&history=maybe&unknown=1`,
    )

    await screen.findByTestId('pane-inspector')

    // Every invalid value falls back to `undefined` instead of throwing the
    // user out of the workspace. (TanStack Router keeps parameters no route
    // declared — `unknown` — in the match; the schema simply never surfaces
    // them to the workspace.)
    const search = workspaceMatch(router)?.search as WorkspaceSearch
    expect(search.component).toBeUndefined()
    expect(search.focus).toBeUndefined()
    expect(search.history).toBeUndefined()

    // The workspace still renders instead of erroring out on a broken bookmark.
    expect(screen.getByTestId('pane-architecture')).toBeInTheDocument()
    expect(screen.queryByTestId('deep-focus-banner')).not.toBeInTheDocument()
  })

  it('renders a not-found page for an unknown path', async () => {
    renderApp('/nope')

    expect(
      await screen.findByRole('heading', { name: 'Seite nicht gefunden' }),
    ).toBeVisible()
  })
})
