import type { RunAgent, Timestamp } from '@/api/types'

/**
 * Small, shared display helpers of the inspector.
 *
 * They format; they never derive. A status the agent never reported stays
 * "nicht gemeldet" instead of becoming a plausible-looking default, because the
 * cockpit shows evidence and silence changes nothing (ADR 0005).
 */

/** Timestamps arrive normalised to UTC; the cockpit shows them as UTC. */
const TIME_FORMAT = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'UTC',
})

/** `2026-08-04T09:12:00Z` -> `04.08.26, 09:12:00 UTC`. Invalid input is echoed. */
export function formatTimestamp(value: Timestamp | null | undefined): string {
  if (!value) return 'nicht gemeldet'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return `${TIME_FORMAT.format(parsed)} UTC`
}

/**
 * German labels for the status a `RunAgent` carries.
 *
 * `RunAgent.status` has one more member than `AgentStatusReportedPayload.status`:
 * the empty string, which the read model uses for "no status was ever
 * reported". Keying off the read model keeps that case a label rather than an
 * invented default.
 */
export const AGENT_STATUS_LABELS: Record<RunAgent['status'], string> = {
  '': 'kein Status gemeldet',
  working: 'arbeitet',
  waiting: 'wartet',
  blocked: 'blockiert',
  idle: 'untätig',
  done: 'fertig',
}

/** Rendered as `+12 / −3`; the minus is a typographic minus, not a hyphen. */
export function formatDiffStat(additions: number, removals: number): string {
  return `+${additions} / −${removals}`
}

/** Falls back to a neutral phrase instead of rendering an empty element. */
export function orNotReported(value: string, fallback = 'nicht gemeldet'): string {
  return value.trim() === '' ? fallback : value
}
