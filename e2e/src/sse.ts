/**
 * A raw Server-Sent Events reader.
 *
 * The browser's `EventSource` cannot be forced to drop a connection at a chosen
 * moment and then be asked what exactly it received before and after — which is
 * the whole point of check 7. This reader owns the socket, so the suite can cut
 * it mid-run and compare the two halves position by position.
 *
 * It parses the frame the contract documents and the backend writes
 * (`backend/internal/sse/connection.go`): `id:` is the project position,
 * `event:` the catalogue type, `data:` one compact-JSON `StreamedEvent`.
 * Keepalives are comment lines and carry no `id:`, so they can never be
 * mistaken for an event.
 */

export interface SseFrame {
  /** Project position, from the `id:` field. */
  position: number
  /** Event type, from the `event:` field. */
  type: string
  /** `position` as the JSON payload reports it — must equal `position`. */
  payloadPosition: number
  projectId: string
}

export class SseRecorder {
  readonly frames: SseFrame[] = []
  /** HTTP status of the response. `0` until {@link open} resolved. */
  status = 0
  /** Non-`null` when the read loop ended with something other than an abort. */
  error: unknown = null
  /** `true` once the server closed the stream by itself. */
  streamEnded = false

  private readonly controller = new AbortController()
  private pumping: Promise<void> = Promise.resolve()
  private aborted = false

  constructor(readonly url: string) {}

  /** Connects and starts reading. Resolves with the HTTP status. */
  async open(): Promise<number> {
    const response = await fetch(this.url, {
      headers: { accept: 'text/event-stream', 'cache-control': 'no-cache' },
      signal: this.controller.signal,
    })
    this.status = response.status

    if (response.status !== 200 || response.body === null) {
      // Drain so the socket is released; the body is a problem document.
      await response.text().catch(() => undefined)
      return this.status
    }

    this.pumping = this.pump(response.body)
    return this.status
  }

  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      // @ts-expect-error -- Node's ReadableStream is async-iterable at runtime.
      for await (const chunk of body) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true })
        let separator = buffer.indexOf('\n\n')
        while (separator !== -1) {
          const block = buffer.slice(0, separator)
          buffer = buffer.slice(separator + 2)
          this.consumeBlock(block)
          separator = buffer.indexOf('\n\n')
        }
      }
      this.streamEnded = true
    } catch (cause) {
      if (!this.aborted) this.error = cause
    }
  }

  private consumeBlock(block: string): void {
    let id: string | null = null
    let type: string | null = null
    let data: string | null = null

    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue // comment / keepalive
      if (line.startsWith('id:')) id = line.slice(3).trim()
      else if (line.startsWith('event:')) type = line.slice(6).trim()
      else if (line.startsWith('data:')) data = line.slice(5).trim()
    }

    if (id === null || data === null) return

    let decoded: { position?: unknown; projectId?: unknown }
    try {
      decoded = JSON.parse(data) as { position?: unknown; projectId?: unknown }
    } catch {
      this.error = new Error(`SSE frame carried unparseable data: ${data.slice(0, 200)}`)
      return
    }

    this.frames.push({
      position: Number(id),
      type: type ?? '',
      payloadPosition: typeof decoded.position === 'number' ? decoded.position : Number.NaN,
      projectId: typeof decoded.projectId === 'string' ? decoded.projectId : '',
    })
  }

  get positions(): number[] {
    return this.frames.map((frame) => frame.position)
  }

  get lastPosition(): number | null {
    const last = this.frames.at(-1)
    return last ? last.position : null
  }

  /** Waits until at least `count` frames arrived, or throws on timeout. */
  async waitForCount(count: number, timeoutMs = 60_000): Promise<void> {
    await this.waitUntil(
      () => this.frames.length >= count,
      timeoutMs,
      () => `only ${this.frames.length} of ${count} frames arrived on ${this.url}`,
    )
  }

  /** Waits until a frame with `position >= position` arrived. */
  async waitForPosition(position: number, timeoutMs = 120_000): Promise<void> {
    await this.waitUntil(
      () => (this.lastPosition ?? -1) >= position,
      timeoutMs,
      () =>
        `position ${position} never arrived on ${this.url}; last seen ${String(this.lastPosition)}`,
    )
  }

  private async waitUntil(
    predicate: () => boolean,
    timeoutMs: number,
    describe: () => string,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
      if (this.error) throw this.error
      if (Date.now() > deadline) throw new Error(`SSE timeout: ${describe()}`)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  /** Cuts the connection. This is the forced disconnect of check 7. */
  async abort(): Promise<void> {
    this.aborted = true
    this.controller.abort()
    await this.pumping.catch(() => undefined)
  }
}
