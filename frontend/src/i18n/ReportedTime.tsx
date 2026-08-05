import { useTranslation } from 'react-i18next'

import { ReportedText } from './ReportedText'
import {
  formatRelativeInstant,
  readReportedInstant,
  useClock,
  useFormattingLanguage,
} from './formatting'

/**
 * How a reported instant is shown.
 *
 * * `absolute` — the UTC instant itself, e.g. `04.08.2026, 09:12:00 UTC`. The
 *   default, and what every list of evidence uses: a diff, a risk or a plan
 *   revision is filed under the moment it was reported, and that moment is the
 *   thing being read.
 * * `relative` — `vor 3 Minuten`, for the "last reported" line of the project
 *   list and of an agent row. There the question is not *when* but *how long
 *   ago*, and an ISO string is a poor answer to it.
 */
export type ReportedTimeDisplay = 'absolute' | 'relative'

export interface ReportedTimeProps {
  /** The reported timestamp, exactly as the API delivered it. */
  value: string | null | undefined
  display?: ReportedTimeDisplay
  className?: string | undefined
}

/**
 * Renders a timestamp an agent reported.
 *
 * The sibling of `<ReportedText>`, for the one kind of reported value whose
 * *presentation* the translation contract does allow us to change (ADR 0014).
 * The value still may not move, and three things keep it from moving:
 *
 * * **The zone is always UTC and always labelled.** Every absolute rendering
 *   carries `UTC` from the same `Intl` formatter that produced the digits, in
 *   both languages. The cockpit never shows a reported instant in the reader's
 *   local zone, because that would silently restate when the agent reported.
 * * **The reported value stays in the DOM.** `dateTime` carries the reported
 *   string byte-for-byte — no re-serialisation, no normalisation — so the exact
 *   UTC fact is still there even when the visible text says "vor 3 Minuten".
 * * **A relative phrase never stands alone.** It is an approximation against the
 *   reader's clock, so the exact UTC instant comes with it: visible on hover
 *   through `title`, and read out through `aria-label`, which names the relative
 *   phrase *and* the instant it approximates.
 *
 * `translate="no"` is set for the same reason `<ReportedText>` sets it. The
 * rendering above is a deliberate, locale-aware one; letting the browser's own
 * page translation reformat it afterwards would put a second, unaccountable
 * translator between the agent's report and the reader.
 *
 * A value that was never reported is named as missing, and one that does not
 * parse is handed through verbatim as reported data — never repaired, never
 * replaced by `Invalid Date`.
 */
export function ReportedTime({ value, display = 'absolute', className }: ReportedTimeProps) {
  const { t } = useTranslation('common')
  const language = useFormattingLanguage()
  const now = useClock()
  const instant = readReportedInstant(value, language)

  if (instant.kind === 'absent') {
    return (
      <span className={className} data-reported-time="absent">
        {t('time.notReported')}
      </span>
    )
  }

  if (instant.kind === 'invalid') {
    // Not a point in time, so nothing here can format it. It stays what it is:
    // a reported value, quoted.
    return <ReportedText value={instant.raw} className={className} />
  }

  if (display === 'absolute') {
    return (
      <time
        dateTime={instant.raw}
        className={className}
        translate="no"
        data-reported-time="absolute"
      >
        {instant.absolute}
      </time>
    )
  }

  const relative = formatRelativeInstant(instant.epochMs, language, now)

  return (
    <time
      dateTime={instant.raw}
      title={instant.absolute}
      aria-label={t('time.relativeWithExact', { relative, absolute: instant.absolute })}
      className={className}
      translate="no"
      data-reported-time="relative"
    >
      {relative}
    </time>
  )
}
