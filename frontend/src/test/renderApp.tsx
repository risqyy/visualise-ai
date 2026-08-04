import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { vi } from 'vitest'

import { createAppRouter } from '@/routes/router'

import { createFakeFetch } from './fixtures'

export interface RenderAppOptions {
  /** Replaces the default contract-shaped fetch double. */
  fetchImpl?: typeof fetch
}

/**
 * Renders the real application (router + query client) at a given URL.
 *
 * Each call gets its own router, history and query client, so tests cannot leak
 * cached data or navigation state into each other.
 */
export function renderApp(initialPath: string, options: RenderAppOptions = {}) {
  vi.stubGlobal('fetch', options.fetchImpl ?? createFakeFetch())

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createAppRouter({ queryClient, history })

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return { ...utils, router, queryClient }
}
