import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

import { bootstrapEvent, postEvent } from '../src/api.js'

const AGENT = 'status-author'
const NOTE = `agent-status-note-${AGENT}`
const NOTES = [40, 80, 120].map((length) => 'WWW architecture review WWW model WWW status update. '.repeat(3).slice(0, length))

async function setPaneWidth(page: Page, width: number, language: 'de' | 'en') {
  const pane = page.getByTestId('pane-run-agents')
  const separator = page.getByRole('separator', {
    name: language === 'de' ? 'Breite des Run- und Agent-Bereichs' : 'Width of the runs and agents pane',
  })
  const current = await pane.boundingBox()
  const handle = await separator.boundingBox()
  expect(current).not.toBeNull()
  expect(handle).not.toBeNull()
  if (Math.abs(current!.width - width) > 0.5) {
    const x = handle!.x + handle!.width / 2
    const y = handle!.y + handle!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + width - current!.width, y, { steps: 8 })
    await page.mouse.up()
  }
  // CSS or stored percentages alone do not prove a 260px reproduction.
  await expect.poll(async () => Math.abs((await pane.boundingBox())!.width - width)).toBeLessThanOrEqual(1)
}

async function compactGeometry(page: Page, expectedNote: string) {
  const note = page.getByTestId(NOTE)
  await expect(note).toHaveText(expectedNote)
  await note.scrollIntoViewIfNeeded()
  return note.evaluate((element) => {
    const status = element.closest('[data-status]')!
    const group = status.parentElement!
    const role = group.querySelector('[data-slot="badge"]')!
    const statusWord = status.children[1]!
    const box = element.getBoundingClientRect()
    const groupBox = group.getBoundingClientRect()
    return {
      width: box.width, height: box.height, lineHeight: parseFloat(getComputedStyle(element).lineHeight),
      availableWidth: groupBox.width, leftOffset: box.left - groupBox.left,
      belowLabels: box.top >= Math.max(role.getBoundingClientRect().bottom, statusWord.getBoundingClientRect().bottom) - 0.5,
      overflowing: element.scrollHeight > element.clientHeight,
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
    }
  })
}

test('status notes use a full-width compact row and disclose actual overflow at 260px', async ({ page }, testInfo) => {
  const project = `status-overflow-${randomUUID().slice(0, 8)}`
  const run = 'run-status-overflow'
  const opened = await postEvent(bootstrapEvent({
    clientEventId: randomUUID(), projectId: project, runId: run, agentId: AGENT,
    displayName: 'Status author', assignedTask: 'Review the model.',
  }))
  expect(opened.status, JSON.stringify(opened.body)).toBe(201)
  async function report(note: string) {
    const event = await postEvent({
      schemaVersion: '1.0', clientEventId: randomUUID(), projectId: project, runId: run,
      agentId: AGENT, parentAgentId: null, occurredAt: new Date().toISOString(),
      type: 'agent.status_reported', payload: { status: 'idle', note },
    })
    expect(event.status, JSON.stringify(event.body)).toBe(201)
    await expect(page.getByTestId(NOTE)).toHaveText(note)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const language of ['de', 'en'] as const) {
    await page.goto(`/projects/${project}/runs/${run}`)
    await page.getByTestId(`language-option-${language}`).click()
    await expect(page.getByTestId('live-connection-state')).toHaveAttribute('data-state', 'live')
    await expect(page.getByTestId(`agent-detail-toggle-${AGENT}`)).toHaveAttribute('aria-expanded', 'false')
    await setPaneWidth(page, 260, language)
    for (const text of NOTES) {
      await report(text)
      const geometry = await compactGeometry(page, text)
      expect(geometry.belowLabels, 'status note belongs below role and state').toBe(true)
      expect(Math.abs(geometry.width - geometry.availableWidth), JSON.stringify(geometry)).toBeLessThanOrEqual(1)
      expect(Math.abs(geometry.leftOffset), 'note starts at the full content column').toBeLessThanOrEqual(1)
      expect(geometry.height, `${text.length} characters fit the compact one-line budget`).toBeLessThanOrEqual(geometry.lineHeight + 1)
      expect(geometry.overflowing, 'fixture genuinely overflows its rendered line, including below 90 characters').toBe(true)
      const toggle = page.getByTestId(`${NOTE}-toggle`)
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await page.screenshot({ path: testInfo.outputPath(`status-${language}-${text.length}-compact.png`) })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(page.getByTestId(NOTE)).toHaveText(text)
      const expanded = await page.getByTestId(NOTE).evaluate((element) => ({
        height: element.clientHeight, scrollHeight: element.scrollHeight,
        width: element.clientWidth, scrollWidth: element.scrollWidth,
        text: element.textContent,
      }))
      expect(expanded.text).toBe(text)
      expect(expanded.height, 'expanded note paints more than one line').toBeGreaterThan(geometry.height)
      expect(expanded.scrollHeight).toBeLessThanOrEqual(expanded.height)
      expect(expanded.scrollWidth).toBeLessThanOrEqual(expanded.width)
      await page.screenshot({ path: testInfo.outputPath(`status-${language}-${text.length}-expanded.png`) })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect((await compactGeometry(page, text)).height).toBeLessThanOrEqual(geometry.lineHeight + 1)
    }

    await report('Ready.')
    const short = await compactGeometry(page, 'Ready.')
    expect(short.overflowing).toBe(false)
    await expect(page.getByTestId(`${NOTE}-toggle`)).toHaveCount(0)

    // The same 40 bytes need disclosure in a narrow pane but fit after a real
    // separator drag. ResizeObserver must update both directions without reload.
    await report(NOTES[0]!)
    await expect(page.getByTestId(`${NOTE}-toggle`)).toHaveAttribute('aria-expanded', 'false')
    await setPaneWidth(page, 440, language)
    await expect(page.getByTestId(`${NOTE}-toggle`)).toHaveCount(0)
    expect((await compactGeometry(page, NOTES[0]!)).overflowing).toBe(false)
    await setPaneWidth(page, 260, language)
    await expect(page.getByTestId(`${NOTE}-toggle`)).toHaveAttribute('aria-expanded', 'false')
    expect((await compactGeometry(page, NOTES[0]!)).overflowing).toBe(true)
  }
})
