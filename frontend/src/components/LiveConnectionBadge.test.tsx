import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'

import type { LiveConnectionState } from '@/api/liveStream'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createI18n, type Language } from '@/i18n'
import { useLiveConnectionStore } from '@/state/liveConnectionStore'
import { PROJECT_ID } from '@/test/fixtures'

import { LiveConnectionBadge } from './LiveConnectionBadge'

function renderConnection(language: Language = 'de') {
  useLiveConnectionStore.getState().activate(PROJECT_ID)
  const i18n = createI18n({ language })
  render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <label>Reader position<input /></label>
        <LiveConnectionBadge />
        <button type="button">Continue reading</button>
      </TooltipProvider>
    </I18nextProvider>,
  )
  return { i18n }
}

async function connectionState(state: LiveConnectionState) {
  await act(async () => { useLiveConnectionStore.getState().setState(PROJECT_ID, state) })
}

describe('live connection — accessible changes without interrupting the reader', () => {
  it.each(['de', 'en'] as const)('announces connection loss and restoration politely in %s without moving focus', async (language) => {
    const user = userEvent.setup()
    renderConnection(language)
    const reader = screen.getByRole('textbox', { name: 'Reader position' })
    await user.tab()
    expect(reader).toHaveFocus()
    const announcement = screen.getByTestId('live-connection-announcement')
    expect(announcement).toHaveAttribute('role', 'status')
    expect(announcement).toHaveAttribute('aria-live', 'polite')
    expect(announcement).toHaveAttribute('aria-atomic', 'false')
    expect(announcement).toHaveTextContent(language === 'de' ? /Verbindung.*aufgebaut/ : /connection.*being established/)

    const wording = language === 'de'
      ? {
          reconnecting: [/Verbindung ist unterbrochen/, /Daten bleiben erhalten/],
          offline: [/Keine Live-Verbindung/, /zuletzt geladene Stand/, /nicht mehr aktualisiert/],
          live: [/Verbindung.*hergestellt/, /Echtzeit/],
        }
      : {
          reconnecting: [/connection is interrupted/, /data on screen is kept/],
          offline: [/No live connection/, /last state loaded/, /no longer being updated/],
          live: [/connection.*established/i, /real time/],
        }
    for (const state of ['reconnecting', 'offline', 'live'] as const) {
      await connectionState(state)
      expect(screen.getByTestId('live-connection-announcement')).toBe(announcement)
      for (const phrase of wording[state]) expect(announcement).toHaveTextContent(phrase)
      expect(reader).toHaveFocus()
      expect(screen.getByTestId('live-connection-state')).toHaveAttribute('data-state', state)
    }
  })

  it.each(['de', 'en'] as const)('makes the same connection explanation available by hover and keyboard focus in %s', async (language) => {
    const user = userEvent.setup()
    renderConnection(language)
    await connectionState('reconnecting')
    await act(async () => { useLiveConnectionStore.getState().recordEvent(PROJECT_ID, 42) })
    const badge = screen.getByTestId('live-connection-state')
    const announcement = screen.getByTestId('live-connection-announcement')
    expect(badge).toHaveAttribute('tabindex', '0')
    expect(badge).not.toHaveAttribute('role', 'button')
    expect(badge.tagName).not.toBe('BUTTON')
    await user.hover(badge)
    const hoverTooltip = await screen.findByRole('tooltip')
    const hoverText = hoverTooltip.textContent
    expect(hoverTooltip).toHaveTextContent(announcement.textContent!)
    expect(hoverTooltip).toHaveTextContent('42')
    await user.unhover(badge)
    // Move past Radix's pointer grace area; jsdom otherwise leaves both the
    // trigger and tooltip rectangles at the same zero-sized origin.
    await user.pointer({ target: document.body, coords: { clientX: 500, clientY: 500 } })
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())

    await user.tab()
    expect(screen.getByRole('textbox', { name: 'Reader position' })).toHaveFocus()
    await user.tab()
    expect(badge).toHaveFocus()
    const focusedTooltip = await screen.findByRole('tooltip')
    expect(focusedTooltip.textContent).toBe(hoverText)
    expect(badge).toHaveAttribute('aria-describedby', focusedTooltip.id)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Continue reading' })).toHaveFocus()
  })

  it('does not mutate the announcement for data positions or repeated states, but does for a connection transition', async () => {
    renderConnection()
    await connectionState('live')
    const announcement = screen.getByTestId('live-connection-announcement')
    const initialText = announcement.textContent
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    observer.observe(announcement, { subtree: true, childList: true, characterData: true, attributes: true })
    try {
      for (let position = 1; position <= 5; position += 1) {
        await act(async () => {
          useLiveConnectionStore.getState().recordEvent(PROJECT_ID, position)
          useLiveConnectionStore.getState().setState(PROJECT_ID, 'live')
        })
      }
      expect(useLiveConnectionStore.getState().lastEventPosition).toBe(5)
      expect(announcement.textContent).toBe(initialText)
      expect(screen.getByTestId('live-connection-announcement')).toBe(announcement)
      expect(mutations).toEqual([])

      await connectionState('offline')
      expect(announcement).toHaveTextContent('Keine Live-Verbindung')
      expect(mutations.some((record) => record.type === 'characterData' || record.type === 'childList')).toBe(true)
      mutations.length = 0
      await connectionState('offline')
      expect(mutations).toEqual([])
    } finally {
      observer.disconnect()
    }
  })

  it('updates the explanatory language without changing connection state or event position', async () => {
    const { i18n } = renderConnection('de')
    await connectionState('offline')
    await act(async () => { useLiveConnectionStore.getState().recordEvent(PROJECT_ID, 42) })
    const announcement = screen.getByTestId('live-connection-announcement')
    expect(announcement).toHaveTextContent('Keine Live-Verbindung')
    await act(async () => { await i18n.changeLanguage('en') })
    expect(screen.getByTestId('live-connection-announcement')).toBe(announcement)
    expect(announcement).toHaveTextContent('No live connection')
    expect(useLiveConnectionStore.getState().state).toBe('offline')
    expect(useLiveConnectionStore.getState().lastEventPosition).toBe(42)
  })
})
