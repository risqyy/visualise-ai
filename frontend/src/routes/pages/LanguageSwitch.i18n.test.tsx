import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { LANGUAGE_STORAGE_KEY, bindDocumentLanguage, createI18n } from '@/i18n'
import { useUiStore } from '@/state/uiStore'
import { largeArchitectureResponse } from '@/test/architectureFixtures'
import { PROJECT_ID, RUN_ID, component, createFakeFetch } from '@/test/fixtures'
import {
  COMPONENT_ID,
  HISTORY_PATH,
  INSPECTOR_PATH,
  historyPage,
  inspectorPage,
} from '@/test/inspectorFixtures'
import { renderApp } from '@/test/renderApp'
import {
  longTaskAgentsResponse,
  openRunResponse,
  runPaths,
  runsWithHistoryResponse,
  twoRevisionPlansResponse,
} from '@/test/runFixtures'

/**
 * Switching the language **at runtime** (#36).
 *
 * Every assertion in this file is about something that must *not* happen. The
 * cockpit already renders in two languages (#42); what this issue adds is a
 * control, and a control that loses the user's place is worse than no control.
 * So the switch is measured against the state it is not allowed to touch:
 *
 * * the URL — which carries the whole selection (`?component=`, `?focus=`,
 *   `?history=`) and must come out byte-identical;
 * * the pane arrangement — sizes and collapse flags;
 * * the canvas camera — a language changes text lengths, and a re-fit would
 *   throw the reader out of the part of the architecture they were reading.
 *   The camera policy knows three reasons to move (ADR 0008, ADR 0017) and a
 *   language switch is none of them, so `data-fit-view-count` and the rendered
 *   viewport transform have to be the same number before and after;
 * * the reported data — the agent's task, its feedback, its diffs and every id.
 *
 * The one thing that *does* follow is `<html lang>`, plus the words.
 *
 * All of it is asserted after a real click on the switch, not after a second
 * render in another language: the failure modes this issue is about — a fit, a
 * navigation, a remount — only exist on the transition.
 */

const WORKSPACE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}`
const CANVAS_TIMEOUT = 15_000

/** The three panes, each with real reported content in them. */
function workspaceServer(): typeof fetch {
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

function englishSegment(): HTMLElement {
  return screen.getByTestId('language-option-en')
}

/**
 * Resolves once the workspace has stopped moving on its own.
 *
 * Every measurement here is a before/after comparison inside **one** rendering,
 * so it has to start after the last thing the cockpit does unprompted: the
 * three panes arriving, ELK finishing, the initial disclosure being written
 * down and the one automatic camera movement landing. Measuring earlier would
 * charge the language switch for a change it did not cause — and, worse, would
 * hide one it did.
 */
async function waitForSettledWorkspace(): Promise<HTMLElement> {
  const canvas = await screen.findByTestId('architecture-canvas', undefined, {
    timeout: CANVAS_TIMEOUT,
  })
  await waitFor(() => expect(canvas.getAttribute('data-layouting')).toBe('false'), {
    timeout: CANVAS_TIMEOUT,
  })
  await waitForCameraSettled()
  return canvas
}

/** Every reported value on screen, in document order. */
function reportedValues(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-reported]')].map(
    (node) => node.textContent ?? '',
  )
}

afterEach(() => {
  document.documentElement.lang = ''
})

describe('language switch — the URL is not touched', () => {
  it('leaves a workspace URL with a selection and a focus byte-identical', async () => {
    const user = userEvent.setup()
    const url = `${WORKSPACE_URL}?component=${COMPONENT_ID}&focus=feedback&history=true`
    const { router } = renderApp(url, { fetchImpl: workspaceServer() })

    await waitForSettledWorkspace()
    const before = router.state.location.href
    expect(before).toContain(`component=${COMPONENT_ID}`)
    expect(before).toContain('focus=feedback')
    expect(before).toContain('history=true')

    await user.click(englishSegment())
    await screen.findByRole('heading', { name: 'Architecture' })

    // Not "equivalent" and not "the same parameters": the same string.
    expect(router.state.location.href).toBe(before)
    expect(router.state.location.search).toEqual({
      component: COMPONENT_ID,
      focus: 'feedback',
      history: true,
    })
    // …and it was one entry in the history, not two.
    expect(router.history.length).toBe(1)
  })
})

describe('language switch — the working context survives', () => {
  it('keeps pane widths, collapsed panes and the selected component', async () => {
    const user = userEvent.setup()
    const { container } = renderApp(`${WORKSPACE_URL}?component=${COMPONENT_ID}`, {
      fetchImpl: workspaceServer(),
    })
    await waitForSettledWorkspace()

    // An arrangement the user made: a dragged split, a folded inspector and a
    // collapsed branch of the agent tree.
    useUiStore.getState().setLayout({
      'workspace-left': 24,
      'workspace-center': 46,
      'workspace-right': 30,
    })
    useUiStore.getState().setRightCollapsed(true)
    useUiStore.getState().setAgentCollapsed('subagent-implementer', true)
    useUiStore.getState().setMinimapVisible(false)
    await screen.findByTestId('pane-rail-right')

    const before = snapshotUi()

    await user.click(englishSegment())
    await screen.findByRole('heading', { name: 'Architecture' })

    expect(snapshotUi()).toEqual(before)
    // The pane really is still folded, not merely flagged as folded.
    expect(screen.getByTestId('pane-rail-right')).toBeInTheDocument()
    expect(container.querySelector('[data-reported]')).not.toBeNull()
  })

  it('leaves every reported value byte-identical across the switch', async () => {
    const user = userEvent.setup()
    const { container } = renderApp(`${WORKSPACE_URL}?component=${COMPONENT_ID}`, {
      fetchImpl: workspaceServer(),
    })
    await screen.findByTestId('inspector-context')
    await screen.findByTestId('agent-tree')
    await waitForSettledWorkspace()

    const before = reportedValues(container)
    expect(before.length).toBeGreaterThan(20)
    // The chrome really is German at this point, so the comparison below is
    // between two different languages and not between two identical renders.
    expect(screen.getByRole('heading', { name: 'Architektur' })).toBeVisible()

    await user.click(englishSegment())
    await screen.findByRole('heading', { name: 'Architecture' })

    // Same strings, same order, character for character — after the switch,
    // not after a second render.
    expect(reportedValues(container)).toEqual(before)
  })
})

describe('language switch — the canvas camera stays where it was', () => {
  it(
    'neither fits the view nor moves the viewport',
    async () => {
      const user = userEvent.setup()
      renderApp(WORKSPACE_URL, {
        fetchImpl: createFakeFetch({
          [runPaths.architecture]: largeArchitectureResponse,
        }),
      })

      const canvas = await waitForSettledWorkspace()

      const fitsBefore = canvas.getAttribute('data-fit-view-count')
      const transformBefore = viewportTransform()
      const cameraBefore = useUiStore.getState().camera
      expect(fitsBefore).toBe('1')
      expect(transformBefore).not.toBe('')

      await user.click(englishSegment())
      await screen.findByRole('heading', { name: 'Architecture' })
      await waitFor(() => expect(canvas.getAttribute('data-layouting')).toBe('false'), {
        timeout: CANVAS_TIMEOUT,
      })

      // The one automatic movement of a project's lifetime already happened;
      // a language is not a second reason for it.
      expect(canvas.getAttribute('data-fit-view-count')).toBe(fitsBefore)
      expect(viewportTransform()).toBe(transformBefore)
      expect(useUiStore.getState().camera).toEqual(cameraBefore)
    },
    CANVAS_TIMEOUT,
  )
})

describe('language switch — the page says which language it is in', () => {
  it('updates <html lang> without reloading', async () => {
    const user = userEvent.setup()
    const i18n = createI18n({ language: 'de' })
    const unbind = bindDocumentLanguage(i18n)
    renderApp('/projects', { i18n })

    await screen.findByRole('heading', { name: 'Projekte' })
    expect(document.documentElement.lang).toBe('de')

    await user.click(englishSegment())

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible()
    expect(document.documentElement.lang).toBe('en')
    unbind()
  })
})

describe('language switch — the choice is remembered', () => {
  it('writes the choice and starts the next visit in it', async () => {
    const user = userEvent.setup()
    renderApp('/projects')

    await screen.findByRole('heading', { name: 'Projekte' })
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()

    await user.click(englishSegment())
    await screen.findByRole('heading', { name: 'Projects' })
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')

    // The next visit — a fresh instance that decides its language the way
    // `main.tsx` does, from storage alone.
    expect(createI18n().language).toBe('en')
  })
})

describe('language switch — the control itself', () => {
  it('is operable with the keyboard alone and keeps the focus where it was used', async () => {
    const user = userEvent.setup()
    renderApp('/projects')
    await screen.findByRole('heading', { name: 'Projekte' })

    const english = englishSegment()
    english.focus()
    expect(english).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible()
    // The switch is not a navigation, so the button the user pressed is still
    // there and still has the focus — it is not dropped onto `<body>`.
    expect(screen.getByTestId('language-option-en')).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('reaches both segments with Tab and shows which one is active', async () => {
    const user = userEvent.setup()
    renderApp('/projects')
    await screen.findByRole('heading', { name: 'Projekte' })

    const german = screen.getByTestId('language-option-de')
    expect(german).toHaveAttribute('aria-pressed', 'true')
    expect(englishSegment()).toHaveAttribute('aria-pressed', 'false')

    german.focus()
    await user.tab()
    expect(englishSegment()).toHaveFocus()

    await user.keyboard(' ')
    await screen.findByRole('heading', { name: 'Projects' })
    expect(screen.getByTestId('language-option-en')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('language-option-de')).toHaveAttribute('aria-pressed', 'false')
  })

  it('names itself in the active language and its segments in their own', async () => {
    const user = userEvent.setup()
    renderApp('/projects')
    await screen.findByRole('heading', { name: 'Projekte' })

    expect(screen.getByRole('group', { name: 'Sprache' })).toBeInTheDocument()
    // A reader who ended up in a language they cannot read still has to find
    // their way out, so each segment is named in its own language.
    expect(screen.getByRole('button', { name: 'Deutsch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument()

    await user.click(englishSegment())
    await screen.findByRole('heading', { name: 'Projects' })

    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deutsch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument()
  })

  it('is reachable from the project list and from the workspace', async () => {
    const list = renderApp('/projects')
    await screen.findByRole('heading', { name: 'Projekte' })
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument()
    list.unmount()

    renderApp(WORKSPACE_URL, { fetchImpl: workspaceServer() })
    await waitForSettledWorkspace()
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument()
  })
})

/** The part of the UI store a language switch is forbidden to move. */
function snapshotUi() {
  const state = useUiStore.getState()
  return {
    layout: state.layout,
    leftCollapsed: state.leftCollapsed,
    rightCollapsed: state.rightCollapsed,
    collapsedAgentIds: state.collapsedAgentIds,
    collapsedComponentIds: state.collapsedComponentIds,
    minimapVisible: state.minimapVisible,
    camera: state.camera,
    selectedComponentId: state.selectedComponentId,
    deepFocus: state.deepFocus,
  }
}

/** The rendered zoom and pan — the ground truth of where the camera is. */
function viewportTransform(): string {
  return (
    document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? ''
  )
}

/** Resolves once the one automatic fit has run its course. */
async function waitForCameraSettled(): Promise<void> {
  await waitFor(() => expect(useUiStore.getState().camera.zoom).toBeGreaterThan(0), {
    timeout: CANVAS_TIMEOUT,
  })
  let previous = useUiStore.getState().camera
  await waitFor(
    () => {
      const current = useUiStore.getState().camera
      const settled = current === previous
      previous = current
      expect(settled).toBe(true)
    },
    { timeout: CANVAS_TIMEOUT, interval: 40 },
  )
}
