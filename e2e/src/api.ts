import { BASE_URL } from './config.js'

/**
 * The HTTP surface of the system under test, as the acceptance suite uses it.
 *
 * Every call goes through {@link BASE_URL} — the published Nginx port — because
 * that is the deployment's only external entry point (ADR 0001). Neither the
 * backend nor PostgreSQL publishes a port, and nothing here knows an internal
 * hostname.
 */

export interface EventEnvelope {
  schemaVersion: string
  clientEventId: string
  projectId: string
  runId: string
  agentId: string
  parentAgentId?: string | null
  occurredAt: string
  type: string
  payload: Record<string, unknown>
}

export interface IngestAnswer {
  status: number
  body: unknown
}

export interface EventAccepted {
  clientEventId: string
  serverEventId: string
  position: number
  duplicate: boolean
  receivedAt: string
}

export interface ProblemDocument {
  type?: string
  title?: string
  status?: number
  detail?: string
  code?: string
  errors?: { field?: string; code?: string; message?: string }[]
}

export const EVENTS_URL = `${BASE_URL}/api/v1/events`

/** POSTs one event envelope and returns status and parsed body, never throws. */
export async function postEvent(event: unknown): Promise<IngestAnswer> {
  const response = await fetch(EVENTS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  })
  const text = await response.text()
  let body: unknown = text
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      // Leave the raw text; the assertion message prints it verbatim.
    }
  }
  return { status: response.status, body }
}

/** `GET <base><path>`, returning status and parsed JSON body. */
export async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { accept: 'application/json' },
  })
  const text = await response.text()
  let body: unknown = text
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      /* keep the raw text */
    }
  }
  return { status: response.status, body }
}

/** `true` once the project row exists, i.e. at least one event was committed. */
export async function projectExists(projectId: string): Promise<boolean> {
  const { status } = await getJson(`/api/v1/projects/${encodeURIComponent(projectId)}`)
  return status === 200
}

export function streamUrl(projectId: string, lastEventPosition: number | null): string {
  const base = `${BASE_URL}/api/v1/projects/${encodeURIComponent(projectId)}/stream`
  return lastEventPosition === null ? base : `${base}?lastEventPosition=${lastEventPosition}`
}

/**
 * Opens a run with a root orchestrator's `agent.started`.
 *
 * The lifecycle rules make this the only event that can create a project and a
 * run (`backend/internal/ingest/lifecycle.go`), which is exactly why the suite
 * uses it to bootstrap a project before subscribing to its stream.
 */
export function bootstrapEvent(options: {
  clientEventId: string
  projectId: string
  runId: string
  agentId: string
  occurredAt?: string
  displayName?: string
  assignedTask?: string
}): EventEnvelope {
  return {
    schemaVersion: '1.0',
    clientEventId: options.clientEventId,
    projectId: options.projectId,
    runId: options.runId,
    agentId: options.agentId,
    parentAgentId: null,
    occurredAt: options.occurredAt ?? '2026-08-04T08:00:00Z',
    type: 'agent.started',
    payload: {
      role: 'orchestrator',
      displayName: options.displayName ?? 'End-to-end acceptance bootstrap',
      assignedTask:
        options.assignedTask ??
        'Open the project so the acceptance test can subscribe before the first reported event.',
    },
  }
}

/** Narrows an ingest answer to `EventAccepted`, or throws with the raw body. */
export function asAccepted(answer: IngestAnswer): EventAccepted {
  const body = answer.body as Partial<EventAccepted> | undefined
  if (
    !body ||
    typeof body.position !== 'number' ||
    typeof body.clientEventId !== 'string' ||
    typeof body.duplicate !== 'boolean'
  ) {
    throw new Error(
      `expected an EventAccepted body, got status ${answer.status} and ${JSON.stringify(answer.body)}`,
    )
  }
  return body as EventAccepted
}

/** Narrows an ingest answer to an RFC 9457 problem document. */
export function asProblem(answer: IngestAnswer): ProblemDocument {
  if (!answer.body || typeof answer.body !== 'object') {
    throw new Error(
      `expected an RFC 9457 problem document, got status ${answer.status} and ${JSON.stringify(answer.body)}`,
    )
  }
  return answer.body as ProblemDocument
}
