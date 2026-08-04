import type { EventSourceLike } from '@/api/liveStream'
import type { StreamedEvent } from '@/api/types'

const CONNECTING = 0
const OPEN = 1
const CLOSED = 2

/**
 * Test double for `EventSource`.
 *
 * It exposes the same three ready states as the real thing, so the client's
 * distinction between "the browser is reconnecting by itself" (`CONNECTING`) and
 * "the browser gave up" (`CLOSED`) can be exercised faithfully.
 */
export class FakeEventSource implements EventSourceLike {
  static readonly CONNECTING = CONNECTING
  static readonly OPEN = OPEN
  static readonly CLOSED = CLOSED

  /** Every instance ever created, in creation order. */
  static instances: FakeEventSource[] = []

  readyState = CONNECTING
  closed = false
  readonly url: string

  private listeners = new Map<string, Set<(event: Event) => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  static reset(): void {
    FakeEventSource.instances = []
  }

  static get last(): FakeEventSource {
    const last = FakeEventSource.instances.at(-1)
    if (!last) throw new Error('no FakeEventSource was created')
    return last
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const existing = this.listeners.get(type) ?? new Set()
    existing.add(listener)
    this.listeners.set(type, existing)
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closed = true
    this.readyState = CLOSED
  }

  /** Simulates a successful connection. */
  open(): void {
    this.readyState = OPEN
    this.dispatch('open', new Event('open'))
  }

  /** Simulates a dropped connection the browser will retry on its own. */
  dropConnection(): void {
    this.readyState = CONNECTING
    this.dispatch('error', new Event('error'))
  }

  /** Simulates a connection the browser has given up on. */
  fail(): void {
    this.readyState = CLOSED
    this.dispatch('error', new Event('error'))
  }

  /** Delivers one streamed event, exactly as the backend frames it. */
  emit(event: StreamedEvent): void {
    this.dispatch(
      event.type,
      new MessageEvent(event.type, {
        data: JSON.stringify(event),
        lastEventId: String(event.position),
      }),
    )
  }

  /** Delivers a raw frame; used to prove malformed data is ignored. */
  emitRaw(type: string, data: string): void {
    this.dispatch(type, new MessageEvent(type, { data }))
  }

  private dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
