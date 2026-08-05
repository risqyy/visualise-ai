import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Language } from '@/i18n'
import { RUN_ID } from '@/test/fixtures'
import { COMPONENT_ID, FEEDBACK_MARKDOWN } from '@/test/inspectorFixtures'
import { CHAINED_TASK, PARAGRAPH_TASK } from '@/test/runFixtures'
import { renderApp } from '@/test/renderApp'
import {
  WORKSPACE_SCENE_URL,
  renderWorkspaceScene,
  workspaceSceneServer,
} from '@/test/workspaceScene'

/**
 * The whole workspace, rendered twice.
 *
 * This is the acceptance of #42 expressed as a test, and it has two halves that
 * pull in opposite directions:
 *
 * 1. **Everything the cockpit says changes with the language.** Pane titles,
 *    tabs, status words, legends, accessible names and screen-reader text.
 * 2. **Everything the agent said does not.** The assigned task, the markdown
 *    feedback, a unified diff with its file path, component and run ids — those
 *    are compared byte for byte between the two renderings, because a diff that
 *    has been translated is not a diff and translated feedback is a falsified
 *    audit source (ADR 0014).
 *
 * The second half is the important one. It is checked by collecting every node
 * the contract marks with `data-reported` and comparing the two arrays, so it
 * covers whatever is on screen rather than a list somebody remembered to keep
 * up to date.
 */

interface Rendered {
  reported: string[]
  translatable: string[]
  unmount: () => void
}

/** Renders the workspace and separates what is ours from what is the agent's. */
async function renderWorkspace(language: Language): Promise<Rendered> {
  const { container, unmount } = await renderWorkspaceScene({ language })

  const reported = [...container.querySelectorAll('[data-reported]')].map(
    (node) => node.textContent ?? '',
  )
  const translatable = [...container.querySelectorAll('[aria-label]')].map(
    (node) => node.getAttribute('aria-label') ?? '',
  )

  return { reported, translatable, unmount }
}

describe('workspace — the same three panes in German and English', () => {
  it('renders the cockpit chrome in German', async () => {
    const { unmount } = await renderWorkspace('de')

    expect(screen.getByRole('heading', { name: 'Runs und Agents' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Architektur' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Inspector' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Aktueller Run' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Historie' })).toBeVisible()
    expect(screen.getByText('Arbeitszustände')).toBeVisible()
    expect(screen.getByText('Runzustand')).toBeVisible()
    expect(screen.getByTestId('run-openness')).toHaveTextContent(
      'offen — kein Terminalereignis gemeldet',
    )

    unmount()
  })

  it('renders the same components in English', async () => {
    const { unmount } = await renderWorkspace('en')

    expect(screen.getByRole('heading', { name: 'Runs and agents' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Architecture' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Inspector' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Current run' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'History' })).toBeVisible()
    expect(screen.getByText('Work states')).toBeVisible()
    expect(screen.getByText('Run state')).toBeVisible()
    expect(screen.getByTestId('run-openness')).toHaveTextContent(
      'open — no terminal event reported',
    )

    unmount()
  })

  it('translates the status vocabulary without touching the reported value', async () => {
    const german = await renderWorkspace('de')
    const germanRoot = screen.getByTestId('agent-status-orchestrator-root')
    expect(germanRoot).toHaveTextContent('untätig')
    expect(screen.getByTestId('agent-status-subagent-implementer')).toHaveTextContent(
      'arbeitet',
    )
    // The contract value stays `idle` — only the word next to it changes.
    expect(germanRoot).toHaveAttribute('data-status', 'idle')
    german.unmount()

    const english = await renderWorkspace('en')
    const englishRoot = screen.getByTestId('agent-status-orchestrator-root')
    expect(englishRoot).toHaveTextContent('idle')
    expect(screen.getByTestId('agent-status-subagent-implementer')).toHaveTextContent(
      'working',
    )
    expect(englishRoot).toHaveAttribute('data-status', 'idle')
    english.unmount()
  })
})

describe('workspace — accessible names and screen-reader text', () => {
  it('translates the accessible names of the chrome', async () => {
    const german = await renderWorkspace('de')
    expect(german.translatable).toContain('Run- und Agent-Bereich')
    expect(german.translatable).toContain('Breite des Inspectors')
    expect(german.translatable).toContain('Agents filtern')
    expect(german.translatable).toContain('Gemeldeter Runzustand')
    german.unmount()

    const english = await renderWorkspace('en')
    expect(english.translatable).toContain('Runs and agents')
    expect(english.translatable).toContain('Width of the inspector pane')
    expect(english.translatable).toContain('Filter agents')
    expect(english.translatable).toContain('Reported run state')
    english.unmount()
  })

  it('translates a screen-reader label that names a reported text', async () => {
    // `sr-only` labels are the ones nobody sees and therefore nobody notices
    // being left behind. The compact agent row drops the visible label column
    // and relies on exactly these.
    const german = await renderWorkspace('de')
    expect(screen.getByTestId('agent-tree')).toHaveTextContent('Gemeldete Status')
    expect(screen.getByTestId('agent-row-orchestrator-root')).toHaveTextContent('Aufgabe:')
    german.unmount()

    const english = await renderWorkspace('en')
    expect(screen.getByTestId('agent-tree')).toHaveTextContent('Reported statuses')
    expect(screen.getByTestId('agent-row-orchestrator-root')).toHaveTextContent('Task:')
    english.unmount()
  })

  it('interpolates the reported agent name into the translated control name', async () => {
    const german = await renderWorkspace('de')
    expect(german.translatable).toContain('Details von Root Orchestrator anzeigen')
    german.unmount()

    const english = await renderWorkspace('en')
    expect(english.translatable).toContain('Show the details of Root Orchestrator')
    english.unmount()
  })
})

describe('workspace — reported project data is identical in both languages', () => {
  it('renders every reported value byte for byte the same', async () => {
    const german = await renderWorkspace('de')
    const germanReported = german.reported
    german.unmount()

    const english = await renderWorkspace('en')
    const englishReported = english.reported
    english.unmount()

    // Not "the same set" and not "the same length": the same strings, in the
    // same order, character for character.
    expect(englishReported).toEqual(germanReported)
    expect(germanReported.length).toBeGreaterThan(20)
  })

  it('leaves the agent task, the feedback, a diff and the ids untouched', async () => {
    for (const language of ['de', 'en'] as const) {
      const { reported, unmount } = await renderWorkspace(language)
      const all = reported.join('\n')

      // A whole paragraph of assigned task, and a task chained from three
      // issue titles — both reported, both English inside a German UI.
      expect(reported).toContain(PARAGRAPH_TASK)
      expect(reported).toContain(CHAINED_TASK)

      // The markdown feedback, rendered rather than quoted: its headings and
      // its fenced code block have to survive both languages.
      const markdown = screen.getByTestId('safe-markdown')
      expect(markdown).toHaveAttribute('translate', 'no')
      expect(markdown).toHaveTextContent('Was ich angesehen habe')
      expect(markdown.textContent).toContain(
        'total := discounted.Add(tax.For(order.DeliveryCountry).Apply(discounted))',
      )
      // …and the source it was rendered from is the reported body, unchanged.
      expect(FEEDBACK_MARKDOWN).toContain('## Was ich angesehen habe')

      // A unified diff, with its repository path and its changed lines. The
      // reported bytes are marked line by line; the screen-reader prefix
      // between them is ours and does change with the language.
      expect(reported).toContain('internal/orders/domain/pricing/pricing.go')
      expect(reported).toContain('+\tvat := tax.For(order.DeliveryCountry)')
      expect(reported).toContain('-\tvat := legacy.RateDE')
      const diffs = screen.getAllByTestId('unified-diff')
      expect(diffs.length).toBeGreaterThan(1)
      for (const diff of diffs) {
        expect(diff.querySelector('[data-reported]')).not.toBeNull()
      }

      // Component id, run id and an agent id.
      expect(reported).toContain(COMPONENT_ID)
      expect(all).toContain(RUN_ID)
      expect(reported).toContain('subagent-implementer')

      unmount()
    }
  })

  it('marks every reported value untranslatable for the browser as well', async () => {
    const { reported, unmount } = await renderWorkspace('de')
    const { container } = renderApp(WORKSPACE_SCENE_URL, {
      fetchImpl: workspaceSceneServer(),
    })

    // `data-reported` and `translate="no"` are one and the same marker: a value
    // that is greppable but that Chrome would still rewrite protects nothing.
    const marked = [...container.querySelectorAll('[data-reported]')]
    for (const node of marked) {
      expect(node).toHaveAttribute('translate', 'no')
    }
    expect(reported.length).toBeGreaterThan(20)

    unmount()
  })
})
