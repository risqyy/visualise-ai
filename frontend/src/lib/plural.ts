/**
 * German count labels.
 *
 * The cockpit renders a lot of counted nouns, and German does not form its
 * plurals by appending an "s". Interpolating a count in front of a hard-coded
 * plural produced "1 Pläne", "1 Risiken", "1 Diffs" and "1 Kinder" — small
 * enough to look like a typo, frequent enough to make the whole surface feel
 * unfinished.
 */
export interface CountLabel {
  /** Form used for exactly one. */
  one: string
  /** Form used for zero and for more than one. */
  many: string
}

/** Returns the form that matches `count`, without the number. */
export function pluralise(count: number, label: CountLabel): string {
  return Math.abs(count) === 1 ? label.one : label.many
}

/** Returns `count` followed by the matching form, e.g. `1 Plan` / `2 Pläne`. */
export function counted(count: number, label: CountLabel): string {
  return `${count} ${pluralise(count, label)}`
}

/** The counted nouns the cockpit uses. */
export const COUNT_LABELS = {
  agent: { one: 'Agent', many: 'Agents' },
  plan: { one: 'Plan', many: 'Pläne' },
  workStep: { one: 'Arbeitsschritt', many: 'Arbeitsschritte' },
  child: { one: 'Kind', many: 'Kinder' },
  diff: { one: 'Diff', many: 'Diffs' },
  risk: { one: 'Risiko', many: 'Risiken' },
  problem: { one: 'Problem', many: 'Probleme' },
  feedback: { one: 'Feedback', many: 'Feedback' },
  component: { one: 'Komponente', many: 'Komponenten' },
  relationship: { one: 'Beziehung', many: 'Beziehungen' },
  revision: { one: 'Revision', many: 'Revisionen' },
  step: { one: 'Schritt', many: 'Schritte' },
  run: { one: 'Run', many: 'Runs' },
} as const satisfies Record<string, CountLabel>
