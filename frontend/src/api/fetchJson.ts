import {
  NetworkError,
  ProblemError,
  parseProblem,
  syntheticProblem,
} from './problem'

/** Version prefix of the read API. Nginx proxies it to the internal backend. */
export const API_BASE = '/api/v1'

export interface FetchJsonOptions {
  signal?: AbortSignal
  /** Query parameters; `undefined` and `null` entries are dropped. */
  query?: Record<string, string | number | boolean | null | undefined>
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

/**
 * Builds an API URL below `/api/v1`. Exported so the SSE client and the query
 * hooks derive their URLs the same way.
 */
export function apiUrl(
  path: string,
  query?: FetchJsonOptions['query'],
): string {
  const base = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return base

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const serialised = params.toString()
  return serialised ? `${base}?${serialised}` : base
}

/**
 * The single HTTP entry point of the cockpit.
 *
 * * 2xx -> parsed JSON body, typed by the caller.
 * * non-2xx -> `ProblemError` carrying the RFC 9457 body (`application/problem+json`).
 * * transport failure or unparsable body -> `NetworkError`, the only class of
 *   failure the query client retries.
 */
export async function fetchJson<T>(
  path: string,
  options: FetchJsonOptions = {},
): Promise<T> {
  const { fetchImpl = fetch, signal, query } = options
  const url = apiUrl(path, query)

  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json, application/problem+json' },
      ...(signal ? { signal } : {}),
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError(
      cause instanceof Error ? cause.message : 'request failed',
      url,
      { cause },
    )
  }

  if (!response.ok) {
    throw new ProblemError(await readProblem(response), url)
  }

  if (response.status === 204) return undefined as T

  try {
    return (await response.json()) as T
  } catch (cause) {
    throw new NetworkError('response body is not valid JSON', url, { cause })
  }
}

async function readProblem(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  const looksLikeJson =
    contentType.includes('application/problem+json') ||
    contentType.includes('application/json')

  if (looksLikeJson) {
    try {
      const parsed = parseProblem(await response.json(), response.status)
      if (parsed) return parsed
    } catch {
      // Fall through to the synthetic problem below.
    }
  }

  return syntheticProblem(response.status, response.statusText)
}
