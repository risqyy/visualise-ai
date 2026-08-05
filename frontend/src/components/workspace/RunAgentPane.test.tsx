import type { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { applyLiveEvent } from '@/api/useLiveStream'
import type { AgentListResponse } from '@/api/types'
import { PROJECT_ID, RUN_ID, createFakeFetch, streamedEvent } from '@/test/fixtures'
import { renderApp } from '@/test/renderApp'
import {
  CHAINED_TASK,
  HISTORICAL_RUN_ID,
  LONG_STATUS_NOTE,
  PARAGRAPH_TASK,
  historicalAgentsResponse,
  historicalPlansResponse,
  historicalRunResponse,
  longTaskAgentsResponse,
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

/**
 * The `<time>` a `ReportedTime` renders inside a labelled cell.
 *
 * A relative rendering keeps the exact UTC instant in `datetime`, `title` and
 * its accessible name, and that is what the assertions below read: the visible
 * phrase is an approximation, the attributes are the reported fact (#40).
 */
function timeElementIn(testId: string): HTMLTimeElement {
  const element = screen.getByTestId(testId).querySelector('time')
  if (element === null) throw new Error(`no <time> inside "${testId}"`)
  return element
}

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

/** The per-row detail disclosure of one agent. */
function detailToggle(agentId: string) {
  return screen.findByTestId(`agent-detail-toggle-${agentId}`)
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
    // "Zuletzt gemeldet" reads as a distance now (#40) — and the reported UTC
    // instant travels with it, so the row still states exactly when the agent
    // spoke rather than only roughly how long ago.
    const lastEvent = timeElementIn('agent-last-event-subagent-implementer')
    expect(lastEvent).toHaveAttribute('title', '04.08.2026, 09:06:31 UTC')
    expect(lastEvent).toHaveAttribute('datetime', '2026-08-04T09:06:31Z')
    expect(lastEvent).toHaveAccessibleName(/04\.08\.2026, 09:06:31 UTC/)
  })

  it('says so when an agent never reported a status or a number', async () => {
    const user = userEvent.setup()
    await renderPane()

    // The status is part of the compact row: "nothing was reported" is the
    // sentence the row exists for and is never behind a disclosure.
    expect(screen.getByTestId('agent-status-subagent-tester')).toHaveTextContent(
      'kein Status gemeldet',
    )

    // The reported number lives in the detail block. An agent that never
    // reported a status starts compact (#39), so the row is opened first — and
    // it then says "nothing was reported" there too, rather than showing a zero.
    await user.click(await detailToggle('subagent-tester'))
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
    const user = userEvent.setup()
    await renderPane()

    // The architect reported an outcome, so its row starts compact (#39). The
    // separation asserted below is about the two renderings, not about which of
    // them happens to be painted first, so the row is opened explicitly.
    await user.click(await detailToggle('subagent-architect'))

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
// Density and progressive disclosure (#39)
// ---------------------------------------------------------------------------

/** Renders the pane against the long-text stress case of #39. */
function renderLongTaskPane() {
  return renderPane(WORKSPACE_URL, { [runPaths.agents]: longTaskAgentsResponse })
}

describe('default density of an agent row', () => {
  it('starts compact unless the agent itself reported ongoing work', async () => {
    await renderPane()

    // Reported `working` / `waiting` and no outcome: details are painted.
    expect(screen.getByTestId('agent-row-orchestrator-root')).toHaveAttribute(
      'data-density',
      'detailed',
    )
    expect(screen.getByTestId('agent-row-subagent-reviewer')).toHaveAttribute(
      'data-density',
      'detailed',
    )

    // Reported an outcome, and reported no status at all: compact.
    expect(screen.getByTestId('agent-row-subagent-architect')).toHaveAttribute(
      'data-density',
      'compact',
    )
    expect(screen.getByTestId('agent-row-subagent-tester')).toHaveAttribute(
      'data-density',
      'compact',
    )

    // Compact is a smaller rendering, not a smaller report: agent, role, status
    // and assigned task are all still on the row.
    const compact = screen.getByTestId('agent-row-subagent-architect')
    expect(within(compact).getByText('Architecture Mapper')).toBeInTheDocument()
    expect(within(compact).getByText('Subagent')).toBeInTheDocument()
    expect(screen.getByTestId('agent-status-subagent-architect')).toHaveTextContent('fertig')
    expect(screen.getByTestId('agent-task-subagent-architect')).toHaveTextContent(
      'Angewandtes Architekturmodell veröffentlichen.',
    )
  })

  it('reads the density off the reported status, never off a timestamp', async () => {
    // Two agents whose timestamps say the opposite of their statuses: the
    // "working" one reported hours ago, the "done" one seconds ago. If any clock
    // were consulted, this is where it would show.
    await renderPane(WORKSPACE_URL, {
      [runPaths.agents]: {
        ...treeAgentsResponse,
        agents: treeAgentsResponse.agents.map((entry) =>
          entry.agentId === 'subagent-implementer'
            ? { ...entry, lastEventAt: '2020-01-01T00:00:00Z' }
            : entry.agentId === 'subagent-architect'
              ? { ...entry, lastEventAt: '2099-12-31T23:59:59Z' }
              : entry,
        ),
      },
    })

    expect(screen.getByTestId('agent-row-subagent-implementer')).toHaveAttribute(
      'data-density',
      'detailed',
    )
    expect(screen.getByTestId('agent-row-subagent-implementer')).toHaveAttribute(
      'data-work-state',
      'ongoing',
    )
    expect(screen.getByTestId('agent-row-subagent-architect')).toHaveAttribute(
      'data-density',
      'compact',
    )

    // The stale timestamp is shown as what it is, without a word about it.
    expect(timeElementIn('agent-last-event-subagent-implementer')).toHaveAttribute(
      'title',
      '01.01.2020, 00:00:00 UTC',
    )
    expect(screen.getByTestId('pane-run-agents').textContent ?? '').not.toMatch(
      DERIVED_VERDICTS,
    )
  })

  it('counts the reported status words without turning them into a verdict', async () => {
    await renderPane()

    const tally = screen.getByTestId('agent-status-tally')
    expect(tally).toHaveTextContent('2 × arbeitet')
    expect(tally).toHaveTextContent('1 × wartet')
    expect(tally).toHaveTextContent('1 × fertig')
    expect(tally).toHaveTextContent('1 × kein Status gemeldet')
    expect(tally.textContent ?? '').not.toMatch(DERIVED_VERDICTS)
  })
})

describe('opening and closing a row', () => {
  it('is operable with the keyboard alone and keeps the focus on the control', async () => {
    const user = userEvent.setup()
    await renderPane()

    const row = screen.getByTestId('agent-row-subagent-architect')
    const select = within(row).getByRole('button', { pressed: false })
    select.focus()

    // The disclosure is the next stop in the tab order of the card.
    await user.tab()
    const toggle = screen.getByTestId('agent-detail-toggle-subagent-architect')
    expect(toggle).toHaveFocus()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(row).toHaveAttribute('data-density', 'detailed')
    expect(screen.getByTestId('agent-progress-subagent-architect')).toBeInTheDocument()
    expect(toggle).toHaveFocus()

    // Space closes it again, and the focus never leaves the button.
    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(row).toHaveAttribute('data-density', 'compact')
    expect(toggle).toHaveFocus()
  })

  it('keeps a row the user opened open when the next report arrives', async () => {
    const user = userEvent.setup()
    const { queryClient, setAgents } = await renderPane()

    await user.click(await detailToggle('subagent-architect'))
    expect(screen.getByTestId('agent-row-subagent-architect')).toHaveAttribute(
      'data-density',
      'detailed',
    )

    setAgents({
      ...treeAgentsResponse,
      agents: treeAgentsResponse.agents.map((entry) =>
        entry.agentId === 'subagent-architect'
          ? { ...entry, progress: { percent: 100, scope: 'own_task', basis: 'completed_steps' } }
          : entry,
      ),
    })
    await act(async () => {
      applyLiveEvent(
        queryClient as QueryClient,
        streamedEvent(
          'agent.progress_reported',
          { percent: 100, scope: 'own_task', basis: 'completed_steps', note: '' },
          { agentId: 'subagent-architect', position: 64 },
        ),
      )
    })

    await waitFor(() =>
      expect(screen.getByTestId('agent-progress-subagent-architect')).toHaveTextContent(
        '100 %',
      ),
    )
    expect(screen.getByTestId('agent-row-subagent-architect')).toHaveAttribute(
      'data-density',
      'detailed',
    )
  })
})

describe('long reported texts', () => {
  it('clips the paint and keeps the whole report in the document', async () => {
    await renderLongTaskPane()

    const task = screen.getByTestId('agent-task-orchestrator-root')
    // Clipped for the eye …
    expect(task).toHaveAttribute('data-clipped', 'true')
    expect(task.className).toContain('line-clamp-2')
    // … and complete for everything else: no substring is ever computed, so the
    // reported wording is reachable without any interaction at all.
    expect(task).toHaveTextContent(PARAGRAPH_TASK)
    expect(task).toHaveAttribute('data-full-length', String(PARAGRAPH_TASK.length))

    const chained = screen.getByTestId('agent-task-subagent-backend-api')
    expect(chained).toHaveTextContent(CHAINED_TASK)
    expect(chained.textContent).toBe(CHAINED_TASK)

    // A short task gets no control, because there is nothing to unfold.
    expect(
      screen.queryByTestId('agent-task-subagent-implementer-toggle'),
    ).not.toBeInTheDocument()
  })

  it('opens the full text through a deliberate, keyboard-operable action', async () => {
    const user = userEvent.setup()
    await renderLongTaskPane()

    const toggle = screen.getByTestId('agent-task-orchestrator-root-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    toggle.focus()
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')

    const task = screen.getByTestId('agent-task-orchestrator-root')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(task).toHaveAttribute('data-clipped', 'false')
    expect(task.className).not.toContain('line-clamp')
    expect(task).toHaveTextContent(PARAGRAPH_TASK)

    await user.keyboard(' ')
    expect(task).toHaveAttribute('data-clipped', 'true')
    expect(task).toHaveTextContent(PARAGRAPH_TASK)
  })

  it('treats a long status message the same way, verbatim', async () => {
    await renderLongTaskPane()

    const note = screen.getByTestId('agent-status-note-orchestrator-root')
    expect(note.textContent).toBe(LONG_STATUS_NOTE)
    expect(note).toHaveAttribute('data-clipped', 'true')
    expect(
      screen.getByTestId('agent-status-note-orchestrator-root-toggle'),
    ).toBeInTheDocument()
  })

  it('does not let a paragraph change the structure of the pane', async () => {
    await renderLongTaskPane()

    // The same sections, the same list, the same number of rows as with short
    // texts — a long report grows a row, never the pane's skeleton.
    expect(screen.getByTestId('run-state')).toBeInTheDocument()
    expect(screen.getByTestId('agent-tree-region')).toBeInTheDocument()
    expect(screen.getByTestId('plan-revisions')).toBeInTheDocument()

    const list = screen.getByRole('list', { name: 'Agenthierarchie' })
    expect(list.querySelectorAll('[data-testid^="agent-row-"]')).toHaveLength(3)
    expect(screen.getByTestId('agent-row-subagent-backend-api')).toHaveAttribute(
      'data-depth',
      '1',
    )
  })

  it('keeps the two progress forms apart across a collapse and a reopen', async () => {
    const user = userEvent.setup()
    await renderLongTaskPane()

    // The orchestrator reported an overall estimate and starts compact here.
    await user.click(await detailToggle('orchestrator-root'))
    await user.click(await detailToggle('subagent-backend-api'))

    const claim = screen.getByTestId('agent-progress-orchestrator-root')
    const counted = screen.getByTestId('agent-progress-subagent-backend-api')

    expect(claim).toHaveAttribute('data-progress-form', 'claim')
    expect(claim.querySelectorAll('[data-progress-segment]')).toHaveLength(0)
    expect(within(claim).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(claim.querySelector('[data-claim-marker]')).not.toBeNull()

    expect(counted).toHaveAttribute('data-progress-form', 'counted')
    expect(counted.querySelectorAll('[data-progress-segment]')).toHaveLength(10)
    expect(within(counted).getByRole('progressbar')).toBeInTheDocument()

    expect(claim.contains(counted)).toBe(false)
    expect(counted.contains(claim)).toBe(false)
    expect(claim.getAttribute('data-progress-group')).not.toBe(
      counted.getAttribute('data-progress-group'),
    )
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
