import type { RunAgent } from '@/api/types'

/**
 * Small, shared display helpers of the inspector.
 *
 * They format; they never derive. A status the agent never reported stays
 * "nicht gemeldet" instead of becoming a plausible-looking default, because the
 * cockpit shows evidence and silence changes nothing (ADR 0005).
 *
 * Timestamps used to be formatted here as well, with a `de-DE` formatter and a
 * two-digit year — a second, differently shaped rendering of the same kind of
 * fact the run/agent pane already rendered its own way. They now go through
 * `<ReportedTime>` and `src/i18n/formatting.ts` (#40, ADR 0019).
 */

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
