import { QueryClient } from '@tanstack/react-query'

import { isNetworkError } from './problem'

/** Retries a failed query at most twice, and only for transport failures. */
const MAX_NETWORK_RETRIES = 2

/**
 * Defaults tuned for a live, event-driven read model.
 *
 * The SSE stream is what keeps the cache fresh, so polling and focus refetches
 * would only produce redundant traffic. A moderate `staleTime` therefore is not
 * a staleness risk: a live event invalidates the affected keys immediately.
 *
 * Retrying a `4xx` is pointless — the contract already told us the request is
 * wrong — so only `NetworkError` is retried.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: true,
        retry: (failureCount, error) =>
          isNetworkError(error) && failureCount < MAX_NETWORK_RETRIES,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
    },
  })
}
