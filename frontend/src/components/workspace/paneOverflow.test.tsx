import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PROJECT_ID, RUN_ID, createFakeFetch } from '@/test/fixtures'
import { COMPONENT_ID, INSPECTOR_PATH, inspectorPage } from '@/test/inspectorFixtures'
import { renderApp } from '@/test/renderApp'

/**
 * Where horizontal overflow is allowed to happen (issue #41).
 *
 * The rule of the cockpit is that **the page never scrolls sideways** and wide
 * content scrolls inside the container that owns it. jsdom applies no
 * stylesheet, so these tests assert the containment *declarations* — which is
 * what a refactor deletes by accident. That the declarations add up to a page
 * without a scrollbar is measured in a real browser by
 * `e2e/tests/08-viewport.spec.ts`.
 */

const WORKSPACE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}?component=${COMPONENT_ID}`

function renderWorkspace() {
  return renderApp(WORKSPACE_URL, {
    fetchImpl: createFakeFetch({ [INSPECTOR_PATH]: inspectorPage() }),
  })
}

describe('horizontal overflow containment', () => {
  it('lets the inspector scroll vertically and never sideways', async () => {
    renderWorkspace()

    const scroll = await screen.findByTestId('inspector-scroll')
    expect(scroll.className).toContain('overflow-y-auto')
    expect(scroll.className).toContain('overflow-x-hidden')
  })

  it('scrolls a unified diff inside its own box', async () => {
    renderWorkspace()

    const diffs = await screen.findAllByTestId('unified-diff')
    expect(diffs.length).toBeGreaterThan(0)

    for (const diff of diffs) {
      // The figure clips, so a long line can never widen the inspector …
      expect(diff.className).toContain('overflow-hidden')
      // … and the box holding the table is what scrolls instead.
      const scroller = diff.querySelector('div.overflow-auto')
      expect(scroller).not.toBeNull()
      // Diff lines are kept verbatim, which is why the box has to scroll.
      expect(within(diff).getAllByRole('row').length).toBeGreaterThan(0)
    }
  })

  it('keeps the architecture surface clipping its own canvas', async () => {
    renderWorkspace()

    const canvas = await screen.findByTestId('architecture-canvas')
    const region = canvas.parentElement
    expect(region).not.toBeNull()
    expect(region!.className).toContain('overflow-hidden')
    expect(region!.className).toContain('min-w-0')
  })

  it('makes the run pane wrap to the pane instead of growing past it', async () => {
    renderWorkspace()

    await screen.findByTestId('pane-run-agents')
    const viewport = document.querySelector('[data-slot="scroll-area-viewport"]')
    expect(viewport).not.toBeNull()
    // Radix sizes the viewport's content wrapper as a table, which lets it grow
    // to its own min-content width — wider than the pane, and clipped away
    // because the viewport has no horizontal scrollbar. Forcing a block box is
    // what makes the content wrap to the pane instead (issue #41).
    expect(viewport!.className).toContain('[&>div]:!block')
    expect(viewport!.firstElementChild).not.toBeNull()
  })

  it('gives every pane a zero minimum content width, so a wide child cannot push it', async () => {
    renderWorkspace()

    await screen.findByTestId('pane-run-agents')
    for (const pane of ['pane-run-agents', 'pane-architecture', 'pane-inspector']) {
      // `.pane-surface` carries `min-w-0`; without it a flex child refuses to
      // shrink below its content and the whole row grows past the window.
      expect(screen.getByTestId(pane).className).toContain('pane-surface')
    }
  })
})
