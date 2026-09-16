import { randomUUID } from 'node:crypto'
import { expect, test, type Locator } from '@playwright/test'

import { runSimulator } from '../src/simulator.js'

const TAX = 'shop-platform.orders.domain.tax'

async function motionStyle(target: Locator) {
  return target.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      animation: style.animationName,
      duration: style.animationDuration,
      transition: style.transitionDuration,
      properties: style.transitionProperty,
    }
  })
}

async function expectStatic(target: Locator) {
  const style = await motionStyle(target)
  expect(style.animation).toBe('none')
  expect(style.transition.split(',').every((duration) => Number.parseFloat(duration) === 0)).toBe(true)
  expect(await target.evaluate((element) => element.getAnimations().length)).toBe(0)
}

test('reduced motion stops the connection spinner and real tooltip portal while preserving status and keyboard use', async ({ page }, testInfo) => {
  const project = `reduced-motion-${randomUUID().slice(0, 8)}`
  const run = 'run-reduced-motion'
  const seeded = await runSimulator({ scenario: 'full', projectId: project, runId: run, speed: 0, finish: false })
  expect(seeded.created).toBe(seeded.eventsSent)
  expect(seeded.conflicts).toBe(0)
  const streamPath = `/api/v1/projects/${project}/stream`
  const streamMatcher = (url: URL) => url.pathname === streamPath
  await page.setViewportSize({ width: 1280, height: 720 })
  for (const language of ['de', 'en'] as const) {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    let rejectedStreams = 0
    let releaseRetries: () => void = () => undefined
    const retryGate = new Promise<void>((resolve) => { releaseRetries = resolve })
    // Only the actual EventSource transport receives the deliberate 503. No
    // REST response or application connection state is replaced by a fixture.
    await page.route(streamMatcher, async (route) => {
      rejectedStreams += 1
      // One real 503 starts reconnection. Hold later failure responses while
      // checking its spinner, so a slow CI host cannot race the retry policy's
      // legitimate offline state (which uses a different, static icon).
      if (rejectedStreams > 1) await retryGate
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporary SSE failure for reduced-motion acceptance' })
    })
    try {
      await page.goto(`/projects/${project}/runs/${run}?component=${TAX}`)
      await page.getByTestId(`language-option-${language}`).click()
      const badge = page.getByTestId('live-connection-state')
      await expect(badge).toHaveAttribute('data-state', 'reconnecting')
      expect(rejectedStreams).toBeGreaterThan(0)
      const icon = badge.locator('svg')
      await expect(icon).toBeVisible()
      await expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect((await motionStyle(icon)).animation).toBe('spin')
      expect(await icon.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0)
      const label = await badge.innerText()
      expect(label).toMatch(language === 'de' ? /Verbindung:/ : /Connection:/)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expectStatic(icon)
      await expect(badge).toHaveText(label)
      await expect(icon).toBeVisible()
      // Changing the OS preference again restores the existing presentation.
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      expect((await motionStyle(icon)).animation).toBe('spin')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expectStatic(icon)
      const projects = page.getByRole('banner').getByRole('link', { name: language === 'de' ? 'Projekte' : 'Projects', exact: true })
      await projects.focus()
      await page.keyboard.press('Tab')
      await expect(badge).toBeFocused()
      await expect(badge).toHaveAttribute('aria-describedby', /\S+/)
      const tooltipId = await badge.getAttribute('aria-describedby')
      const tooltip = page.locator(`[role="tooltip"][id="${tooltipId}"]`)
      const portal = tooltip
      await expect(portal).toHaveAttribute('data-slot', 'tooltip-content')
      await expect(portal).toBeVisible()
      await expectStatic(portal)
      await expect(tooltip).toContainText(language === 'de' ? 'Die angezeigten Daten bleiben erhalten.' : 'The data on screen is kept.')
      expect(await portal.evaluate((element) => !document.querySelector('main')?.contains(element))).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`reduced-motion-connection-${language}.png`) })
      await page.keyboard.press('Escape')
      await expect(tooltip).toHaveCount(0)
      await expect(badge).toBeFocused()
      const languageButton = page.getByTestId(`language-option-${language}`)
      const reducedButton = await motionStyle(languageButton)
      expect(reducedButton.properties.split(',').map((property) => property.trim()).sort()).toEqual(['background-color', 'border-color', 'box-shadow', 'color'])
      expect(reducedButton.transition.split(',').every((duration) => Number.parseFloat(duration) === 0)).toBe(true)
      const rest = await page.request.get(`/api/v1/projects/${project}/runs/${run}`)
      expect(rest.status()).toBe(200)
      await expect(page.getByTestId('inspector-context')).toHaveAttribute('data-component-id', TAX)
      await expect(page.getByTestId('unified-diff')).toHaveCount(3)
    } finally {
      releaseRetries()
      await page.unrouteAll({ behavior: 'wait' })
    }
    await expect(page.getByTestId('live-connection-state')).toHaveAttribute('data-state', 'live')
    await expect(page.getByTestId('live-connection-state').locator('svg')).toBeVisible()
    await expect(page.getByTestId('live-connection-announcement')).toContainText(language === 'de'
      ? 'Die Live-Verbindung ist hergestellt.' : 'The live connection is established.')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect((await motionStyle(page.getByTestId(`language-option-${language}`))).transition.split(',').some((duration) => Number.parseFloat(duration) > 0)).toBe(true)
    // Open the same real portal with ordinary motion to prove it is animated
    // normally, rather than passing because no animated element was rendered.
    await page.getByRole('banner').getByRole('link', { name: language === 'de' ? 'Projekte' : 'Projects', exact: true }).focus()
    await page.keyboard.press('Tab')
    const restoredBadge = page.getByTestId('live-connection-state')
    await expect(restoredBadge).toBeFocused()
    await expect(restoredBadge).toHaveAttribute('aria-describedby', /\S+/)
    const restoredTooltipId = await restoredBadge.getAttribute('aria-describedby')
    const portal = page.locator(`[role="tooltip"][id="${restoredTooltipId}"][data-slot="tooltip-content"]`)
    await expect(portal).toBeVisible()
    expect((await motionStyle(portal)).animation).not.toBe('none')
    await page.keyboard.press('Escape')
  }
})

test('real pending REST responses keep readable loading status without pulsing skeletons under reduced motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  for (const language of ['de', 'en'] as const) {
    let releaseResponse: () => void = () => undefined
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve })
    let actualStatus: number | undefined
    const projectsMatcher = (url: URL) => url.pathname === '/api/v1/projects'
    await page.route(projectsMatcher, async (route) => {
      const response = await route.fetch()
      actualStatus = response.status()
      // Delay a genuine API response; its status, headers and body are retained.
      await responseGate
      await route.fulfill({ response })
    })
    try {
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.goto('/projects')
      await page.getByTestId(`language-option-${language}`).click()
      const loading = page.getByRole('status')
      await expect(loading).toHaveAttribute('aria-busy', 'true')
      await expect(loading).toContainText(language === 'de' ? 'Daten werden geladen' : 'Loading')
      const skeletons = loading.locator('[data-slot="skeleton"]')
      await expect(skeletons).toHaveCount(4)
      expect((await motionStyle(skeletons.first())).animation).toBe('pulse')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      for (const skeleton of await skeletons.all()) {
        await expect(skeleton).toBeVisible()
        await expectStatic(skeleton)
      }
      await expect(loading).toContainText(language === 'de' ? 'Daten werden geladen' : 'Loading')
      await expect(page.getByTestId(`language-option-${language}`)).toBeFocused()
      await page.screenshot({ path: testInfo.outputPath(`reduced-motion-loading-${language}.png`) })
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      expect((await motionStyle(skeletons.first())).animation).toBe('pulse')
      await expect.poll(() => actualStatus).toBe(200)
    } finally {
      releaseResponse()
      // Wait for held handlers to finish fulfilling before the next navigation.
      await page.unrouteAll({ behavior: 'wait' })
    }
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
    await expect(page.getByRole('main').getByRole('link').first()).toBeVisible()
  }
})
