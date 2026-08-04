import { render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import type { RelationshipKind } from '@/api/types'
import { TooltipProvider } from '@/components/ui/tooltip'

import { RelationshipLegend } from './RelationshipLegend'

/** The legend uses tooltips, which Radix only renders inside its provider. */
const render = (ui: ReactElement) =>
  rtlRender(<TooltipProvider>{ui}</TooltipProvider>)

const ALL_KINDS: RelationshipKind[] = [
  'http',
  'grpc',
  'data',
  'async',
  'nats_topic',
  'dependency',
]

function renderedKinds(): string[] {
  return ALL_KINDS.filter((kind) =>
    screen.queryByTestId(`relationship-legend-${kind}`) !== null,
  )
}

describe('relationship legend', () => {
  it('lists only the kinds the reported model actually contains', () => {
    render(<RelationshipLegend kinds={['http', 'dependency', 'data', 'async']} />)

    expect(renderedKinds()).toEqual(['http', 'data', 'async', 'dependency'])
  })

  it('does not offer NATS or gRPC to a project that reports neither', () => {
    // The cockpit observes; a legend that advertises a message bus nobody
    // reported sends the reader looking for something that is not there.
    render(<RelationshipLegend kinds={['http', 'dependency']} />)

    expect(screen.queryByTestId('relationship-legend-nats_topic')).toBeNull()
    expect(screen.queryByTestId('relationship-legend-grpc')).toBeNull()
  })

  it('keeps the catalogue order rather than the order of first appearance', () => {
    render(<RelationshipLegend kinds={['dependency', 'async', 'http']} />)

    expect(renderedKinds()).toEqual(['http', 'async', 'dependency'])
  })

  it('falls back to the full catalogue while nothing has been reported', () => {
    render(<RelationshipLegend kinds={[]} />)

    expect(renderedKinds()).toEqual(ALL_KINDS)
  })

  it('renders every kind with its colour-independent channels', () => {
    render(<RelationshipLegend kinds={['http', 'nats_topic']} />)

    for (const kind of ['http', 'nats_topic']) {
      const entry = screen.getByTestId(`relationship-legend-${kind}`)
      expect(entry.getAttribute('data-dasharray')).toBeTruthy()
      expect(entry.getAttribute('data-marker')).toBeTruthy()
    }
  })
})
