import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest, type ClientRequest, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { postEvent } from '../src/api.js'
import { BASE_URL } from '../src/config.js'
import { runSimulator } from '../src/simulator.js'

const TAX = 'shop-platform.orders.domain.tax'

/** Real transport interruption, isolated from REST and every other test. */
async function createStreamFaultProxy() {
  const upstreamBase = new URL(BASE_URL)
  const request = upstreamBase.protocol === 'https:' ? httpsRequest : httpRequest
  const pending = new Set<ClientRequest>()
  const streams = new Set<ServerResponse>()
  let blocked = false
  let rejectedStreams = 0
  const server = createServer((incoming, outgoing) => {
    const url = new URL(incoming.url ?? '/', upstreamBase)
    const isStream = /^\/api\/v1\/projects\/[^/]+\/stream$/.test(url.pathname)
    if (isStream && blocked) {
      rejectedStreams += 1
      outgoing.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      outgoing.end('SSE temporarily unavailable for this acceptance test')
      return
    }
    const upstream = request(url, {
      method: incoming.method,
      headers: { ...incoming.headers, host: upstreamBase.host },
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers)
      outgoing.flushHeaders()
      response.on('error', () => outgoing.destroy())
      response.pipe(outgoing)
    })
    pending.add(upstream)
    if (isStream) streams.add(outgoing)
    outgoing.on('close', () => {
      pending.delete(upstream)
      streams.delete(outgoing)
      upstream.destroy()
    })
    upstream.on('error', () => {
      if (outgoing.destroyed) return
      if (!outgoing.headersSent) outgoing.writeHead(502)
      outgoing.end()
    })
    incoming.on('error', () => upstream.destroy())
    incoming.pipe(upstream)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Proxy has no TCP address')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    interrupt() {
      blocked = true
      for (const response of streams) response.destroy()
    },
    restore() { blocked = false },
    rejected: () => rejectedStreams,
    async close() {
      for (const upstream of pending) upstream.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}

async function sameExplanationOnFocusAndHover(page: Page, badge: Locator, language: 'de' | 'en', hint: string) {
  const projects = page.getByRole('banner').getByRole('link', { name: language === 'de' ? 'Projekte' : 'Projects', exact: true })
  await projects.focus()
  await page.keyboard.press('Tab')
  await expect(badge).toBeFocused()
  await expect(badge).toHaveAttribute('aria-describedby', /\S+/)
  const tooltipId = await badge.getAttribute('aria-describedby')
  const tooltip = page.locator(`[role="tooltip"][id="${tooltipId}"]`)
  await expect(tooltip).toContainText(hint)
  const keyboardText = await tooltip.innerText()
  await badge.press('Escape')
  await expect(tooltip).toHaveCount(0)
  await projects.focus()
  await badge.hover()
  await expect(tooltip).toHaveText(keyboardText, { useInnerText: true })
  await page.mouse.move(0, 0)
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
}

test('connection transitions are announced once while focus, evidence and REST survive an SSE outage', async ({ page }, testInfo) => {
  const project = `connection-status-${randomUUID().slice(0, 8)}`
  const run = 'run-connection-status'
  const seeded = await runSimulator({ scenario: 'full', projectId: project, runId: run, speed: 0, finish: false })
  expect(seeded.created).toBe(seeded.eventsSent)
  expect(seeded.conflicts).toBe(0)
  const proxy = await createStreamFaultProxy()
  await page.setViewportSize({ width: 1280, height: 720 })
  try {
    for (const language of ['de', 'en'] as const) {
      await page.goto(`${proxy.origin}/projects/${project}/runs/${run}?component=${TAX}`)
      await page.getByTestId(`language-option-${language}`).click()
      const badge = page.getByTestId('live-connection-state')
      await expect(badge).toHaveAttribute('data-state', 'live')
      await expect(badge).toHaveAttribute('tabindex', '0', { timeout: 3_000 })
      const announcement = page.getByTestId('live-connection-announcement')
      await expect(announcement).toHaveAttribute('role', 'status')
      await expect(announcement).toHaveAttribute('aria-live', 'polite')
      await expect(announcement).toHaveAttribute('aria-atomic', 'false')
      const liveHint = language === 'de'
        ? 'Die Live-Verbindung ist hergestellt. Ereignisse treffen in Echtzeit ein.'
        : 'The live connection is established. Events arrive in real time.'
      const interruptedHint = language === 'de'
        ? 'Die Live-Verbindung ist unterbrochen und wird ab der zuletzt gesehenen Position fortgesetzt. Die angezeigten Daten bleiben erhalten.'
        : 'The live connection is interrupted and will resume from the last position seen. The data on screen is kept.'
      const offlineHint = language === 'de'
        ? 'Keine Live-Verbindung. Angezeigt wird der zuletzt geladene Stand — er wird nicht mehr aktualisiert.'
        : 'No live connection. What is shown is the last state loaded — it is no longer being updated.'
      await expect(announcement).toHaveText(liveHint)
      await sameExplanationOnFocusAndHover(page, badge, language, liveHint)
      const focusAnchor = page.getByTestId(`language-option-${language}`)
      await focusAnchor.focus()
      const originalUrl = page.url()
      await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
      const nodesBefore = await page.locator('.react-flow__node').count()
      expect(nodesBefore).toBeGreaterThan(10)
      const observer = await announcement.evaluateHandle((element) => {
        const records: string[] = []
        const observer = new MutationObserver(() => records.push(element.textContent ?? ''))
        observer.observe(element, { childList: true, characterData: true, subtree: true })
        return { element, records, observer }
      })
      const publishStatus = async (index: number) => {
        const note = `Accepted connection evidence ${language}-${index}`
        const accepted = await postEvent({
          schemaVersion: '1.0', clientEventId: randomUUID(), projectId: project, runId: run,
          agentId: 'orchestrator-root', parentAgentId: null, occurredAt: new Date().toISOString(),
          type: 'agent.status_reported', payload: { status: 'idle', note },
        })
        expect(accepted.status, JSON.stringify(accepted.body)).toBe(201)
        await expect(page.getByTestId('agent-status-note-orchestrator-root')).toHaveText(note)
        await expect(focusAnchor).toBeFocused()
      }
      try {
        for (let index = 0; index < 3; index += 1) await publishStatus(index)
        expect(await observer.evaluate((observation) => observation.records)).toEqual([])
        const rejectedBefore = proxy.rejected()
        proxy.interrupt()
        await expect(badge).toHaveAttribute('data-state', 'reconnecting')
        await expect(announcement).toHaveText(interruptedHint)
        await expect(focusAnchor).toBeFocused()
        await expect.poll(proxy.rejected).toBeGreaterThan(rejectedBefore)
        await page.screenshot({ path: testInfo.outputPath(`connection-interrupted-${language}.png`) })
        // Keep the outage until the real retry policy reaches its stable offline
        // state. Tooltip checks cannot race a legitimate reconnecting→offline
        // transition on a slow runner; repeated failed retries stay silent.
        await expect(badge).toHaveAttribute('data-state', 'offline', { timeout: 45_000 })
        await expect(announcement).toHaveText(offlineHint)
        await expect(focusAnchor).toBeFocused()
        expect(await observer.evaluate((observation) => observation.records)).toEqual([interruptedHint, offlineHint])
        // The fault affects only SSE: the browser can still read the real REST
        // projection while its already loaded architecture stays rendered.
        const restStatus = await page.evaluate(async (path) => (await fetch(path)).status,
          `/api/v1/projects/${project}/runs/${run}`)
        expect(restStatus).toBe(200)
        await expect(page.locator('.react-flow__node')).toHaveCount(nodesBefore)
        await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
        await expect(page.getByTestId('unified-diff')).toHaveCount(3)
        await sameExplanationOnFocusAndHover(page, badge, language, offlineHint)
        await focusAnchor.focus()
        await page.screenshot({ path: testInfo.outputPath(`connection-offline-${language}.png`) })

        proxy.restore()
        await expect(badge).toHaveAttribute('data-state', 'live')
        await expect(announcement).toHaveText(liveHint)
        await expect(focusAnchor).toBeFocused()
        for (let index = 3; index < 6; index += 1) await publishStatus(index)
        expect(await observer.evaluate((observation) => observation.records)).toEqual([interruptedHint, offlineHint, liveHint])
        expect(await observer.evaluate((observation) => observation.element.isConnected)).toBe(true)
        await expect(page.locator('.react-flow__node')).toHaveCount(nodesBefore)
        await expect(page).toHaveURL(originalUrl)
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
        await page.screenshot({ path: testInfo.outputPath(`connection-restored-${language}.png`) })
      } finally {
        await observer.evaluate((observation) => observation.observer.disconnect())
        await observer.dispose()
        proxy.restore()
      }
    }
  } finally {
    await page.goto('about:blank')
    await proxy.close()
  }
})
