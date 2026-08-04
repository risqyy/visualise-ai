import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { vi } from 'vitest'

import { DEFAULT_LANGUAGE, type Language, createI18n } from '@/i18n'
import { createAppRouter } from '@/routes/router'

import { createFakeFetch } from './fixtures'

export interface RenderAppOptions {
  /** Replaces the default contract-shaped fetch double. */
  fetchImpl?: typeof fetch
  /** Language the app starts in. Defaults to German, as the application does. */
  language?: Language
  /** A prepared instance, for tests that need to observe its events. */
  i18n?: I18n
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

  // Mirrors `main.tsx`: the language is settled before anything renders.
  const i18n =
    options.i18n ?? createI18n({ language: options.language ?? DEFAULT_LANGUAGE })

  const utils = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  )

  return { ...utils, router, queryClient, i18n }
}
