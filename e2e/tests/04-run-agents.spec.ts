import { expect, test } from '@playwright/test'

import { getJson } from '../src/api.js'
import { MAIN_PROJECT, MAIN_RUN } from '../src/config.js'

/**
 * Mandatory check 4 — the run/agent tree with parallel subagents and progress
 * estimates that cannot be mistaken for measurements.
 *
 * The separation asserted here is **structural**, not chromatic (ADR 0011):
 *
 * * a counted fact is a row of discrete segments carrying `role="progressbar"`
 *   with `aria-valuenow`/`aria-valuemax`,
 * * a reported claim has no track, no fill and **no ARIA value at all**.
 *
 * `data-progress-form` is what the test reads, and it deliberately never reads a
 * colour: a test that checked a hue would be proving the opposite of the rule.
 */

interface AgentsResponse {
  agents: {
    agentId: string
    parentAgentId: string | null
    role: string
    displayName: string
    assignedTask: string | null
    progress: { percent: number; scope: string | null; basis: string | null } | null
  }[]
}

const ROOT = 'orchestrator-root'
const ARCHITECT = 'subagent-architecture-mapper'
const IMPLEMENTER = 'subagent-implementer'
const REVIEWER = 'subagent-reviewer'
const TESTER = 'subagent-test-engineer'

test('4 · the tree is three levels deep with two subagents running in parallel below one parent', async ({
  page,
}) => {
  const response = await getJson(
    `/api/v1/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}/agents`,
  )
  expect(response.status).toBe(200)
  const { agents } = response.body as AgentsResponse
  expect(agents).toHaveLength(5)

  const parentOf = new Map(agents.map((agent) => [agent.agentId, agent.parentAgentId]))
  expect(parentOf.get(ROOT)).toBeNull()
  expect(parentOf.get(ARCHITECT)).toBe(ROOT)
  expect(parentOf.get(IMPLEMENTER)).toBe(ROOT)
  // Delegated by a subagent, not by the root — that is the third level.
  expect(parentOf.get(REVIEWER)).toBe(IMPLEMENTER)
  expect(parentOf.get(TESTER)).toBe(IMPLEMENTER)

  await page.goto(`/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}`)
  await expect(page.getByTestId('pane-run-agents')).toBeVisible()

  const rows = page.locator('[data-testid^="agent-row-"]')
  await expect(rows).toHaveCount(5)

  // The rendered hierarchy: one indent level per depth, flat list by design.
  await expect(page.getByTestId(`agent-row-${ROOT}`)).toHaveAttribute('data-depth', '0')
  await expect(page.getByTestId(`agent-row-${ARCHITECT}`)).toHaveAttribute('data-depth', '1')
  await expect(page.getByTestId(`agent-row-${IMPLEMENTER}`)).toHaveAttribute('data-depth', '1')
  await expect(page.getByTestId(`agent-row-${REVIEWER}`)).toHaveAttribute('data-depth', '2')
  await expect(page.getByTestId(`agent-row-${TESTER}`)).toHaveAttribute('data-depth', '2')
  await expect(page.locator('ul[data-max-depth]')).toHaveAttribute('data-max-depth', '2')

  // No agent was orphaned or had its parent edge cut to break a cycle.
  await expect(page.getByTestId(`agent-row-${ROOT}`)).toHaveAttribute(
    'data-attachment',
    'root',
  )
  for (const agentId of [ARCHITECT, IMPLEMENTER, REVIEWER, TESTER]) {
    await expect(page.getByTestId(`agent-row-${agentId}`)).toHaveAttribute(
      'data-attachment',
      'child',
    )
  }

  // Every row answers the four reporting questions with what was reported.
  await expect(page.getByTestId(`agent-task-${TESTER}`)).toContainText(
    'Cover the new tax module with table tests.',
  )
  await expect(page.getByTestId(`agent-status-${REVIEWER}`)).toHaveAttribute(
    'data-status',
    'done',
  )
  await expect(page.getByTestId(`agent-outcome-${TESTER}`)).toHaveAttribute(
    'data-outcome',
    'completed',
  )

  // The run is open, and that is described as a fact about the log.
  await expect(page.getByTestId('run-openness')).toHaveAttribute('data-open', 'true')
  await expect(page.getByTestId('run-openness')).toContainText('kein Terminalereignis')
})

test('4 · an overall estimate and a counted subagent progress are told apart by shape, not colour', async ({
  page,
}) => {
  await page.goto(`/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}`)
  await expect(page.getByTestId('pane-run-agents')).toBeVisible()

  const orchestratorProgress = page.getByTestId(`agent-progress-${ROOT}`)
  const testerProgress = page.getByTestId(`agent-progress-${TESTER}`)
  await expect(orchestratorProgress).toBeVisible()
  await expect(testerProgress).toBeVisible()

  // ---- the orchestrator's whole-run estimate: a claim ---------------------
  await expect(orchestratorProgress).toHaveAttribute('data-progress-form', 'claim')
  await expect(orchestratorProgress).toHaveAttribute(
    'data-progress-scope',
    'overall_estimate',
  )
  await expect(
    orchestratorProgress.locator('[role="progressbar"]'),
    'a reported claim must not be given a scale',
  ).toHaveCount(0)
  await expect(orchestratorProgress.locator('[data-progress-segment]')).toHaveCount(0)
  await expect(orchestratorProgress).toContainText('≈')
  await expect(orchestratorProgress).toContainText('Gemeldete Selbsteinschätzung')
  await expect(orchestratorProgress).toContainText('Kein gemessener Fortschritt')

  // ---- a subagent counting the steps of its own task: a measurement -------
  await expect(testerProgress).toHaveAttribute('data-progress-form', 'counted')
  await expect(testerProgress).toHaveAttribute('data-progress-scope', 'own_task')
  await expect(testerProgress).toHaveAttribute('data-progress-basis', 'completed_steps')
  const meter = testerProgress.locator('[role="progressbar"]')
  await expect(meter).toHaveCount(1)
  await expect(meter).toHaveAttribute('aria-valuenow', '100')
  await expect(meter).toHaveAttribute('aria-valuemax', '100')
  await expect(testerProgress.locator('[data-progress-segment]')).toHaveCount(10)
  await expect(testerProgress).not.toContainText('≈')

  // ---- the two renderings share no geometry ------------------------------
  const nesting = await page.evaluate(
    ([claimId, countedId]) => {
      const claim = document.querySelector(`[data-testid="${claimId}"]`)
      const counted = document.querySelector(`[data-testid="${countedId}"]`)
      if (claim === null || counted === null) return null
      return {
        claimContainsCounted: claim.contains(counted),
        countedContainsClaim: counted.contains(claim),
        sameGroup:
          claim.getAttribute('data-progress-group') ===
          counted.getAttribute('data-progress-group'),
      }
    },
    [`agent-progress-${ROOT}`, `agent-progress-${TESTER}`] as const,
  )
  expect(nesting).not.toBeNull()
  expect(nesting?.claimContainsCounted).toBe(false)
  expect(nesting?.countedContainsClaim).toBe(false)
  expect(nesting?.sameGroup).toBe(false)

  // Another subagent scoped to its own task also gets the counted form, so the
  // distinction follows scope and basis rather than the position in the tree.
  await expect(page.getByTestId(`agent-progress-${IMPLEMENTER}`)).toHaveAttribute(
    'data-progress-form',
    'counted',
  )

  // ---- plans: both revisions are kept, with counted step completion -------
  const revisions = page.locator('[data-revision]')
  await expect(revisions).toHaveCount(2)
  await expect(page.getByTestId('plan-revisions')).toContainText('Revision 1')
  await expect(page.getByTestId('plan-revisions')).toContainText('Revision 2')
})
