import type { Problem, ValidationError, ValidationProblem } from './types'

/**
 * A response the backend rejected, expressed as RFC 9457 problem details.
 *
 * `code` is the stable discriminator the UI branches on; `title`/`detail` are
 * for humans. `ProblemError` is thrown for every non-2xx response, whether or
 * not the body actually parsed as `application/problem+json` — in the latter
 * case a synthetic problem is built so callers always get the same shape.
 */
export class ProblemError extends Error {
  readonly name = 'ProblemError'
  readonly problem: Problem
  /** Field-level violations of a `400 ValidationProblem`, otherwise empty. */
  readonly errors: readonly ValidationError[]
  /** Request URL that produced the problem, for logging. */
  readonly url: string

  constructor(problem: Problem, url: string) {
    super(problem.detail || problem.title)
    this.problem = problem
    this.url = url
    this.errors = isValidationProblem(problem) ? problem.errors : []
  }

  get status(): number {
    return this.problem.status
  }

  get code(): string {
    return this.problem.code
  }

  /** `true` for 4xx — a retry cannot fix these. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500
  }
}

/**
 * The request never produced an HTTP response: DNS failure, offline, aborted
 * connection, unparsable body. These are the only failures worth retrying.
 */
export class NetworkError extends Error {
  readonly name = 'NetworkError'
  readonly url: string

  constructor(message: string, url: string, options?: { cause?: unknown }) {
    super(message, options)
    this.url = url
  }
}

export function isProblemError(error: unknown): error is ProblemError {
  return error instanceof ProblemError
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError
}

function isValidationProblem(problem: Problem): problem is ValidationProblem {
  return Array.isArray((problem as Partial<ValidationProblem>).errors)
}

/**
 * Narrows an unknown body to `Problem`. Only bodies that carry the fields the
 * contract marks as required are accepted; anything else falls back to a
 * synthetic problem so a misbehaving proxy cannot produce a half-typed error.
 */
export function parseProblem(body: unknown, status: number): Problem | null {
  if (typeof body !== 'object' || body === null) return null

  const candidate = body as Partial<ValidationProblem>
  if (
    typeof candidate.type !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.detail !== 'string' ||
    typeof candidate.code !== 'string'
  ) {
    return null
  }

  const problem: Problem = {
    type: candidate.type,
    title: candidate.title,
    status: typeof candidate.status === 'number' ? candidate.status : status,
    detail: candidate.detail,
    code: candidate.code,
    ...(typeof candidate.instance === 'string' ? { instance: candidate.instance } : {}),
  }

  if (Array.isArray(candidate.errors)) {
    const validation: ValidationProblem = { ...problem, errors: candidate.errors }
    return validation
  }

  return problem
}

/** Fallback used when a non-2xx response carries no usable problem body. */
export function syntheticProblem(status: number, statusText: string): Problem {
  return {
    type: 'about:blank',
    title: statusText || 'HTTP error',
    status,
    detail: `The request failed with HTTP ${status}${statusText ? ` ${statusText}` : ''}.`,
    code: 'http_error',
  }
}

/**
 * What an error state has to say, split by **who is speaking**.
 *
 * Most of it is the backend's own wording — its problem title and its stable
 * code — and that is reported data: it is rendered verbatim, in every language,
 * through `<ReportedText>`. Only two cases are the cockpit's own sentence, and
 * those two carry a translation key instead of a string. This module cannot
 * call `useTranslation`, so it returns the distinction rather than the words
 * (ADR 0014 named this as #42's piece of unfinished business).
 */
export type ErrorDescription =
  /** The backend's or the runtime's own words. Never translated. */
  | { kind: 'reported'; text: string }
  /** No HTTP response at all; `detail` is the runtime's message. */
  | { kind: 'backendUnreachable'; detail: string }
  /** Something was thrown that is not even an `Error`. */
  | { kind: 'unknown' }

/** One-liner for error states in the UI, as `<ErrorDescription>` renders it. */
export function describeError(error: unknown): ErrorDescription {
  if (isProblemError(error)) {
    return { kind: 'reported', text: `${error.problem.title} (${error.code})` }
  }
  if (isNetworkError(error)) {
    return { kind: 'backendUnreachable', detail: error.message }
  }
  if (error instanceof Error) return { kind: 'reported', text: error.message }
  return { kind: 'unknown' }
}
