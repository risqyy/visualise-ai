import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { getJson, postEvent } from '../src/api.js'
import { runSimulator } from '../src/simulator.js'

interface PlansResponse {
  plans: {
    planId: string
    revisions: {
      revision: number
      isCurrent: boolean
      steps: { stepId: string; title: string; state: string; order: number }[]
    }[]
  }[]
}

/** Visibility inside the pane's real clipping rectangle, without scrolling it. */
async function assertInsideScrollport(target: Locator, scrollport: Locator) {
  await expect(target).toBeInViewport({ ratio: 1 })
  const targetBox = await target.boundingBox()
  const clip = await scrollport.boundingBox()
  expect(targetBox).not.toBeNull()
  expect(clip).not.toBeNull()
  expect(targetBox!.y).toBeGreaterThanOrEqual(clip!.y - 1)
  expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(clip!.y + clip!.height + 1)
  expect(targetBox!.x).toBeGreaterThanOrEqual(clip!.x - 1)
  expect(targetBox!.x + targetBox!.width).toBeLessThanOrEqual(clip!.x + clip!.width + 1)
}

async function assertNavigationAvailable(page: Page) {
  for (const id of ['run-jump-agents', 'run-jump-plans']) {
    const button = page.getByTestId(id)
    await expect(button).toBeInViewport({ ratio: 1 })
    expect(await button.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    }), `${id} remains unobstructed`).toBe(true)
  }
}

test('agents and current plans are one action away while complete run evidence remains reachable', async ({ page }, testInfo) => {
  const project = `work-plan-navigation-${randomUUID().slice(0, 8)}`
  const run = 'run-work-plan-navigation'
  const seeded = await runSimulator({ scenario: 'self', projectId: project, runId: run, speed: 0 })
  expect(seeded.created).toBe(seeded.eventsSent)
  expect(seeded.conflicts).toBe(0)
  // Self deliberately stays open. An explicit report supplies a real end time
  // so the metadata disclosure must preserve both reported timestamps.
  const finish = await postEvent({
    schemaVersion: '1.0', clientEventId: randomUUID(), projectId: project, runId: run,
    agentId: 'orchestrator-v0', parentAgentId: null, occurredAt: new Date().toISOString(),
    type: 'run.finished', payload: { outcome: 'completed', summary: 'Navigation acceptance fixture completed.' },
  })
  expect(finish.status, JSON.stringify(finish.body)).toBe(201)
  const runResponse = await getJson(`/api/v1/projects/${project}/runs/${run}`)
  const plansResponse = await getJson(`/api/v1/projects/${project}/runs/${run}/plans`)
  expect(runResponse.status).toBe(200)
  expect(plansResponse.status).toBe(200)
  const reportedRun = (runResponse.body as {
    run: { startedAt: string; finishedAt: string; rootAgentId: string }
  }).run
  const plans = (plansResponse.body as PlansResponse).plans
  expect(plans).toHaveLength(1)
  const plan = plans[0]!
  expect(plan.revisions).toHaveLength(2)
  const ordered = [...plan.revisions].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.revision - b.revision)
  const current = ordered[0]!
  expect(current.isCurrent).toBe(true)
  expect(current.steps.length).toBeGreaterThan(10)

  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size)
    for (const language of ['de', 'en'] as const) {
      await page.goto(`/projects/${project}/runs/${run}`)
      await page.getByTestId(`language-option-${language}`).click()
      await expect(page.getByTestId('agent-row-orchestrator-v0')).toBeVisible()
      const originalUrl = page.url()
      const pane = page.getByTestId('pane-run-agents')
      const scrollport = pane.locator('[data-slot="scroll-area-viewport"]')
      const agentsJump = page.getByTestId('run-jump-agents')
      const plansJump = page.getByTestId('run-jump-plans')
      await expect(agentsJump).toBeVisible({ timeout: 3_000 })
      await expect(agentsJump).toHaveText('Agents')
      await expect(plansJump).toHaveText(language === 'de' ? 'Aktuelle Pläne' : 'Current plans')
      await assertNavigationAvailable(page)

      const metadata = page.getByTestId('run-metadata')
      const metadataToggle = metadata.locator('summary')
      await expect(metadataToggle).toHaveText(language === 'de' ? 'Rundetails' : 'Run details')
      expect(await metadata.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false)
      await expect(page.getByTestId('run-openness')).toBeInViewport({ ratio: 1 })
      const runScope = page.getByTestId('run-state').locator('dl').first().locator('dd').last()
      await expect(runScope).toContainText(/10 agents/i)
      await assertInsideScrollport(runScope, scrollport)
      const selectedRun = page.getByTestId(`run-option-${run}`)
      await expect(selectedRun.locator('time')).toHaveCount(0)
      await expect(selectedRun).not.toContainText(reportedRun.rootAgentId)
      await metadataToggle.click()
      for (const timestamp of [reportedRun.startedAt, reportedRun.finishedAt]) {
        const time = metadata.locator(`time[datetime="${timestamp}"]`)
        await expect(time).toHaveText(/UTC/)
        await assertInsideScrollport(time, scrollport)
      }
      await assertInsideScrollport(metadata.getByText(reportedRun.rootAgentId, { exact: true }), scrollport)
      await expect(metadataToggle).toBeFocused()
      await metadataToggle.press('Enter')
      expect(await metadata.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false)

      const agentsHeading = page.locator('#run-agents-heading')
      const plansHeading = page.locator('#run-plans-heading')
      await agentsJump.click()
      await expect(agentsHeading).toBeFocused()
      await assertInsideScrollport(agentsHeading, scrollport)
      await assertInsideScrollport(page.getByTestId('agent-row-orchestrator-v0').getByRole('button', { name: 'Root Orchestrator', exact: true }), scrollport)
      await page.screenshot({ path: testInfo.outputPath(`work-agents-${size.height}-${language}.png`) })

      await plansJump.click()
      await expect(plansHeading).toBeFocused()
      await assertInsideScrollport(plansHeading, scrollport)
      const revisions = page.getByTestId(`plan-${plan.planId}`).locator('[data-revision]')
      await expect(revisions).toHaveCount(ordered.length)
      expect(await revisions.evaluateAll((elements) => elements.map((element) => Number(element.getAttribute('data-revision')))))
        .toEqual(ordered.map((revision) => revision.revision))
      const currentHeading = revisions.first().getByRole('heading', { level: 5 })
      await assertInsideScrollport(currentHeading, scrollport)
      const firstStep = [...current.steps].sort((a, b) => a.order - b.order)[0]!
      await assertInsideScrollport(page.getByTestId(`plan-step-${plan.planId}-${current.revision}-${firstStep.stepId}`), scrollport)
      await page.screenshot({ path: testInfo.outputPath(`work-current-plan-${size.height}-${language}.png`) })

      // Every earlier revision and its exact reported steps remain in the DOM;
      // reaching the final old step requires genuine deep pane scrolling.
      for (const revision of ordered) {
        const entry = page.getByTestId(`plan-revision-${plan.planId}-${revision.revision}`)
        await expect(entry).toHaveAttribute('data-current-revision', String(revision.isCurrent))
        await expect(entry.locator('[data-step-state]')).toHaveCount(revision.steps.length)
        for (const step of revision.steps) {
          const row = page.getByTestId(`plan-step-${plan.planId}-${revision.revision}-${step.stepId}`)
          await expect(row).toHaveAttribute('data-step-state', step.state)
          await expect(row.getByText(step.title, { exact: true })).toHaveText(step.title)
        }
      }
      const lastOldStep = revisions.last().locator('[data-step-state]').last()
      await lastOldStep.scrollIntoViewIfNeeded()
      await assertInsideScrollport(lastOldStep, scrollport)
      expect(await scrollport.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)
      await assertNavigationAvailable(page)
      await page.screenshot({ path: testInfo.outputPath(`work-earlier-plan-${size.height}-${language}.png`) })

      await agentsJump.click()
      await expect(agentsHeading).toBeFocused()
      await assertInsideScrollport(agentsHeading, scrollport)
      await plansJump.click()
      await expect(plansHeading).toBeFocused()
      const plansToggle = plansHeading.getByRole('button')
      await plansToggle.click()
      await expect(plansToggle).toHaveAttribute('aria-expanded', 'false')
      await expect(page.getByTestId('plan-revisions')).toHaveCount(0)
      // One action both reopens the collapsed section and lands at its heading.
      await plansJump.click()
      await expect(plansHeading).toBeFocused()
      await expect(plansToggle).toHaveAttribute('aria-expanded', 'true')
      await assertInsideScrollport(plansHeading, scrollport)
      await assertInsideScrollport(currentHeading, scrollport)
      await expect(page).toHaveURL(originalUrl)
      expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 })
    }
  }
})
