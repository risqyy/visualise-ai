import type { QueryClient } from '@tanstack/react-query'
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  redirect,
} from '@tanstack/react-router'

import { projectQuery } from '@/api/queries'

import { ErrorPage, NotFoundPage } from './pages/ErrorPage'
import { ProjectIndexPage } from './pages/ProjectIndexPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { RootLayout } from './pages/RootLayout'
import { WorkspacePage } from './pages/WorkspacePage'
import { validateWorkspaceSearch } from './searchParams'

/**
 * Code-based route definitions.
 *
 * The routes are declared in TypeScript rather than generated from the file
 * system on purpose: the Docker build is a plain `npm ci && npm run build` with
 * no code-generation step in between, so the produced bundle is a pure function
 * of the checked-in sources.
 *
 *   /                                    -> redirect to /projects
 *   /projects                            -> project list
 *   /projects/$projectId                 -> redirect to the project's current run
 *   /projects/$projectId/runs/$runId     -> workspace (three panes)
 *
 * The workspace additionally carries validated search parameters, see
 * `./searchParams`.
 */
export interface RouterContext {
  queryClient: QueryClient
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: ({ error, reset }) => <ErrorPage error={error} reset={reset} />,
  notFoundComponent: NotFoundPage,
})

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projects' })
  },
})

export const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsPage,
})

/** Layout route for one project; renders whatever child route matched. */
export const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: Outlet,
  errorComponent: ({ error, reset }) => <ErrorPage error={error} reset={reset} />,
})

/**
 * `/projects/$projectId` — resolves the project's current run and forwards to
 * it. Loading through the query client means the workspace finds the project
 * already cached instead of refetching it.
 */
export const projectIndexRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/',
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(projectQuery(params.projectId))
    if (data.project.currentRunId) {
      throw redirect({
        to: '/projects/$projectId/runs/$runId',
        params: { projectId: params.projectId, runId: data.project.currentRunId },
      })
    }
    return null
  },
  component: ProjectIndexPage,
})

export const runRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'runs/$runId',
  validateSearch: validateWorkspaceSearch,
  component: WorkspacePage,
})

export const routeTree = rootRoute.addChildren([
  indexRoute,
  projectsRoute,
  projectRoute.addChildren([projectIndexRoute, runRoute]),
])
