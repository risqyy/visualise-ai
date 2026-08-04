import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { WORK_STATES, WORK_STATE_DISCLAIMER } from '@/state/workStates'

import { StatusLegend } from './StatusLegend'

function renderLegend() {
  return render(
    <TooltipProvider>
      <StatusLegend />
    </TooltipProvider>,
  )
}

describe('StatusLegend', () => {
  it('covers exactly the four v0 work states', () => {
    expect(WORK_STATES.map((state) => state.id)).toEqual([
      'planned',
      'active',
      'recently_applied',
      'removed',
    ])
  })

  it('labels every state with text, so colour is never the only channel', () => {
    renderLegend()

    // Deliberately queried by text, not by colour: the legend has to be
    // readable without any colour perception at all.
    for (const state of WORK_STATES) {
      expect(screen.getByText(state.label)).toBeVisible()
    }
  })

  it('gives every state a second, colour-independent channel', () => {
    // Icon plus line style, both distinct per state.
    const icons = new Set(WORK_STATES.map((state) => state.icon))
    const strokes = new Set(WORK_STATES.map((state) => state.strokeDasharray))
    const borders = new Set(WORK_STATES.map((state) => state.borderStyle))

    expect(icons.size).toBe(WORK_STATES.length)
    expect(strokes.size).toBe(WORK_STATES.length)
    expect(borders.size).toBe(WORK_STATES.length)
  })

  it('states that the colours are work phases and not a quality judgement', async () => {
    const user = userEvent.setup()
    renderLegend()

    await user.click(screen.getByRole('button', { name: /Legende erklären/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(WORK_STATE_DISCLAIMER)
    expect(dialog).toHaveTextContent(/kein Qualitätsurteil/)

    // The explanation repeats every label together with its description.
    for (const state of WORK_STATES) {
      expect(dialog).toHaveTextContent(state.label)
      expect(dialog).toHaveTextContent(state.description)
    }
  })
})
