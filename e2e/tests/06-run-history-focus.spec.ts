import { expect, test } from '@playwright/test'

import {
  MAIN_BOOTSTRAP_AGENT,
  MAIN_BOOTSTRAP_RUN,
  MAIN_PROJECT,
  MAIN_RUN,
} from '../src/config.js'

/**
 * Mandatory check 6 — the current run and the history stay apart, and deep focus
 * enlarges the reading area **without** losing the architecture context.
 *
 * Three separations, each asserted where it could actually break:
 *
 * * The inspector's history is a different endpoint behind a different tab, not
 *   a filter over the current run's evidence (ADR 0005). A diff from another run
 *   must never sit in the same list as one from the run being watched.
 * * A historical run is a different URL. The pane announces it before anything
 *   else and carries the way back; no agent of the current run may appear.
 * * Deep focus is a layout change, not a modal. `DEEP_FOCUS_PANE_LAYOUT` keeps
 *   ~41 % of the width on the canvas, so both widths are measured rather than
 *   only the one that grew.
 */

const TAX = 'shop-platform.orders.domain.tax'

test('6 · the history is its own tab and never mixes into the current run', async ({
  page,
}) => {
  await page.goto(
    `/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}?component=${encodeURIComponent(TAX)}`,
  )

  const currentTab = page.getByRole('tab', { name: 'Aktueller Run' })
  const historyTab = page.getByRole('tab', { name: 'Historie' })
  await expect(currentTab).toHaveAttribute('aria-selected', 'true')
  await expect(historyTab).toHaveAttribute('aria-selected', 'false')

  await expect(page.getByTestId('inspector-current-run')).toBeVisible()
  await expect(page.getByTestId('diff-groups')).toBeVisible()
  await expect(page.getByTestId('inspector-history')).toHaveCount(0)

  await historyTab.click()
  await expect(historyTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('inspector-history')).toBeVisible()

  // The current run's evidence is gone from the pane, not merely pushed down.
  await expect(page.getByTestId('inspector-current-run')).toHaveCount(0)
  await expect(page.getByTestId('diff-groups')).toHaveCount(0)
  await expect(page.getByTestId('feedback-entries')).toHaveCount(0)
  await expect(page.getByTestId('inspector-risks')).toHaveCount(0)

  const historyEntries = page.getByTestId('history-entry')
  await expect(historyEntries.first()).toBeVisible()
  // Every historical entry names the run it belongs to, so nothing is anonymous.
  const runIds = await historyEntries.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-run-id') ?? ''),
  )
  expect(runIds.length).toBeGreaterThan(0)
  expect(runIds.every((runId) => runId !== '')).toBe(true)

  await currentTab.click()
  await expect(page.getByTestId('inspector-current-run')).toBeVisible()
  await expect(page.getByTestId('inspector-history')).toHaveCount(0)
})

test('6 · a historical run is a different URL and never overlays the current one', async ({
  page,
}) => {
  await page.goto(`/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}`)
  await expect(page.getByTestId('current-run-banner')).toBeVisible()
  await expect(page.getByTestId('historical-run-banner')).toHaveCount(0)
  await expect(page.getByTestId('agent-row-orchestrator-root')).toBeVisible()

  await page.getByTestId(`run-option-${MAIN_BOOTSTRAP_RUN}`).click()
  await expect(page).toHaveURL(new RegExp(`runs/${MAIN_BOOTSTRAP_RUN}`))

  const banner = page.getByTestId('historical-run-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(MAIN_RUN)
  await expect(page.getByTestId('current-run-banner')).toHaveCount(0)

  // Nothing merges: only the historical run's own agent is shown.
  await expect(page.getByTestId(`agent-row-${MAIN_BOOTSTRAP_AGENT}`)).toBeVisible()
  await expect(page.getByTestId('agent-row-orchestrator-root')).toHaveCount(0)
  await expect(page.locator('[data-testid^="agent-row-"]')).toHaveCount(1)
  await expect(page.getByTestId('pane-run-agents')).toHaveAttribute(
    'data-run-id',
    MAIN_BOOTSTRAP_RUN,
  )

  await page.getByTestId('back-to-current-run').click()
  await expect(page).toHaveURL(new RegExp(`runs/${MAIN_RUN}`))
  await expect(page.getByTestId('current-run-banner')).toBeVisible()
  await expect(page.getByTestId('agent-row-orchestrator-root')).toBeVisible()
})

test('6 · deep focus enlarges the inspector while the architecture stays on screen', async ({
  page,
}) => {
  await page.goto(
    `/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}?component=${encodeURIComponent(TAX)}`,
  )
  await expect(page.getByTestId('diff-groups')).toBeVisible()
  await expect(page.getByTestId(`canvas-node-${TAX}`)).toBeVisible()

  const architecture = page.getByTestId('pane-architecture')
  const inspector = page.getByTestId('pane-inspector')

  const before = {
    architecture: (await architecture.boundingBox())?.width ?? 0,
    inspector: (await inspector.boundingBox())?.width ?? 0,
  }
  expect(before.architecture).toBeGreaterThan(0)
  expect(before.inspector).toBeGreaterThan(0)

  await page
    .getByTestId('inspector-diffs')
    .getByRole('button', { name: 'Deep Focus' })
    .click()

  await expect(page.getByTestId('deep-focus-banner')).toBeVisible()
  await expect(page).toHaveURL(/focus=diffs/)
  // The other sections give way so the enlarged pane is spent on what is read.
  await expect(page.getByTestId('inspector-feedback')).toHaveCount(0)
  await expect(page.getByTestId('inspector-risks')).toHaveCount(0)
  await expect(page.getByTestId('diff-groups')).toBeVisible()

  const after = {
    architecture: (await architecture.boundingBox())?.width ?? 0,
    inspector: (await inspector.boundingBox())?.width ?? 0,
  }

  expect(
    after.inspector,
    'deep focus must enlarge the reading area',
  ).toBeGreaterThan(before.inspector)
  expect(
    after.architecture,
    'the architecture context must stay visible in deep focus',
  ).toBeGreaterThan(600)
  await expect(page.getByTestId('architecture-canvas')).toBeVisible()
  await expect(page.getByTestId(`canvas-node-${TAX}`)).toBeVisible()

  // The run pane folded into its rail rather than disappearing without a way back.
  await expect(page.getByTestId('pane-rail-left')).toBeVisible()

  // Escape leaves the mode: an enlarging layout must never trap.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('deep-focus-banner')).toHaveCount(0)
  await expect(page.getByTestId('inspector-feedback')).toBeVisible()

  const restored = {
    architecture: (await architecture.boundingBox())?.width ?? 0,
    inspector: (await inspector.boundingBox())?.width ?? 0,
  }
  expect(Math.abs(restored.architecture - before.architecture)).toBeLessThan(4)
  expect(Math.abs(restored.inspector - before.inspector)).toBeLessThan(4)
})
