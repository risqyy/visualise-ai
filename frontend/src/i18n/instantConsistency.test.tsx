import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  PROJECT_ID,
  RUN_ID,
  agent,
  agentsResponse,
  createFakeFetch,
  runResponse,
} from '@/test/fixtures'
import {
  COMPONENT_ID,
  INSPECTOR_PATH,
  feedbackEntry,
  inspectorPage,
} from '@/test/inspectorFixtures'
import { renderApp } from '@/test/renderApp'
import type { Language } from './languages'

/**
 * One instant, three areas, one reading.
 *
 * The defect #40 starts from: the project list showed a raw ISO string, the
 * run/agent pane built `04.08.2026, 09:06:31 UTC` by hand, and the inspector
 * built `04.08.26, 09:12:00 UTC` with a different formatter. Three renderings of
 * one kind of fact, on a surface whose entire purpose is that two people looking
 * at it see the same thing.
 *
 * The test therefore does not check a format. It checks that the *exact* instant
 * an area offers — visibly when it renders absolutely, in `title` and the
 * accessible name when it renders relatively — is one and the same string
 * everywhere, in both languages, and that it names UTC.
 */

const SHARED_INSTANT = '2026-08-04T09:12:00Z'
const WORKSPACE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}?component=${COMPONENT_ID}`

/**
 * The exact UTC rendering an element offers, whichever way it displays it.
 *
 * `title` is where a relative rendering keeps the instant; an absolute one shows
 * it outright. Either way there is exactly one exact value per element, which is
 * what the areas have to agree on.
 */
function exactInstantOf(element: Element | null | undefined): string {
  if (!element) throw new Error('no <time> element found')
  return element.getAttribute('title') ?? (element.textContent ?? '')
}

function timeIn(testId: string): Element {
  const element = screen.getByTestId(testId).querySelector('time')
  if (element === null) throw new Error(`no <time> inside "${testId}"`)
  return element
}

/** Every timestamp the fixtures below carry is the same instant. */
function workspaceFetch(): typeof fetch {
  return createFakeFetch({
    [`/api/v1/projects/${PROJECT_ID}/runs/${RUN_ID}`]: {
      ...runResponse,
      run: { ...runResponse.run, startedAt: SHARED_INSTANT },
    },
    [`/api/v1/projects/${PROJECT_ID}/runs/${RUN_ID}/agents`]: {
      ...agentsResponse,
      agents: [agent({ lastEventAt: SHARED_INSTANT })],
    },
    [INSPECTOR_PATH]: inspectorPage({
      feedback: [feedbackEntry({ createdAt: SHARED_INSTANT })],
    }),
  })
}

async function instantsOf(language: Language): Promise<Record<string, string>> {
  const projects = renderApp('/projects', { language })
  await screen.findAllByRole('link')
  const projectList = exactInstantOf(projects.container.querySelector('time'))
  projects.unmount()

  const workspace = renderApp(WORKSPACE_URL, { fetchImpl: workspaceFetch(), language })
  await screen.findByTestId('inspector-feedback')

  const instants = {
    projectList,
    // The agent view says "Zuletzt gemeldet" and renders it relatively …
    agentRow: exactInstantOf(timeIn('agent-last-event-orchestrator-root')),
    // … while the run state and the inspector file evidence under its instant.
    runState: exactInstantOf(timeIn('run-state')),
    inspector: exactInstantOf(timeIn('inspector-feedback')),
  }

  workspace.unmount()
  return instants
}

describe('one instant across the project list, the agent view and the inspector', () => {
  it('reads identically in every area, in German', async () => {
    const instants = await instantsOf('de')

    expect(instants).toEqual({
      projectList: '04.08.2026, 09:12:00 UTC',
      agentRow: '04.08.2026, 09:12:00 UTC',
      runState: '04.08.2026, 09:12:00 UTC',
      inspector: '04.08.2026, 09:12:00 UTC',
    })
  })

  it('reads identically in every area, in English', async () => {
    const instants = await instantsOf('en')

    expect(instants).toEqual({
      projectList: '04/08/2026, 09:12:00 UTC',
      agentRow: '04/08/2026, 09:12:00 UTC',
      runState: '04/08/2026, 09:12:00 UTC',
      inspector: '04/08/2026, 09:12:00 UTC',
    })
  })

  it('names UTC in every area and in both languages', async () => {
    for (const language of ['de', 'en'] as const) {
      for (const [area, instant] of Object.entries(await instantsOf(language))) {
        expect(instant, `${area} in ${language}`).toContain('UTC')
      }
    }
  })
})
