import { useTranslation } from 'react-i18next'

import { describeError } from '@/api/problem'
import { ReportedText } from '@/i18n'

/**
 * The one-line explanation of a failed request.
 *
 * It exists as a component rather than as a `describeError()` that returns a
 * finished sentence, because the sentence has two authors. The backend's
 * problem title and its stable code are **reported data** — they arrive over
 * the wire and are rendered verbatim, marked `translate="no"` so a browser's
 * own page translation cannot rewrite them either. The two generic fallbacks
 * ("no HTTP response at all", "something that is not an Error was thrown") are
 * the cockpit's own words and come from the catalogue.
 *
 * ADR 0014 left this split to #42 on purpose: `describeError` is not a
 * component and cannot call `useTranslation`, and half-solving it would have
 * meant a German literal in `src/api`.
 */
export function ErrorDescription({ error }: { error: unknown }) {
  const { t } = useTranslation('errors')
  const description = describeError(error)

  if (description.kind === 'backendUnreachable') {
    return (
      <>
        {t('generic.backendUnreachable', { detail: description.detail })}
      </>
    )
  }
  if (description.kind === 'unknown') return <>{t('generic.unknown')}</>

  return <ReportedText value={description.text} />
}
