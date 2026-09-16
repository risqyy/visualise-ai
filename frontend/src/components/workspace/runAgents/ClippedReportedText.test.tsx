import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClippedReportedText } from './ClippedReportedText'

const props = { text: 'Eine kurze Statusmeldung.', subject: 'Status', agentName: 'Reporter', lines: 1 as const, testId: 'report' }

describe('reported text disclosure follows measured overflow', () => {
  let box: { clientHeight: number; scrollHeight: number; clientWidth: number; scrollWidth: number }
  let observers: { notify: () => void; disconnect: ReturnType<typeof vi.fn> }[]

  beforeEach(() => {
    box = { clientHeight: 16, scrollHeight: 32, clientWidth: 160, scrollWidth: 160 }
    observers = []
    for (const property of ['clientHeight', 'scrollHeight', 'clientWidth', 'scrollWidth'] as const) {
      vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(() => box[property])
    }
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      constructor(callback: ResizeObserverCallback) {
        observers.push({ notify: () => callback([], this as unknown as ResizeObserver), disconnect: this.disconnect })
      }
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('offers keyboard disclosure for a short report when its rendered lines overflow', async () => {
    const user = userEvent.setup()
    render(<ClippedReportedText {...props} />)
    const text = screen.getByTestId('report')
    const toggle = screen.getByTestId('report-toggle')
    expect(text.textContent).toBe(props.text)
    expect(text).toHaveAttribute('translate', 'no')
    expect(text).toHaveAttribute('data-reported', '')
    expect(text).toHaveClass('line-clamp-1')
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveFocus()
    expect(text).not.toHaveClass('line-clamp-1')
    expect(text.textContent).toBe(props.text)

    // A wider pane must keep the collapse action available while expanded.
    box.scrollHeight = box.clientHeight
    act(() => observers.forEach((observer) => observer.notify()))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard(' ')
    expect(text).toHaveClass('line-clamp-1')
    expect(text.textContent).toBe(props.text)
    expect(screen.queryByTestId('report-toggle')).not.toBeInTheDocument()
  })

  it('does not offer expansion for a long report that fits, but reacts to width changes', () => {
    box.scrollHeight = box.clientHeight
    const text = 'A long but fully visible report. '.repeat(5)
    const view = render(<ClippedReportedText {...props} text={text} />)
    expect(screen.queryByTestId('report-toggle')).not.toBeInTheDocument()
    expect(screen.getByTestId('report').textContent).toBe(text)
    box.scrollWidth = 240
    act(() => observers.forEach((observer) => observer.notify()))
    expect(screen.getByTestId('report-toggle')).toHaveAttribute('aria-expanded', 'false')
    box.scrollWidth = box.clientWidth
    act(() => observers.forEach((observer) => observer.notify()))
    expect(screen.queryByTestId('report-toggle')).not.toBeInTheDocument()
    view.unmount()
    expect(observers.length).toBeGreaterThan(0)
    expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true)
  })

  it('remeasures when the report or permitted line count changes', () => {
    const view = render(<ClippedReportedText {...props} />)
    expect(screen.getByTestId('report-toggle')).toBeInTheDocument()
    box.clientHeight = 48
    view.rerender(<ClippedReportedText {...props} lines={3} />)
    expect(screen.getByTestId('report')).toHaveClass('line-clamp-3')
    expect(screen.queryByTestId('report-toggle')).not.toBeInTheDocument()
    box.scrollHeight = 80
    view.rerender(<ClippedReportedText {...props} lines={3} text="Ein neuer, mehrzeiliger Bericht." />)
    expect(screen.getByTestId('report-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('report').textContent).toBe('Ein neuer, mehrzeiliger Bericht.')
  })
})
