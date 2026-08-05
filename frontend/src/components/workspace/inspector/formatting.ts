import type { RunAgent } from '@/api/types'
import type { AgentsKey, InspectorKey } from '@/i18n'

/**
 * Small, shared display helpers of the inspector.
 *
 * They format; they never derive. A status the agent never reported stays
 * "not reported" instead of becoming a plausible-looking default, because the
 * cockpit shows evidence and silence changes nothing (ADR 0005).
 *
 * Timestamps used to be formatted here as well, with a `de-DE` formatter and a
 * two-digit year — a second, differently shaped rendering of the same kind of
 * fact the run/agent pane already rendered its own way. They now go through
 * `<ReportedTime>` and `src/i18n/formatting.ts` (#40, ADR 0019).
 *
 * Since #42 nothing here holds a word either: the status vocabulary is a map of
 * translation keys, and `orNotReported` takes the caller's already-translated
 * sentence rather than inventing a German one.
 */

/**
 * Keys for the status a `RunAgent` carries.
 *
 * `RunAgent.status` has one more member than `AgentStatusReportedPayload.status`:
 * the empty string, which the read model uses for "no status was ever
 * reported". Keying off the read model keeps that case a label rather than an
 * invented default.
 *
 * The words live in the `agents` namespace and not in `inspector`: the
 * inspector shows the *same* closed vocabulary as the agent tree, and two
 * catalogue entries for one word are two entries that drift apart.
 */
export const INSPECTOR_AGENT_STATUS_LABEL_KEY: Record<RunAgent['status'], AgentsKey> = {
  '': 'status.unreported',
  working: 'status.working',
  waiting: 'status.waiting',
  blocked: 'status.blocked',
  idle: 'status.idle',
  done: 'status.done',
}

export const RISK_SEVERITY_LABEL_KEY = {
  low: 'risk.severityLow',
  medium: 'risk.severityMedium',
  high: 'risk.severityHigh',
} as const satisfies Record<string, InspectorKey>

/** Rendered as `+12 / −3`; the minus is a typographic minus, not a hyphen. */
export function formatDiffStat(additions: number, removals: number): string {
  return `+${additions} / −${removals}`
}

/** Falls back to the caller's neutral phrase instead of an empty element. */
export function orNotReported(value: string, fallback: string): string {
  return value.trim() === '' ? fallback : value
}
