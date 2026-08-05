export interface ReportedTextProps {
  /** The reported value, exactly as the API delivered it. */
  value: string
  className?: string | undefined
}

/**
 * Renders a value that an agent reported — verbatim, and never translated.
 *
 * The cockpit shows two kinds of text, and they must not be confused:
 *
 * * **UI chrome** — headings, buttons, states, accessible names. Ours. It goes
 *   through `t()`.
 * * **Reported project data** — component and run ids, file paths, agent
 *   feedback, task descriptions, diffs, NATS topics, timestamps. Not ours. It
 *   is evidence, and a translated piece of evidence is a falsified one.
 *
 * This component is the second case made visible in the code. Wrapping a value
 * in it says, at the call site and in a `git grep`, "this is reported data",
 * and it does one thing that no comment can: `translate="no"` keeps the
 * browser's own page translation away from it. Chrome happily translates agent
 * feedback and code diffs on a page marked `lang="de"`, and the user would
 * never learn that the audit trail they are reading is a machine translation.
 *
 * `data-reported` exists for tests and for grepping, not for styling.
 *
 * The complementary rule, for the places where markup is impossible — an
 * `aria-label`, a `title` — is to interpolate the reported value into a
 * translated string: `t('projects:item.openLabel', { projectId })`. i18next
 * never translates an interpolated value, and `escapeValue: false`
 * (see `createI18n`) keeps it byte-identical.
 */
export function ReportedText({ value, className }: ReportedTextProps) {
  return (
    <span className={className} translate="no" data-reported="">
      {value}
    </span>
  )
}
