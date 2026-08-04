/**
 * The virtual clock the scenarios report `occurredAt` from.
 *
 * `occurredAt` is what the agent observed, not what the server received, so the
 * simulator is free to pick it — and it must, because the wall clock would make
 * every run a different document and destroy the idempotency and comparison
 * properties the acceptance criteria are written against.
 *
 * The base instant is the date the whole v0 contract and its examples are dated
 * to, so a simulated run reads consistently next to `api/examples/`.
 */
export const BASE_INSTANT_MS = Date.UTC(2026, 7, 4, 9, 0, 0)

export interface VirtualClock {
  /** Current instant as an RFC 3339 UTC timestamp. */
  now(): string
  /** Advances the clock by `ms` and returns the new instant. */
  advance(ms: number): string
}

/**
 * Creates a clock that starts at {@link BASE_INSTANT_MS}. It only ever moves
 * forward and only when a scenario says so, which keeps the reported timeline
 * strictly increasing without tying it to how fast the process happens to run.
 */
export function createClock(startMs: number = BASE_INSTANT_MS): VirtualClock {
  let current = startMs

  const format = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

  return {
    now: () => format(current),
    advance(ms: number): string {
      if (ms < 0) {
        throw new Error(`clock: cannot advance by a negative amount (${ms} ms)`)
      }
      current += ms
      return format(current)
    },
  }
}
