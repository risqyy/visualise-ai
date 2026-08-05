import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ReportedText } from './ReportedText'

/**
 * The translation contract, from the side that matters most: what an agent
 * reported must arrive on screen unchanged, whatever the UI language is.
 */
describe('ReportedText', () => {
  it('passes a reported value through byte for byte', () => {
    const reported = [
      'shop-platform.orders.domain',
      'backend/internal/ingest/handler.go',
      'vai.events.component.change_applied',
      'run-2026-08-04-0001',
      '2026-08-04T09:12:00Z',
      'Die Zahlung schlägt fehl, wenn der Betrag 0 ist.',
      '- return nil\n+ return errors.New("amount must be positive")',
      '  leading and trailing spaces  ',
      '',
    ]

    const { container } = render(
      <div>
        {reported.map((value, index) => (
          <ReportedText key={index} value={value} />
        ))}
      </div>,
    )

    const rendered = [...container.querySelectorAll('[data-reported]')].map(
      (node) => node.textContent,
    )
    expect(rendered).toEqual(reported)
  })

  it('renders a value that collides with a translation key as that value', () => {
    // A component could genuinely be called `list.title`. It is data, so it is
    // rendered, not looked up.
    render(<ReportedText value="projects:list.title" />)

    expect(screen.getByText('projects:list.title')).toBeInTheDocument()
  })

  it('marks the value as untranslatable for the browser itself', () => {
    render(<ReportedText value="orchestrator-root" className="font-mono" />)

    const node = screen.getByText('orchestrator-root')
    // Without this, a browser's own page translation rewrites agent feedback and
    // code diffs on a page that declares `lang="de"`.
    expect(node).toHaveAttribute('translate', 'no')
    expect(node).toHaveClass('font-mono')
  })
})
