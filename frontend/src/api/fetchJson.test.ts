import { describe, expect, it } from 'vitest'

import { apiUrl, fetchJson } from './fetchJson'
import { NetworkError, ProblemError, describeError } from './problem'
import type { ValidationProblem } from './types'

function problemResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: 'Bad Request',
    headers: { 'Content-Type': 'application/problem+json' },
  })
}

describe('apiUrl', () => {
  it('builds versioned paths and drops empty query values', () => {
    expect(apiUrl('/projects')).toBe('/api/v1/projects')
    expect(apiUrl('/projects/p/runs', { limit: 50, cursor: null })).toBe(
      '/api/v1/projects/p/runs?limit=50',
    )
  })
})

describe('fetchJson', () => {
  it('returns the parsed body for a successful response', async () => {
    const body = await fetchJson<{ projectPosition: number }>('/projects', {
      fetchImpl: async () =>
        new Response(JSON.stringify({ projectPosition: 7 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    })

    expect(body).toEqual({ projectPosition: 7 })
  })

  it('turns an application/problem+json response into a typed ProblemError', async () => {
    const problem: ValidationProblem = {
      type: 'https://visualise-ai.local/problems/invalid-field',
      title: 'Invalid field',
      status: 400,
      detail: 'The request body violates the contract.',
      code: 'invalid_field',
      errors: [
        {
          field: '/payload/percent',
          code: 'out_of_range',
          message: 'percent must be between 0 and 100',
        },
      ],
    }

    const error = await fetchJson('/projects', {
      fetchImpl: async () => problemResponse(problem, 400),
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProblemError)
    const problemError = error as ProblemError
    expect(problemError.status).toBe(400)
    expect(problemError.code).toBe('invalid_field')
    expect(problemError.isClientError).toBe(true)
    expect(problemError.problem).toEqual(problem)
    expect(problemError.errors).toEqual(problem.errors)
    expect(problemError.message).toBe('The request body violates the contract.')
    // The backend's own words, marked as reported: `describeError` returns the
    // distinction rather than a finished sentence since #42, so that
    // `<ErrorDescription>` can render this half verbatim and only its two
    // generic fallbacks out of the catalogue.
    expect(describeError(problemError)).toEqual({
      kind: 'reported',
      text: 'Invalid field (invalid_field)',
    })
  })

  it('keeps the ProblemError shape when the body is not a valid problem', async () => {
    const error = await fetchJson('/projects', {
      fetchImpl: async () =>
        new Response('<html>502</html>', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'text/html' },
        }),
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProblemError)
    const problemError = error as ProblemError
    expect(problemError.status).toBe(502)
    expect(problemError.code).toBe('http_error')
    expect(problemError.isClientError).toBe(false)
    expect(problemError.errors).toEqual([])
  })

  it('reports a transport failure as NetworkError, not as a problem', async () => {
    const error = await fetchJson('/projects', {
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NetworkError)
    expect((error as NetworkError).message).toBe('Failed to fetch')
  })

  it('reports an unparsable success body as NetworkError', async () => {
    const error = await fetchJson('/projects', {
      fetchImpl: async () =>
        new Response('not json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(NetworkError)
  })
})
