import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MISSING_KEY_PREFIX } from '@/i18n/createI18n'
import { createPseudoI18n } from '@/test/pseudoLocale'
import { renderWorkspaceScene } from '@/test/workspaceScene'

/**
 * The whole cockpit rendered in a translation 35 % longer than German.
 *
 * Two different questions are asked about long translations, and only one of
 * them can be answered here:
 *
 * * **Does anything get cut off?** That is a pixel question, and jsdom has no
 *   layout engine. It is answered in the acceptance run
 *   (`e2e/tests/09-i18n-layout.spec.ts`) at 1280, 1440 and 1920.
 * * **Does anything get lost?** That is a DOM question, and it is the one this
 *   file answers: the same panes, the same controls, the same reported values,
 *   with every one of the cockpit's own words longer. A pane that silently
 *   stops rendering its legend because the text no longer fits its `Record`,
 *   an `aria-label` that falls back to German, a proposal counter that
 *   disappears — all of that is visible without a layout engine, and all of it
 *   would otherwise only be found by whoever ships the next language.
 */

/** Everything the cockpit marks as structure, in document order. */
function structureOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-testid]')]
    .map((node) => node.getAttribute('data-testid') ?? '')
    .filter((id) => !/^_r_/.test(id))
}

function reportedOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-reported]')].map(
    (node) => node.textContent ?? '',
  )
}

describe('a translation 35 per cent longer than German', () => {
  it('renders every pane, tab and legend the German rendering renders', async () => {
    const german = await renderWorkspaceScene({ language: 'de' })
    const germanStructure = structureOf(german.container)
    german.unmount()

    const pseudo = await renderWorkspaceScene({ i18n: createPseudoI18n() })
    const pseudoStructure = structureOf(pseudo.container)

    // Not "roughly as much": the same elements, in the same order. A longer
    // word may change where a line breaks; it may not change what exists.
    expect(pseudoStructure).toEqual(germanStructure)
    expect(germanStructure.length).toBeGreaterThan(40)

    pseudo.unmount()
  })

  it('shows every text in full rather than falling back or truncating in the DOM', async () => {
    const i18n = createPseudoI18n()
    const { container, unmount } = await renderWorkspaceScene({ i18n })

    // The pane titles, both legend headings and the run state — the elements
    // the acceptance criteria of #37 name one by one. Each has to be on screen
    // with its **whole** lengthened text, not with a prefix of it.
    for (const key of [
      'agents:pane.title',
      'canvas:pane.title',
      'canvas:legend.workStateTitle',
      'canvas:legend.relationshipTitle',
      'agents:runState.title',
    ] as const) {
      const text = i18n.t(key)
      expect(text.length, key).toBeGreaterThan(12)
      expect(screen.getAllByText(text, { exact: false }).length, key).toBeGreaterThan(0)
    }

    // …and the accessible names of the two collapsible panes, which carry the
    // same words without ever being visible.
    for (const key of ['workspace:pane.leftLabel', 'workspace:pane.rightLabel'] as const) {
      const name = i18n.t(key)
      expect(container.querySelector(`[aria-label="${name}"]`), key).not.toBeNull()
    }

    // Nothing anywhere resolved to a key: a longer catalogue is still a
    // complete one.
    expect(container.textContent ?? '').not.toContain(MISSING_KEY_PREFIX)

    unmount()
  })

  it('leaves every reported value byte for byte where it was', async () => {
    const german = await renderWorkspaceScene({ language: 'de' })
    const germanReported = reportedOf(german.container)
    german.unmount()

    const english = await renderWorkspaceScene({ language: 'en' })
    const englishReported = reportedOf(english.container)
    english.unmount()

    const pseudo = await renderWorkspaceScene({ i18n: createPseudoI18n() })
    const pseudoReported = reportedOf(pseudo.container)

    // The agent's words do not get longer because ours did. This is the same
    // proof `WorkspacePage.i18n.test.tsx` makes for German against English,
    // extended to a third rendering — which is the point of having one: it is
    // the only rendering in which *every* translated string on screen is
    // different, so a reported value that had accidentally been routed through
    // `t()` could not survive it unchanged.
    expect(pseudoReported).toEqual(germanReported)
    expect(pseudoReported).toEqual(englishReported)
    expect(pseudoReported.length).toBeGreaterThan(20)

    for (const node of pseudo.container.querySelectorAll('[data-reported]')) {
      expect(node).toHaveAttribute('translate', 'no')
    }

    pseudo.unmount()
  })
})
