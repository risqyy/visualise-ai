/**
 * Minimal client for the backend probes that Nginx proxies.
 *
 * It exists so the Compose scaffold can prove end to end that the browser
 * reaches the internal backend through Nginx only. The real server-state layer
 * is introduced with the frontend shell.
 */

export type BackendStatus =
  | { state: 'loading' }
  | { state: 'ready'; version: string }
  | { state: 'unavailable'; reason: string }

interface ProbeResponse {
  status?: string
  version?: string
  reason?: string
}

/** Reads `/readyz` through the Nginx proxy. */
export async function fetchBackendStatus(
  fetchImpl: typeof fetch = fetch,
): Promise<BackendStatus> {
  try {
    const response = await fetchImpl('/readyz', {
      headers: { Accept: 'application/json' },
    })
    const body = (await response.json()) as ProbeResponse

    if (!response.ok) {
      return { state: 'unavailable', reason: body.reason ?? `HTTP ${response.status}` }
    }
    return { state: 'ready', version: body.version ?? 'unknown' }
  } catch (error) {
    return {
      state: 'unavailable',
      reason: error instanceof Error ? error.message : 'unreachable',
    }
  }
}
