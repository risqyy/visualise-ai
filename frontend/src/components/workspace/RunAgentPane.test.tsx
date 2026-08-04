import type { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { applyLiveEvent } from '@/api/useLiveStream'
import type { AgentListResponse } from '@/api/types'
import { PROJECT_ID, RUN_ID, createFakeFetch, streamedEvent } from '@/test/fixtures'
import { renderApp } from '@/test/renderApp'
import {
  HISTORICAL_RUN_ID,
  historicalAgentsResponse,
  historicalPlansResponse,
  historicalRunResponse,
  openRunResponse,
  runPaths,
  runsWithHistoryResponse,
  treeAgentsResponse,
  twoRevisionPlansResponse,
} from '@/test/runFixtures'

const WORKSPACE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}`
const HISTORICAL_URL = `/projects/${PROJECT_ID}/runs/${HISTORICAL_RUN_ID}`

/**
 * Words the pane must never produce: every one of them would be a verdict
 * derived from silence rather than something an agent reported.
 */
const DERIVED_VERDICTS =
  /\bstall\w*|steht still|hängt\b|hängen\b|\btimeout\b|abgelaufen|vermutlich|wahrscheinlich|inaktiv|\btot\b|abgestürzt|reagiert nicht|keine Rückmeldung seit/i

interface Harness {
  fetchImpl: typeof fetch
  /** Number of requests per exact path, so a narrow invalidation is provable. */
  calls: Map<string, number>
  /** Replaces the body served for `/agents`, simulating a projection update. */
  setAgents: (response: AgentListResponse) => void
}

function harness(extraOverrides: Record<string, unknown> = {}): Harness {
  const calls = new Map<string, number>()
  let agents: AgentListResponse = treeAgentsResponse

  const inner = createFakeFetch({
    [runPaths.runs]: runsWithHistoryResponse,
    [runPaths.currentRun]: openRunResponse,
    [runPaths.runDetail]: openRunResponse,
    [runPaths.agents]: () => json(agents),
    [runPaths.plans]: twoRevisionPlansResponse,
    [runPaths.historicalRunDetail]: historicalRunResponse,
    [runPaths.historicalAgents]: historicalAgentsResponse,
    [runPaths.historicalPlans]: historicalPlansResponse,
    ...extraOverrides,
  })

  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const path = url.split('?')[0] ?? url
    calls.set(path, (calls.get(path) ?? 0) + 1)
    return inner(input, init)
  }) as typeof fetch

  return {
    fetchImpl,
    calls,
    setAgents: (response) => {
      agents = response
    },
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function problem(status: number, code: string): Response {
  return new Response(
    JSON.stringify({
      type: `https://visualise.ai/problems/${code}`,
      title: code,
      status,
      detail: code,
      code,
    }),
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  )
}

async function renderPane(url = WORKSPACE_URL, extraOverrides: Record<string, unknown> = {}) {
  const test = harness(extraOverrides)
  const app = renderApp(url, { fetchImpl: test.fetchImpl })
  await screen.findByTestId('agent-tree')
  return { ...app, ...test }
}

// ---------------------------------------------------------------------------
// Hierarchy
// ---------------------------------------------------------------------------

describe('agent hierarchy in the pane', () => {
  it('renders the root agent and its nested subagents at their reported depth', async () => {
    await renderPane()

    expect(screen.getByTestId('agent-row-orchestrator-root')).toHaveAttribute('data-depth', '0')
    expect(screen.getByTestId('agent-row-subagent-architect')).toHaveAttribute('data-depth', '1')
    expect(screen.getByTestId('agent-row-subagent-implementer')).toHaveAttribute(
      'data-depth',
      '1',
    )
    expect(screen.getByTestId('agent-row-subagent-reviewer')).toHaveAttribute('data-depth', '2')
    expect(screen.getByTestId('agent-row-subagent-tester')).toHaveAttribute('data-depth', '3')
    expect(screen.getByRole('list', { name: 'Agenthierarchie' })).toHaveAttribute(
      'data-max-depth',
      '3',
    )
  })

  it('shows role, assigned task, last reported time and the explicit status', async () => {
    await renderPane()

    const row = screen.getByTestId('agent-row-subagent-implementer')
    expect(within(row).getByText('Subagent')).toBeInTheDocument()
    expect(screen.getByTestId('agent-task-subagent-implementer')).toHaveTextContent(
      'VAT-Behandlung in ein eigenes Modul verschieben.',
    )
    expect(screen.getByTestId('agent-status-subagent-implementer')).toHaveAttribute(
      'data-status',
      'working',
    )
    expect(screen.getByTestId('agent-last-event-subagent-implementer')).toHaveTextContent(
      '04.08.2026, 09:06:31 UTC',
    )
  })

  it('says so when an agent never reported a status or a number', async () => {
    await renderPane()

    expect(screen.getByTestId('agent-status-subagent-tester')).toHaveTextContent(
      'kein Status gemeldet',
    )
    expect(screen.getByTestId('agent-progress-subagent-tester')).toHaveAttribute(
      'data-progress-form',
      'none',
    )
  })

  it('collapses a branch without losing the agent that owns it', async () => {
    const user = userEvent.setup()
    await renderPane()

    await user.click(
      screen.getByRole('button', { name: 'Subagents von Implementer einklappen' }),
    )

    expect(screen.getByTestId('agent-row-subagent-implementer')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-row-subagent-reviewer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-row-subagent-tester')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

describe('live updates', () => {
  it('updates only the affected node and keeps the selection', async () => {
    const user = userEvent.setup()
    const { queryClient, calls, setAgents } = await renderPane()

    // The user selects a node and reads it.
    const selectImplementer = within(
      screen.getByTestId('agent-row-subagent-implementer'),
    ).getByRole('button', { pressed: false })
    await user.click(selectImplementer)
    expect(selectImplementer).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('agent-row-subagent-implementer')).toHaveAttribute(
      'data-selected',
      'true',
    )

    const architectureCallsBefore = calls.get(runPaths.architecture) ?? 0
    const planCallsBefore = calls.get(runPaths.plans) ?? 0
    const reviewerBefore = screen.getByTestId('agent-progress-subagent-reviewer').textContent

    // The implementer reports 90 %; nothing else about the run changed.
    setAgents({
      ...treeAgentsResponse,
      agents: treeAgentsResponse.agents.map((agent) =>
        agent.agentId === 'subagent-implementer'
          ? {
              ...agent,
              progress: { percent: 90, scope: 'own_task', basis: 'completed_steps' },
              lastEventAt: '2026-08-04T09:08:00Z',
            }
          : agent,
      ),
    })

    await act(async () => {
      applyLiveEvent(
        queryClient as QueryClient,
        streamedEvent(
          'agent.progress_reported',
          { percent: 90, scope: 'own_task', basis: 'completed_steps', note: '' },
          { agentId: 'subagent-implementer', position: 63 },
        ),
      )
    })

    await waitFor(() =>
      expect(screen.getByTestId('agent-progress-subagent-implementer')).toHaveTextContent(
        '90 %',
      ),
    )

    // The selection survived the refetch …
    expect(
      within(screen.getByTestId('agent-row-subagent-implementer')).getByRole('button', {
        pressed: true,
      }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('agent-row-subagent-implementer')).toHaveAttribute(
      'data-selected',
      'true',
    )

    // … the sibling node is untouched …
    expect(screen.getByTestId('agent-progress-subagent-reviewer').textContent).toBe(
      reviewerBefore,
    )

    // … and nothing outside the agent list was refetched.
    expect(calls.get(runPaths.architecture) ?? 0).toBe(architectureCallsBefore)
    expect(calls.get(runPaths.plans) ?? 0).toBe(planCallsBefore)
  })
})

// ---------------------------------------------------------------------------
// Open runs and silence
// ---------------------------------------------------------------------------

describe('a run without a terminal event', () => {
  it('stays open and shows the last reported state, deriving nothing from silence', async () => {
    const { container } = await renderPane()

    const openness = screen.getByTestId('run-openness')
    expect(openness).toHaveAttribute('data-open', 'true')
    expect(openness).toHaveTextContent('offen — kein Terminalereignis gemeldet')

    // The run reported no end, and the pane says exactly that.
    expect(screen.getByTestId('run-state')).toHaveTextContent('kein Ende gemeldet')

    // Agents keep the status they last reported, however old the timestamp is.
    expect(screen.getByTestId('agent-status-orchestrator-root')).toHaveTextContent('arbeitet')
    expect(screen.getByTestId('agent-outcome-orchestrator-root')).toHaveTextContent(
      'kein Abschluss gemeldet',
    )
    expect(screen.getByTestId('agent-status-subagent-reviewer')).toHaveTextContent('wartet')

    // No timeout, no heuristic, no "seems stuck" anywhere in the pane.
    const pane = container.querySelector('[data-testid="pane-run-agents"]')
    expect(pane?.textContent ?? '').not.toMatch(DERIVED_VERDICTS)
  })
})

// ---------------------------------------------------------------------------
// Current versus historical run
// ---------------------------------------------------------------------------

describe('run selection', () => {
  it('marks the current run and shows no historical banner on it', async () => {
    await renderPane()

    expect(screen.getByTestId('current-run-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('historical-run-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId(`run-option-${RUN_ID}`)).toHaveAttribute('data-current', 'true')
  })

  it('never lets a historical run overlay the current run view', async () => {
    await renderPane(HISTORICAL_URL)

    // The switch is announced before anything else, and offers the way back.
    const banner = screen.getByTestId('historical-run-banner')
    expect(banner).toHaveTextContent('Historischer Run')
    expect(banner).toHaveTextContent(RUN_ID)
    expect(screen.getByTestId('back-to-current-run')).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}/runs/${RUN_ID}`,
    )
    expect(screen.queryByTestId('current-run-banner')).not.toBeInTheDocument()

    // Only the historical run's agents are shown — the two runs never mix.
    expect(screen.getByTestId('pane-run-agents')).toHaveAttribute(
      'data-run-id',
      HISTORICAL_RUN_ID,
    )
    expect(screen.getByTestId('agent-row-orchestrator-yesterday')).toHaveAttribute(
      'data-run-id',
      HISTORICAL_RUN_ID,
    )
    for (const agentId of ['orchestrator-root', 'subagent-implementer', 'subagent-reviewer']) {
      expect(screen.queryByTestId(`agent-row-${agentId}`)).not.toBeInTheDocument()
    }
  })

  it('reaches a historical run only through an explicit navigation', async () => {
    const user = userEvent.setup()
    const { router } = await renderPane()

    expect(router.state.location.pathname).toBe(WORKSPACE_URL)
    await user.click(screen.getByTestId(`run-option-${HISTORICAL_RUN_ID}`))

    await waitFor(() => expect(router.state.location.pathname).toBe(HISTORICAL_URL))
    expect(await screen.findByTestId('historical-run-banner')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Progress: two kinds of statement
// ---------------------------------------------------------------------------

describe('reported progress', () => {
  it('renders the orchestrator estimate as a claim, never as overall progress', async () => {
    await renderPane()

    const orchestrator = screen.getByTestId('agent-progress-orchestrator-root')
    expect(orchestrator).toHaveAttribute('data-progress-form', 'claim')
    expect(orchestrator).toHaveAttribute('data-progress-scope', 'overall_estimate')
    // No measure: no progressbar role, no segments, and the value is quoted.
    expect(within(orchestrator).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(orchestrator.querySelectorAll('[data-progress-segment]')).toHaveLength(0)
    expect(orchestrator.querySelector('[data-claim-marker]')).not.toBeNull()
    expect(orchestrator).toHaveTextContent('Gemeldete Selbsteinschätzung von Root Orchestrator')
    expect(orchestrator).toHaveTextContent('Kein gemessener Fortschritt.')

    // A subagent number is a different statement: its own task, and countable.
    const subagent = screen.getByTestId('agent-progress-subagent-implementer')
    expect(subagent).toHaveAttribute('data-progress-form', 'counted')
    expect(subagent).toHaveAttribute('data-progress-scope', 'own_task')
    expect(within(subagent).getByRole('progressbar')).toBeInTheDocument()
    expect(subagent).toHaveTextContent('für den eigenen Task')

    // Nothing in the pane presents a measured bar for the whole run.
    const overallMeters = document.querySelectorAll(
      '[data-progress-form="counted"][data-progress-scope="overall_estimate"]',
    )
    expect(overallMeters).toHaveLength(0)
  })

  it('keeps an estimate and counted steps structurally apart', async () => {
    await renderPane()

    const estimate = screen.getByTestId('agent-progress-orchestrator-root')
    const counted = screen.getByTestId('agent-progress-subagent-architect')

    // Different form, not a different colour.
    expect(estimate.getAttribute('data-progress-form')).toBe('claim')
    expect(counted.getAttribute('data-progress-form')).toBe('counted')

    // The counted statement is a countable row of segments; the estimate has none.
    expect(counted.querySelectorAll('[data-progress-segment]')).toHaveLength(10)
    expect(estimate.querySelectorAll('[data-progress-segment]')).toHaveLength(0)

    // Neither is nested inside the other, and they never share a group.
    expect(counted.contains(estimate)).toBe(false)
    expect(estimate.contains(counted)).toBe(false)
    expect(estimate.getAttribute('data-progress-group')).toBe('claim')
    expect(counted.getAttribute('data-progress-group')).toBe('counted')

    // Completed plan steps use the counted form as well — same shape, same kind
    // of statement — and are reported per revision, never merged into an estimate.
    const planCounted = screen.getByTestId('plan-completion-plan-2026-08-04-0001-2')
    expect(planCounted).toHaveAttribute('data-progress-form', 'counted')
    expect(planCounted.querySelectorAll('[data-progress-segment]')).toHaveLength(5)
    expect(planCounted.querySelectorAll('[data-progress-segment][data-filled="true"]')).toHaveLength(
      2,
    )
    expect(planCounted.querySelectorAll('[data-claim-marker]')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Plan revisions
// ---------------------------------------------------------------------------

describe('plan revisions', () => {
  it('shows every revision in order and keeps revision 1 after revision 2 exists', async () => {
    await renderPane()

    const plan = screen.getByTestId('plan-plan-2026-08-04-0001')
    expect(plan).toHaveAttribute('data-revision-count', '2')

    const revisionOrder = Array.from(plan.querySelectorAll('[data-revision]')).map((element) =>
      element.getAttribute('data-revision'),
    )
    expect(revisionOrder).toEqual(['1', '2'])

    // Revision 1 is still there, complete, with the states it was last seen with.
    const first = screen.getByTestId('plan-revision-plan-2026-08-04-0001-1')
    expect(first).toHaveAttribute('data-current-revision', 'false')
    expect(first).toHaveTextContent('frühere Fassung')
    expect(first.querySelectorAll('[data-step-state]')).toHaveLength(4)
    expect(
      screen.getByTestId('plan-step-plan-2026-08-04-0001-1-step-extract'),
    ).toHaveAttribute('data-step-state', 'in_progress')

    // Revision 2 is the current one and carries the fifth step.
    const second = screen.getByTestId('plan-revision-plan-2026-08-04-0001-2')
    expect(second).toHaveAttribute('data-current-revision', 'true')
    expect(second.querySelectorAll('[data-step-state]')).toHaveLength(5)
    expect(
      screen.getByTestId('plan-step-plan-2026-08-04-0001-2-step-extract'),
    ).toHaveAttribute('data-step-state', 'done')
    expect(
      screen.getByTestId('plan-step-plan-2026-08-04-0001-2-step-rates'),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('a project without a run', () => {
  it('renders the pane cleanly instead of crashing', async () => {
    const emptyRunId = 'run-does-not-exist'
    const test = harness({
      [runPaths.runs]: { projectPosition: 0, runs: [], nextCursor: null },
      [runPaths.currentRun]: () => problem(404, 'current_run_not_found'),
      [`/api/v1/projects/${PROJECT_ID}/runs/${emptyRunId}/agents`]: {
        projectPosition: 0,
        agents: [],
      },
      [`/api/v1/projects/${PROJECT_ID}/runs/${emptyRunId}/plans`]: {
        projectPosition: 0,
        plans: [],
      },
      [`/api/v1/projects/${PROJECT_ID}/runs/${emptyRunId}`]: () =>
        problem(404, 'run_not_found'),
    })

    renderApp(`/projects/${PROJECT_ID}/runs/${emptyRunId}`, { fetchImpl: test.fetchImpl })

    expect(await screen.findByTestId('pane-run-agents')).toBeInTheDocument()
    expect(await screen.findByTestId('no-current-run')).toBeInTheDocument()
    expect(await screen.findByText('Keine Runs gemeldet')).toBeInTheDocument()
    expect(await screen.findByText('Keine Agents gemeldet')).toBeInTheDocument()
    expect(await screen.findByText('Kein Plan veröffentlicht')).toBeInTheDocument()

    // Without a current run there is nothing to be historical about.
    expect(screen.queryByTestId('historical-run-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('current-run-banner')).not.toBeInTheDocument()

    // The rest of the workspace is unaffected.
    expect(screen.getByTestId('pane-architecture')).toBeInTheDocument()
  })
})
