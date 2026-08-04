import { expect, test } from '@playwright/test'

import { MAIN_PROJECT, MAIN_RUN } from '../src/config.js'

/**
 * Mandatory check 5 — a component click answers with the responsible agent, its
 * assigned task, the markdown feedback and the unified diffs grouped by change.
 *
 * Two properties beyond "the data is there":
 *
 * * **Grouping is by `changeId`.** The three files of the extraction were three
 *   `diff.reported` events; the inspector has to present them as one act of
 *   work, and a diff the agent reported without a `changeId` must stay its own
 *   entry rather than being folded into a neighbouring change.
 * * **The rendered feedback contains no active element.** Feedback bodies are
 *   untrusted agent output (ADR 0012). The check asks the DOM what it actually
 *   produced — anything focusable, anything that executes or loads, anything
 *   with an inline event handler.
 */

const TAX = 'shop-platform.orders.domain.tax'
const NOTIFICATIONS = 'shop-platform.notifications'
const EXTRACTION_CHANGE = 'change-2026-08-04-0007'

test('5 · clicking a component shows its agent, task, markdown feedback and grouped diffs', async ({
  page,
}) => {
  await page.goto(`/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}`)
  await expect(page.getByTestId('architecture-canvas')).toBeVisible()

  // Nothing is selected yet, and the inspector says so rather than guessing.
  await expect(page.getByTestId('pane-inspector')).toContainText(
    'Keine Komponente ausgewählt',
  )

  await page.getByTestId(`canvas-node-${TAX}`).click()

  // The selection is a URL change, so the view is linkable and a live event
  // cannot move it.
  await expect(page).toHaveURL(new RegExp(`component=${encodeURIComponent(TAX)}`))
  await expect(page.getByTestId(`canvas-node-${TAX}`)).toHaveAttribute(
    'data-selected',
    'true',
  )

  // ---- agent and task -----------------------------------------------------
  const context = page.getByTestId('inspector-context')
  await expect(context).toBeVisible()
  await expect(context).toHaveAttribute('data-component-id', TAX)
  await expect(context).toHaveAttribute('data-run-id', MAIN_RUN)
  // Read from evidence, not guessed: the agent of the latest work step that
  // named this component.
  await expect(context).toHaveAttribute('data-agent-id', 'subagent-test-engineer')
  await expect(page.getByTestId('responsible-agent')).toContainText('Test Engineer')
  await expect(page.getByTestId('agent-assigned-task')).toContainText(
    'Cover the new tax module with table tests.',
  )
  await expect(page.getByTestId('agent-status')).toBeVisible()
  await expect(page.getByTestId('current-work-step')).toContainText(
    'Cover tax.Rate.Apply with a table test',
  )

  // ---- markdown feedback --------------------------------------------------
  const feedback = page.getByTestId('feedback-entries')
  await expect(feedback).toBeVisible()
  await expect(page.getByTestId('feedback-entry')).toHaveCount(1)
  await expect(page.getByTestId('feedback-entry')).toHaveAttribute(
    'data-feedback-id',
    'feedback-2026-08-04-0001',
  )

  const markdown = page.getByTestId('safe-markdown').first()
  await expect(markdown).toBeVisible()
  // Rendered markdown, not an escaped string: headings, a list and a code block.
  await expect(markdown.locator('h4, h3, h5')).not.toHaveCount(0)
  await expect(markdown.locator('ol li')).not.toHaveCount(0)
  await expect(markdown.locator('pre code')).not.toHaveCount(0)
  await expect(markdown).toContainText('The order of operations changed.')

  // ---- grouped unified diffs ---------------------------------------------
  const groups = page.getByTestId('diff-groups')
  await expect(groups).toBeVisible()
  await expect(page.getByTestId('diff-group')).toHaveCount(1)

  const extraction = page.locator(`[data-testid="diff-group"][data-change-id="${EXTRACTION_CHANGE}"]`)
  await expect(
    extraction,
    'the three files of one change must be one group, not three entries',
  ).toHaveCount(1)
  await expect(extraction).toHaveAttribute('data-file-count', '3')
  await expect(extraction).toHaveAttribute('data-agent-id', 'subagent-implementer')
  await expect(extraction).toHaveAttribute('data-run-id', MAIN_RUN)
  await expect(extraction.getByTestId('unified-diff')).toHaveCount(3)

  const filePaths = await extraction
    .locator('[data-file-path]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-file-path') ?? ''))
  expect(filePaths.sort()).toEqual([
    'internal/orders/domain/pricing/pricing.go',
    'internal/orders/domain/tax/tax.go',
    'internal/orders/domain/tax/tax_test.go',
  ])

  // Unified diff lines are classified, so additions and removals are readable
  // without relying on colour.
  await expect(extraction.locator('[data-line-kind="addition"]').first()).toBeVisible()
  await expect(extraction.locator('[data-line-kind="removal"]').first()).toBeAttached()
})

test('5 · a diff reported without a changeId stays its own entry', async ({ page }) => {
  await page.goto(
    `/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}?component=${encodeURIComponent(NOTIFICATIONS)}`,
  )
  await expect(page.getByTestId('inspector-current-run')).toBeVisible()

  const group = page.getByTestId('diff-group')
  await expect(group).toHaveCount(1)
  await expect(group).toHaveAttribute('data-change-id', '')
  await expect(group).toHaveAttribute('data-file-count', '1')
  await expect(group).toContainText('Ohne')
  await expect(group.locator('[data-file-path]')).toHaveAttribute(
    'data-file-path',
    'internal/notifications/consumer.go',
  )
})

test('5 · the rendered feedback contains no active element', async ({ page }) => {
  await page.goto(
    `/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}?component=${encodeURIComponent(TAX)}`,
  )
  await expect(page.getByTestId('safe-markdown').first()).toBeVisible()

  const audit = await page.evaluate(() => {
    const EXECUTABLE = [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'style',
      'link',
      'meta',
      'base',
      'noscript',
      'template',
      'svg',
      'math',
      'applet',
      'frame',
      'frameset',
    ]
    const FOCUSABLE_TAGS = [
      'a',
      'button',
      'select',
      'textarea',
      'input',
      'details',
      'summary',
      'audio',
      'video',
    ]

    const describe = (element: Element): string =>
      `${element.tagName.toLowerCase()}${element.outerHTML.slice(0, 120)}`

    const executable: string[] = []
    const focusable: string[] = []
    const handlers: string[] = []
    let roots = 0
    let elements = 0

    for (const root of Array.from(document.querySelectorAll('[data-testid="safe-markdown"]'))) {
      roots += 1
      for (const element of Array.from(root.querySelectorAll('*'))) {
        elements += 1
        const tag = element.tagName.toLowerCase()
        if (EXECUTABLE.includes(tag)) executable.push(describe(element))

        for (const attribute of Array.from(element.attributes)) {
          if (attribute.name.toLowerCase().startsWith('on')) handlers.push(describe(element))
        }

        const tabIndex = element.getAttribute('tabindex')
        if (tabIndex !== null && Number(tabIndex) >= 0) focusable.push(describe(element))
        if ((element as HTMLElement).isContentEditable) focusable.push(describe(element))
        if (tag === 'a' && element.hasAttribute('href')) focusable.push(describe(element))
        if (FOCUSABLE_TAGS.includes(tag) && tag !== 'a' && !element.hasAttribute('disabled')) {
          focusable.push(describe(element))
        }
      }
    }

    return { roots, elements, executable, focusable, handlers }
  })

  // Guard against a vacuous pass: there has to be rendered markdown to audit.
  expect(audit.roots).toBeGreaterThan(0)
  expect(audit.elements).toBeGreaterThan(10)

  expect(audit.executable, 'executable or resource-loading element in feedback').toEqual([])
  expect(audit.focusable, 'focusable element in rendered feedback').toEqual([])
  expect(audit.handlers, 'inline event handler in rendered feedback').toEqual([])
})
