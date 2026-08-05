import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createI18n } from './createI18n'
import type { Language } from './languages'
import { ReportedTime } from './ReportedTime'

/**
 * The component half of #40: what a reported instant looks like on screen, and
 * what it still says about itself once it does.
 */

const INSTANT = '2026-08-04T09:12:00Z'
const NOW = Date.parse('2026-08-04T09:15:00Z')

function renderInstant(
  props: Parameters<typeof ReportedTime>[0],
  language: Language = 'de',
) {
  const i18n = createI18n({ language, dev: false })
  return render(
    <I18nextProvider i18n={i18n}>
      <ReportedTime {...props} />
    </I18nextProvider>,
  )
}

/** The one `<time>` the component renders. */
function timeElement(): HTMLTimeElement {
  const element = document.querySelector('time')
  if (element === null) throw new Error('no <time> was rendered')
  return element
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

describe('an absolute instant', () => {
  it('shows the UTC instant, labelled, and keeps the reported value in the DOM', () => {
    renderInstant({ value: INSTANT })

    const element = timeElement()
    expect(element).toHaveTextContent('04.08.2026, 09:12:00 UTC')
    expect(element).toHaveAttribute('datetime', INSTANT)
    // The rendering is ours and localised on purpose; a second, uncontrolled
    // translator reformatting it afterwards is not.
    expect(element).toHaveAttribute('translate', 'no')
  })

  it('renders the same instant in English, still as UTC', () => {
    renderInstant({ value: INSTANT }, 'en')

    expect(timeElement()).toHaveTextContent('04/08/2026, 09:12:00 UTC')
  })
})

describe('a relative instant', () => {
  it('reads as a distance and carries the exact UTC instant with it', () => {
    renderInstant({ value: INSTANT, display: 'relative' })

    const element = timeElement()
    expect(element).toHaveTextContent('vor 3 Minuten')
    expect(element).toHaveAttribute('title', '04.08.2026, 09:12:00 UTC')
    expect(element).toHaveAttribute('datetime', INSTANT)
    // A screen reader gets both halves: the distance and what it approximates.
    expect(element).toHaveAccessibleName('vor 3 Minuten, gemeldet 04.08.2026, 09:12:00 UTC')
  })

  it('does the same in English', () => {
    renderInstant({ value: INSTANT, display: 'relative' }, 'en')

    const element = timeElement()
    expect(element).toHaveTextContent('3 minutes ago')
    expect(element).toHaveAttribute('title', '04/08/2026, 09:12:00 UTC')
    expect(element).toHaveAccessibleName(
      '3 minutes ago, reported 04/08/2026, 09:12:00 UTC',
    )
  })

  it('never leaves the reader with only an approximation', () => {
    for (const language of ['de', 'en'] as const) {
      const { unmount } = renderInstant(
        { value: INSTANT, display: 'relative' },
        language,
      )
      const element = timeElement()
      expect(element.getAttribute('title')).toContain('UTC')
      expect(element.getAttribute('aria-label')).toContain('UTC')
      unmount()
    }
  })
})

describe('values that are not instants', () => {
  it('says a value was not reported rather than inventing one', () => {
    renderInstant({ value: null })
    expect(screen.getByText('nicht gemeldet')).toBeInTheDocument()
    expect(document.querySelector('time')).toBeNull()
  })

  it('says so in English too', () => {
    renderInstant({ value: undefined }, 'en')
    expect(screen.getByText('not reported')).toBeInTheDocument()
  })

  it('quotes an unparsable value instead of hiding or repairing it', () => {
    renderInstant({ value: 'irgendwann gestern' })

    // Verbatim, marked as reported data, and not dressed up as a date.
    const quoted = screen.getByText('irgendwann gestern')
    expect(quoted).toHaveAttribute('data-reported', '')
    expect(document.querySelector('time')).toBeNull()
    expect(document.body).not.toHaveTextContent('Invalid Date')
    expect(document.body).not.toHaveTextContent('NaN')
  })
})
