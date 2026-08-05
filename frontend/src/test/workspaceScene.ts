import { screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { i18n as I18n } from 'i18next'

import type { Language } from '@/i18n'

import { PROJECT_ID, RUN_ID, component, createFakeFetch } from './fixtures'
import {
  COMPONENT_ID,
  HISTORY_PATH,
  INSPECTOR_PATH,
  historyPage,
  inspectorPage,
} from './inspectorFixtures'
import {
  longTaskAgentsResponse,
  openRunResponse,
  runPaths,
  runsWithHistoryResponse,
  twoRevisionPlansResponse,
} from './runFixtures'
import { renderApp, type RenderAppOptions } from './renderApp'

/**
 * The full cockpit, with real reported content in all three panes.
 *
 * Two suites need exactly this scene and would otherwise each wire up the same
 * seven responses: `WorkspacePage.i18n.test.tsx` compares German against
 * English, and `accessibleNames.test.tsx` walks the accessible names of the same
 * screen in every language. A second copy of the fixture would be a second
 * thing to keep in step with the contract, and the two suites would slowly stop
 * looking at the same screen.
 */

export const WORKSPACE_SCENE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}?component=${COMPONENT_ID}`

/** The three panes, each with real reported content in them. */
export function workspaceSceneServer(): typeof fetch {
  return createFakeFetch({
    [runPaths.runs]: runsWithHistoryResponse,
    [runPaths.currentRun]: openRunResponse,
    [runPaths.runDetail]: openRunResponse,
    [runPaths.agents]: longTaskAgentsResponse,
    [runPaths.plans]: twoRevisionPlansResponse,
    [runPaths.architecture]: {
      projectPosition: 42,
      components: [component({ componentId: COMPONENT_ID, name: 'Tax', kind: 'module' })],
      relationships: [],
      activeChanges: [],
    },
    [INSPECTOR_PATH]: inspectorPage(),
    [HISTORY_PATH]: historyPage(),
  })
}

export interface WorkspaceSceneOptions {
  /** Language the app starts in. Ignored when `i18n` is given. */
  language?: Language
  /** A prepared instance — the pseudo-locale arrives this way. */
  i18n?: I18n
}

/**
 * Renders the scene and waits until all three panes carry their content.
 *
 * The inspector arrives last, so waiting for it and for the agent tree is what
 * makes "the whole cockpit is on screen" true rather than likely.
 *
 * The canvas is waited for as well, and that one is not cosmetic: while ELK is
 * still running, the architecture pane carries a `canvas-layouting` element
 * that is gone a moment later. Any test that compares two renderings element by
 * element — German against English, German against the pseudo-locale — would
 * otherwise report the *progress of the layout* as a difference between two
 * languages, on whichever of the two happened to be measured first.
 */
export async function renderWorkspaceScene(options: WorkspaceSceneOptions = {}) {
  const renderOptions: RenderAppOptions = {
    fetchImpl: workspaceSceneServer(),
    ...(options.i18n ? { i18n: options.i18n } : {}),
    ...(options.language ? { language: options.language } : {}),
  }

  const rendered = renderApp(WORKSPACE_SCENE_URL, renderOptions)

  await screen.findByTestId('inspector-context')
  await screen.findByTestId('agent-tree')

  const canvas = await screen.findByTestId('architecture-canvas')
  await waitFor(() => expect(canvas.getAttribute('data-layouting')).toBe('false'))
  await waitFor(() =>
    expect(Number(canvas.getAttribute('data-fit-view-count'))).toBeGreaterThan(0),
  )

  return rendered
}
