import type { QueryKey } from '@tanstack/react-query'

import { API_BASE } from './fetchJson'
import { queryKeys } from './queryKeys'
import { EVENT_TYPES, type ProjectId, type StreamedEvent } from './types'

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

/**
 * State of the live connection. It is reported **separately from the data**:
 * losing the stream never discards what was already loaded, it only changes
 * this value so the header can say so.
 */
export type LiveConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline'

/** Consecutive failed attempts after which the connection is called `offline`. */
const OFFLINE_AFTER_ATTEMPTS = 3

/** Exponential backoff for manual reconnects, capped at 15 s. */
function defaultRetryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 1), 15_000)
}

// ---------------------------------------------------------------------------
// Event source abstraction
// ---------------------------------------------------------------------------

/**
 * The slice of `EventSource` the client uses. Declaring it explicitly keeps the
 * stream testable in jsdom, which ships no `EventSource`, without loosening the
 * production path: `createEventSource` defaults to the real constructor.
 */
export interface EventSourceLike {
  readonly readyState: number
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
  close(): void
}

/** `EventSource.CLOSED` — the browser gave up and will not reconnect itself. */
export const EVENT_SOURCE_CLOSED = 2

export interface LiveStreamOptions {
  projectId: ProjectId
  /** Called once per new project position, in the order the server sent them. */
  onEvent: (event: StreamedEvent) => void
  onStateChange?: (state: LiveConnectionState) => void
  /** Injected in tests. Defaults to the browser `EventSource`. */
  createEventSource?: (url: string) => EventSourceLike
  /** Position the client already processed, e.g. restored from a snapshot. */
  initialPosition?: number | null
  retryDelayMs?: (attempt: number) => number
  offlineAfterAttempts?: number
}

export interface LiveStreamHandle {
  close(): void
  /** Highest project position seen so far, or `null` before the first event. */
  getLastEventPosition(): number | null
  getState(): LiveConnectionState
}

/** URL of the project stream, optionally resuming after a known position. */
export function streamUrl(projectId: ProjectId, lastEventPosition: number | null): string {
  const base = `${API_BASE}/projects/${encodeURIComponent(projectId)}/stream`
  return lastEventPosition === null
    ? base
    : `${base}?lastEventPosition=${lastEventPosition}`
}

/**
 * Connects to `GET /api/v1/projects/{projectId}/stream`.
 *
 * Reconnect handling has two layers:
 *
 * 1. **Native.** While the browser reconnects on its own it replays the
 *    `Last-Event-ID` header, which carries the project position of the last
 *    frame — that is the contract's primary replay cursor and needs no help.
 * 2. **Manual.** Once the browser gives up (`readyState === CLOSED`) the client
 *    opens a fresh stream itself and appends the remembered position as
 *    `?lastEventPosition=`, which the contract lets win over the header. Replay
 *    therefore resumes gap-free even across a full teardown.
 *
 * The handle owns no cache. Wiring events to the query cache is the job of
 * `applyLiveEvent`, so a dropped connection can never destroy loaded state.
 */
export function connectLiveStream(options: LiveStreamOptions): LiveStreamHandle {
  const {
    projectId,
    onEvent,
    onStateChange,
    createEventSource = defaultCreateEventSource,
    initialPosition = null,
    retryDelayMs = defaultRetryDelayMs,
    offlineAfterAttempts = OFFLINE_AFTER_ATTEMPTS,
  } = options

  let source: EventSourceLike | null = null
  let detachSource: (() => void) | null = null
  let lastPosition: number | null = initialPosition
  let failedAttempts = 0
  let state: LiveConnectionState = 'connecting'
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  function setState(next: LiveConnectionState) {
    if (state === next) return
    state = next
    onStateChange?.(next)
  }

  function handleOpen() {
    if (closed) return
    failedAttempts = 0
    setState('live')
  }

  function handleError() {
    if (closed) return

    // The browser reconnects by itself while the source is CONNECTING. Only a
    // CLOSED source needs a manual reconnect.
    if (source && source.readyState !== EVENT_SOURCE_CLOSED) {
      setState('reconnecting')
      return
    }

    failedAttempts += 1
    setState(failedAttempts > offlineAfterAttempts ? 'offline' : 'reconnecting')
    teardown()
    scheduleReconnect()
  }

  function handleMessage(event: Event) {
    if (closed) return
    const parsed = parseStreamedEvent(event)
    if (!parsed || parsed.projectId !== projectId || parsed.position <= (lastPosition ?? 0)) return

    onEvent(parsed)
    lastPosition = parsed.position
  }

  function teardown() {
    source = null
    detachSource?.()
    detachSource = null
  }

  function scheduleReconnect() {
    if (closed || retryTimer !== null) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (!closed) open()
    }, retryDelayMs(failedAttempts))
  }

  function open() {
    const openedSource = createEventSource(streamUrl(projectId, lastPosition))
    source = openedSource
    // Already queued callbacks can outlive listener removal, including across
    // manual reconnects. Only the currently owned source may publish anything.
    const guard = (listener: (event: Event) => void) => (event: Event) => {
      if (!closed && source === openedSource) listener(event)
    }
    const onOpen = guard(handleOpen)
    const onError = guard(handleError)
    const onMessage = guard(handleMessage)
    openedSource.addEventListener('open', onOpen)
    openedSource.addEventListener('error', onError)
    // The server sets `event:` to the event type, so a `message` listener would
    // never fire: subscribe to every type of the closed catalogue instead.
    for (const type of EVENT_TYPES) openedSource.addEventListener(type, onMessage)
    detachSource = () => {
      openedSource.removeEventListener('open', onOpen)
      openedSource.removeEventListener('error', onError)
      for (const type of EVENT_TYPES) openedSource.removeEventListener(type, onMessage)
      openedSource.close()
    }
  }

  open()

  return {
    close() {
      closed = true
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      teardown()
    },
    getLastEventPosition: () => lastPosition,
    getState: () => state,
  }
}

function defaultCreateEventSource(url: string): EventSourceLike {
  return new EventSource(url)
}

/** Parses one SSE frame. Malformed frames are dropped, never thrown. */
export function parseStreamedEvent(event: Event): StreamedEvent | null {
  const data = (event as MessageEvent<unknown>).data
  if (typeof data !== 'string') return null

  let decoded: unknown
  try {
    decoded = JSON.parse(data)
  } catch {
    return null
  }

  if (typeof decoded !== 'object' || decoded === null) return null
  const candidate = decoded as Partial<StreamedEvent>
  if (typeof candidate.type !== 'string') return null
  if (!(EVENT_TYPES as readonly string[]).includes(candidate.type)) return null
  if (typeof candidate.position !== 'number') return null
  if (typeof candidate.projectId !== 'string') return null
  if (typeof candidate.payload !== 'object' || candidate.payload === null) return null

  return decoded as StreamedEvent
}

// ---------------------------------------------------------------------------
// Event -> query keys
// ---------------------------------------------------------------------------

/** Guards against a pathological chain of corrections correcting corrections. */
const MAX_CORRECTION_DEPTH = 4

/**
 * Resolves one live event to the query keys it affects.
 *
 * The returned keys are **prefixes**: `component(p, c)` covers the inspector and
 * the history of exactly that component. Nothing broader is ever returned, so
 * an agent progress report cannot cause the architecture to refetch.
 *
 * Two events carry no typed target and therefore widen deliberately:
 *
 * * `work.step_completed` names only a `workStepId`, so the components it
 *   touched are unknown — the component scope of the project is invalidated.
 * * `retraction.issued` names only the retracted `clientEventId`, so the whole
 *   project scope is invalidated.
 *
 * Both are documented widenings inside one project; there is no global
 * invalidation anywhere.
 */
export function affectedQueryKeys(event: StreamedEvent, depth = 0): QueryKey[] {
  const project = event.projectId
  const run = event.runId

  switch (event.type) {
    case 'view.saved':
    case 'view.removed':
      return [queryKeys.views(project)]
    case 'context.opened':
      return [queryKeys.agents(project, run), queryKeys.runs(project), queryKeys.projectDetail(project)]
    case 'work.scope_reported':
      return [queryKeys.agents(project, run), queryKeys.components(project)]
    case 'work.reported':
      return [queryKeys.agents(project, run), queryKeys.components(project), queryKeys.runDetail(project, run), queryKeys.runs(project), queryKeys.projectDetail(project)]
    case 'agent.started':
      // A root orchestrator opens a run and can change the project's current
      // pointer. Child starts do not change the selected run's temporal context.
      return event.parentAgentId === null && event.payload.role === 'orchestrator'
        ? [queryKeys.agents(project, run), queryKeys.runs(project), queryKeys.projectDetail(project)]
        : [queryKeys.agents(project, run)]
    case 'agent.status_reported':
    case 'agent.progress_reported':
    case 'agent.finished':
      return [queryKeys.agents(project, run)]

    case 'plan.published':
    case 'plan.step_updated':
      return [queryKeys.plans(project, run)]

    case 'work.step_started':
      return dedupe([
        queryKeys.agents(project, run),
        ...event.payload.componentIds.map((id) => queryKeys.component(project, id)),
      ])

    case 'work.step_completed':
      return [queryKeys.agents(project, run), queryKeys.components(project)]

    case 'feedback.published':
    case 'diff.reported':
    case 'risk.reported':
    case 'problem.reported':
      return dedupe(
        event.payload.componentIds.map((id) => queryKeys.component(project, id)),
      )

    case 'model.mutation_applied':
    case 'architecture.snapshot_published':
      return [queryKeys.architecture(project), queryKeys.components(project), queryKeys.runScope(project), queryKeys.views(project)]

    case 'component.change_applied':
      return [queryKeys.architecture(project), queryKeys.component(project, event.payload.component.componentId), queryKeys.views(project)]
    case 'component.change_planned':
      return [
        queryKeys.architecture(project),
        queryKeys.component(project, event.payload.component.componentId),
      ]

    case 'relationship.change_applied':
      return dedupe([queryKeys.architecture(project), queryKeys.component(project, event.payload.relationship.sourceComponentId), queryKeys.component(project, event.payload.relationship.targetComponentId), queryKeys.views(project)])
    case 'relationship.change_planned':
      return dedupe([
        queryKeys.architecture(project),
        queryKeys.component(project, event.payload.relationship.sourceComponentId),
        queryKeys.component(project, event.payload.relationship.targetComponentId),
      ])

    case 'correction.issued': {
      if (depth >= MAX_CORRECTION_DEPTH) return [queryKeys.project(project)]
      const corrected = {
        ...event,
        type: event.payload.correctedType,
        payload: event.payload.correctedPayload,
      } as unknown as StreamedEvent
      return affectedQueryKeys(corrected, depth + 1)
    }

    case 'retraction.issued':
      return [queryKeys.project(project)]

    case 'run.finished':
      return [
        queryKeys.runDetail(project, run),
        queryKeys.runs(project),
        queryKeys.projectDetail(project),
      ]
  }
}

function dedupe(keys: QueryKey[]): QueryKey[] {
  const seen = new Set<string>()
  const unique: QueryKey[] = []
  for (const key of keys) {
    const serialised = JSON.stringify(key)
    if (seen.has(serialised)) continue
    seen.add(serialised)
    unique.push(key)
  }
  return unique
}
