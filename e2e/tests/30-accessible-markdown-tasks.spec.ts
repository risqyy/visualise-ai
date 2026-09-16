import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import axe from 'axe-core'

import { postEvent } from '../src/api.js'
import { runSimulator } from '../src/simulator.js'

const TAX = 'shop-platform.orders.domain.tax'
const TASKS = ['rounding rule documented', 'fallback country decided'] as const

test('reported Markdown tasks expose localized states in list order without becoming controls', async ({ page }, testInfo) => {
  const project = `markdown-tasks-${randomUUID().slice(0, 8)}`
  const run = 'run-markdown-tasks'
  const seeded = await runSimulator({ scenario: 'full', projectId: project, runId: run, speed: 0, finish: false })
  expect(seeded.created).toBe(seeded.eventsSent)
  expect(seeded.conflicts).toBe(0)
  const hostile = await postEvent({
    schemaVersion: '1.0', clientEventId: randomUUID(), projectId: project, runId: run,
    agentId: 'subagent-reviewer', parentAgentId: 'subagent-implementer', occurredAt: new Date().toISOString(),
    type: 'feedback.published', payload: {
      feedbackId: 'feedback-task-safety', componentIds: [TAX], format: 'markdown', title: 'Task rendering safety probe',
      body: [
        '- [x] **Reported safe task** with `inline code`',
        '',
        '<svg onload="window.taskAttackExecuted = true"><text>UNTRUSTED SVG PAYLOAD</text></svg>',
        '<script>window.taskAttackExecuted = true</script>',
        '<span onclick="window.taskAttackExecuted = true" tabindex="0">Safe reported suffix</span>',
      ].join('\n'),
    },
  })
  expect(hostile.status, JSON.stringify(hostile.body)).toBe(201)
  const snapshots: { language: string; list: string; axePasses: string[] }[] = []
  let originalReportedText: string | undefined
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const language of ['de', 'en'] as const) {
    await page.goto(`/projects/${project}/runs/${run}?component=${TAX}`)
    await page.getByTestId(`language-option-${language}`).click()
    await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
    const markdown = page.locator('[data-testid="feedback-entry"][data-feedback-id="feedback-2026-08-04-0001"]')
      .getByTestId('safe-markdown')
    const list = markdown.getByRole('list').filter({ hasText: TASKS[0] })
    const items = list.getByRole('listitem')
    const states = language === 'de' ? ['Erledigt', 'Offen'] as const : ['Completed', 'Open'] as const
    await expect(items).toHaveCount(2)
    await expect(items).toHaveText(TASKS)
    for (const [index, state] of states.entries()) {
      const marker = items.nth(index).getByRole('img', { name: state, exact: true })
      await expect(marker).toHaveCount(1)
      expect(await marker.evaluate((element) => (element as HTMLElement).tabIndex)).toBe(-1)
      await expect(marker.locator('svg')).toHaveAttribute('aria-hidden', 'true')
    }
    // This is a browser accessibility-tree assertion, not a substitute for the
    // separate real screenreader acceptance run. State precedes its task text.
    const listSnapshot = await list.ariaSnapshot()
    expect(listSnapshot).toBe([
      '- list:',
      '  - listitem:',
      `    - img "${states[0]}"`,
      `    - text: ${TASKS[0]}`,
      '  - listitem:',
      `    - img "${states[1]}"`,
      `    - text: ${TASKS[1]}`,
    ].join('\n'))
    await expect(markdown.locator('input, button, select, textarea, [contenteditable="true"], [tabindex]')).toHaveCount(0)
    const reportedText = await markdown.textContent()
    expect(reportedText).not.toBeNull()
    if (originalReportedText === undefined) originalReportedText = reportedText!
    else expect(reportedText).toBe(originalReportedText)
    await expect(markdown).toHaveAttribute('translate', 'no')
    await expect(markdown).toHaveAttribute('data-reported', '')

    await items.first().scrollIntoViewIfNeeded()
    await items.first().getByRole('img').click()
    await page.keyboard.press('Tab')
    expect(await list.evaluate((element) => element.contains(document.activeElement))).toBe(false)
    await expect(items).toHaveText(TASKS)
    expect(await list.ariaSnapshot()).toBe(listSnapshot)
    await list.scrollIntoViewIfNeeded()
    await expect(list).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: testInfo.outputPath(`markdown-tasks-${language}.png`) })

    const safety = page.locator('[data-testid="feedback-entry"][data-feedback-id="feedback-task-safety"]')
      .getByTestId('safe-markdown')
    await expect(safety.getByRole('img', { name: states[0], exact: true })).toHaveCount(1)
    await expect(safety.locator('strong')).toHaveText('Reported safe task')
    await expect(safety.locator('code')).toHaveText('inline code')
    await expect(safety).toContainText('Safe reported suffix')
    await expect(safety).not.toContainText('UNTRUSTED SVG PAYLOAD')
    await expect(safety.locator('script, [onclick], [onload], [tabindex], input')).toHaveCount(0)
    await expect(safety.locator('svg')).toHaveCount(1)
    await expect(safety.getByTestId('reported-task-state').locator('svg')).toHaveCount(1)
    expect(await page.evaluate(() => 'taskAttackExecuted' in window)).toBe(false)

    await page.addScriptTag({ content: axe.source })
    const audit = await page.evaluate(async () => {
      const browserAxe = (window as typeof window & { axe: typeof axe }).axe
      const result = await browserAxe.run('[data-testid="feedback-entries"]', {
        runOnly: { type: 'rule', values: ['label', 'role-img-alt', 'aria-valid-attr', 'aria-valid-attr-value', 'list', 'listitem'] },
      })
      return { violations: result.violations, incomplete: result.incomplete, passes: result.passes.map((rule) => rule.id) }
    })
    expect(audit.violations).toEqual([])
    expect(audit.incomplete).toEqual([])
    // `label` becomes inapplicable because reports contain no form controls;
    // positive image/list checks prevent an empty scan from counting as proof.
    expect(audit.passes).toEqual(expect.arrayContaining(['role-img-alt', 'list', 'listitem']))
    snapshots.push({ language, list: listSnapshot, axePasses: audit.passes })
  }
  await testInfo.attach('markdown-task-accessibility', {
    body: JSON.stringify(snapshots, null, 2), contentType: 'application/json',
  })
})
