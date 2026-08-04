import type { QueryClient } from '@tanstack/react-query'
import type { RouterHistory } from '@tanstack/react-router'
import { createRouter } from '@tanstack/react-router'

import { ErrorPage, NotFoundPage } from './pages/ErrorPage'
import { routeTree } from './routeTree'

export interface CreateAppRouterOptions {
  queryClient: QueryClient
  /** Injected by tests (memory history); the app uses the browser history. */
  history?: RouterHistory
}

/**
 * Builds the application router.
 *
 * A factory rather than a module-level singleton, so every test gets its own
 * router with its own history and its own query client and cannot leak state
 * into the next one.
 */
export function createAppRouter({ queryClient, history }: CreateAppRouterOptions) {
  return createRouter({
    routeTree,
    context: { queryClient },
    ...(history ? { history } : {}),
    defaultPreload: 'intent',
    // The read models are cached by TanStack Query, so the router does not need
    // a second, competing cache of its own.
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: ({ error, reset }) => <ErrorPage error={error} reset={reset} />,
    defaultNotFoundComponent: NotFoundPage,
    scrollRestoration: false,
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
