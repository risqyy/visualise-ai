/**
 * The chrome vocabulary of the run/agent pane — labels and control names the
 * **cockpit** owns.
 *
 * Two things are deliberately *not* in here:
 *
 * * **Reported project data.** Agent names, assigned tasks, status notes and
 *   plan step titles are quoted verbatim wherever they appear. The pane never
 *   rewrites, shortens or translates them; it only decides how much of them is
 *   painted at once.
 * * **The vocabulary of the read model.** Role, status, outcome and plan-step
 *   labels describe *what was reported* and live in `reporting.ts` next to the
 *   rules that produce them.
 *
 * Everything is collected in one module so the localisation migration (#42) can
 * lift the pane's own strings in a single move. The functions below build the
 * accessible names of the disclosure controls; they exist here rather than in
 * the components for the same reason.
 */

export const AGENT_PANE_TEXT = {
  /**
   * Field labels. `taskLabel` and `statusLabel` are rendered `sr-only`: the
   * compact row drops the visible label column to win the space, but a screen
   * reader still has to be told which reported text it is reading.
   */
  taskLabel: 'Aufgabe',
  statusLabel: 'Status',
  lastEventLabel: 'Zuletzt gemeldet',
  outcomeLabel: 'Abschluss',
  agentIdLabel: 'Agent-Id',

  /** Explicit "the report did not contain this" statements. */
  noTaskReported: 'keine Aufgabe gemeldet',
  noOutcomeReported: 'kein Abschluss gemeldet',

  /** Visible label of the "show the whole reported text" control. */
  showFullText: 'Mehr anzeigen',
  showLessText: 'Weniger anzeigen',

  /** Screen-reader headline of the counted status tally above the tree. */
  statusTallyLabel: 'Gemeldete Status',
} as const

/** Accessible name of the per-row detail disclosure. */
export function detailToggleLabel(agentName: string, open: boolean): string {
  return open ? `Details von ${agentName} ausblenden` : `Details von ${agentName} anzeigen`
}

/** Accessible name of the subtree disclosure. */
export function subtreeToggleLabel(agentName: string, collapsed: boolean): string {
  return `Subagents von ${agentName} ${collapsed ? 'ausklappen' : 'einklappen'}`
}

/**
 * Accessible name of a "show the whole reported text" control.
 *
 * `subject` names *which* reported text is meant — the assigned task or the
 * status message — so the control is unambiguous when a row carries both.
 */
export function textToggleLabel(
  subject: string,
  agentName: string,
  expanded: boolean,
): string {
  return expanded
    ? `${subject} von ${agentName} wieder kürzen`
    : `${subject} von ${agentName} vollständig anzeigen`
}

export const TEXT_SUBJECT = {
  task: 'Aufgabe',
  statusNote: 'Statusmeldung',
} as const
