import { describe, expect, it } from 'vitest'

import { fetchBackendStatus } from './backendStatus'

function jsonResponse(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchBackendStatus', () => {
  it('reports ready with the backend version', async () => {
    const status = await fetchBackendStatus(async () =>
      jsonResponse({ status: 'ready', version: '1.2.3' }, { status: 200 }),
    )

    expect(status).toEqual({ state: 'ready', version: '1.2.3' })
  })

  it('reports the backend reason when readiness fails', async () => {
    const status = await fetchBackendStatus(async () =>
      jsonResponse({ status: 'unavailable', reason: 'postgres unreachable' }, { status: 503 }),
    )

    expect(status).toEqual({ state: 'unavailable', reason: 'postgres unreachable' })
  })

  it('reports unavailable when the request itself fails', async () => {
    const status = await fetchBackendStatus(async () => {
      throw new Error('network down')
    })

    expect(status).toEqual({ state: 'unavailable', reason: 'network down' })
  })
})
