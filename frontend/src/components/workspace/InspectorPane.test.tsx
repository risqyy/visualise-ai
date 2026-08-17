import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type {
  ArchitectureResponse,
  ComponentHistoryResponse,
  ComponentInspectorResponse,
  ReportedDiff,
  Relationship,
} from '@/api/types'
import { applyLiveEvent } from '@/api/useLiveStream'
import {
  PROJECT_ID,
  RUN_ID,
  component,
  createFakeFetch,
  streamedEvent,
} from '@/test/fixtures'
import {
  ALL_DIFFS,
  CHANGE_DIFFS,
  CHANGE_ID,
  COMPONENT_ID,
  HISTORY_PATH,
  IMPLEMENTER_AGENT_ID,
  INSPECTOR_PATH,
  OLDER_RUN_ID,
  OTHER_CHANGE_ID,
  historyPage,
  inspectorPage,
  reportedDiff,
} from '@/test/inspectorFixtures'
import {
  activeChange,
  appliedComponent,
  appliedRelationship,
} from '@/test/architectureFixtures'
import { renderApp } from '@/test/renderApp'

const WORKSPACE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}`
const SELECTED_URL = `${WORKSPACE_URL}?component=${COMPONENT_ID}`
const ARCHITECTURE_PATH = `/api/v1/projects/${PROJECT_ID}/architecture`

/** The canvas runs ELK for real when a test clicks a node. */
const CANVAS_TIMEOUT = 15_000

/**
 * A read-API double that really pages the inspector.
 *
 * `diffCursor` is honoured, so "page through without a gap or a duplicate" is
 * exercised against cursor handling rather than against a single canned body.
 * Everything else is delegated to the shared fixture router.
 */
function inspectorServer(options: {
  pages?: ComponentInspectorResponse[]
  history?: ComponentHistoryResponse[]
  architecture?: ArchitectureResponse
} = {}) {
  const state = {
    pages: options.pages ?? [inspectorPage()],
    history: options.history ?? [historyPage()],
  }

  const base = createFakeFetch({
    [ARCHITECTURE_PATH]: options.architecture ?? {
      projectPosition: 42,
      components: [component({ componentId: COMPONENT_ID, name: 'Tax', kind: 'module' })],
      relationships: [],
      activeChanges: [],
    },
  })

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')

    if (url.pathname === INSPECTOR_PATH) {
      const cursor = url.searchParams.get('diffCursor')
      const index = cursor === null ? 0 : Number(cursor.replace('diff-page-', ''))
      const page = state.pages[index]
      if (!page) throw new Error(`no inspector page for cursor ${String(cursor)}`)
      return jsonResponse({
        ...page,
        nextDiffCursor:
          index + 1 < state.pages.length ? `diff-page-${index + 1}` : null,
      })
    }

    if (url.pathname === HISTORY_PATH) {
      const cursor = url.searchParams.get('cursor')
      const index = cursor === null ? 0 : Number(cursor.replace('history-page-', ''))
      const page = state.history[index]
      if (!page) throw new Error(`no history page for cursor ${String(cursor)}`)
      return jsonResponse({
        ...page,
        nextCursor: index + 1 < state.history.length ? `history-page-${index + 1}` : null,
      })
    }

    return base(input, init)
  }) as typeof fetch

  return {
    fetchImpl,
    /** Replaces what the server answers from now on, as a live change would. */
    publish(pages: ComponentInspectorResponse[]) {
      state.pages = pages
    },
  }
}

const RELATIONSHIP_SOURCE_ID = 'relationship-source'
const RELATIONSHIP_TARGET_ID = 'relationship-target'
const APPLIED_RELATIONSHIP_ID = 'relationship-applied'
const PROPOSED_RELATIONSHIP: Relationship = {
  relationshipId: 'relationship-proposed',
  sourceComponentId: RELATIONSHIP_SOURCE_ID,
  targetComponentId: RELATIONSHIP_TARGET_ID,
  kind: 'nats_topic',
  protocol: 'NATS',
  operation: 'publish',
  channel: 'orders.created',
  label: '',
}
const APPLIED_RELATIONSHIP = appliedRelationship({
  relationshipId: APPLIED_RELATIONSHIP_ID,
  sourceComponentId: RELATIONSHIP_SOURCE_ID,
  targetComponentId: RELATIONSHIP_TARGET_ID,
  kind: 'http',
  protocol: 'HTTP',
  operation: 'GET',
  label: 'Read orders',
})
const BUNDLED_APPLIED_RELATIONSHIP = appliedRelationship({
  relationshipId: 'relationship-applied-sibling',
  sourceComponentId: RELATIONSHIP_SOURCE_ID,
  targetComponentId: RELATIONSHIP_TARGET_ID,
  kind: 'nats_topic',
  protocol: 'NATS',
  operation: 'subscribe',
  channel: 'orders.cancelled',
  label: 'Read cancellations',
})
const RELATIONSHIP_ARCHITECTURE: ArchitectureResponse = {
  projectPosition: 42,
  components: [
    appliedComponent({
      componentId: RELATIONSHIP_SOURCE_ID,
      name: 'Relationship source',
      kind: 'service',
      parentComponentId: null,
    }),
    appliedComponent({
      componentId: RELATIONSHIP_TARGET_ID,
      name: 'Relationship target',
      kind: 'service',
      parentComponentId: null,
    }),
  ],
  relationships: [APPLIED_RELATIONSHIP],
  activeChanges: [
    activeChange({
      targetKind: 'relationship',
      targetId: PROPOSED_RELATIONSHIP.relationshipId,
      snapshot: PROPOSED_RELATIONSHIP as unknown as Record<string, unknown>,
    }),
  ],
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The `diff.reported` frame the backend sends for one file. */
function diffReported(diff: ReportedDiff, position: number) {
  return streamedEvent(
    'diff.reported',
    {
      diffId: diff.diffId,
      // The event payload omits `changeId` for an unattributed diff; the read
      // model reports the same thing as `null`.
      ...(diff.changeId === null ? {} : { changeId: diff.changeId }),
      componentIds: [COMPONENT_ID],
      filePath: diff.filePath,
      unifiedDiff: diff.unifiedDiff,
    },
    { position, agentId: IMPLEMENTER_AGENT_ID },
  )
}

async function renderInspector(url = SELECTED_URL, server = inspectorServer()) {
  const app = renderApp(url, { fetchImpl: server.fetchImpl })
  await screen.findByTestId('inspector-context')
  return { ...app, ...server }
}

// ---------------------------------------------------------------------------

describe('inspector — component selection', () => {
  it(
    'shows the feedback and every linked diff after a click on the component, without source navigation',
    async () => {
      const user = userEvent.setup()
      const server = inspectorServer()
      const { router } = renderApp(WORKSPACE_URL, { fetchImpl: server.fetchImpl })

      await screen.findByTestId(`canvas-node-${COMPONENT_ID}`, undefined, {
        timeout: CANVAS_TIMEOUT,
      })
      expect(screen.queryByTestId('inspector-context')).not.toBeInTheDocument()

      await user.click(screen.getByTestId(`canvas-node-${COMPONENT_ID}`))

      await waitFor(() =>
        expect(router.state.location.search).toEqual({ component: COMPONENT_ID }),
      )

      // The responsible agent, its task, its status and the run.
      const context = await screen.findByTestId('inspector-context')
      expect(context).toHaveAttribute('data-run-id', RUN_ID)
      expect(within(context).getByTestId('responsible-agent')).toHaveTextContent(
        'Implementer',
      )
      expect(within(context).getByTestId('agent-assigned-task')).toHaveTextContent(
        'Steuerlogik aus pricing extrahieren.',
      )
      expect(within(context).getByTestId('agent-status')).toHaveTextContent('arbeitet')
      expect(within(context).getByTestId('current-work-step')).toHaveTextContent(
        'Steuerlogik in ein eigenes Modul ziehen',
      )

      // The markdown feedback, rendered rather than shown as source.
      expect(await screen.findByText('Was ich angesehen habe')).toBeInTheDocument()
      expect(screen.getByTestId('safe-markdown').querySelector('pre')).not.toBeNull()

      // Every reported diff, with its file path and its changed lines.
      const diffs = screen.getAllByTestId('unified-diff')
      expect(diffs).toHaveLength(ALL_DIFFS.length)
      expect(diffs.map((diff) => diff.getAttribute('data-file-path')).sort()).toEqual(
        ALL_DIFFS.map((diff) => diff.filePath).sort(),
      )
      expect(
        within(diffs[0]!).getAllByText((_, element) =>
          (element?.getAttribute('data-line-kind') ?? '') === 'addition',
        ).length,
      ).toBeGreaterThan(0)
    },
    CANVAS_TIMEOUT,
  )

  it('renders cleanly for a component without feedback, diffs, risks or problems', async () => {
    await renderInspector(
      SELECTED_URL,
      inspectorServer({
        pages: [
          inspectorPage({
            feedback: [],
            diffs: [],
            risks: [],
            problems: [],
            activeChanges: [],
            currentWorkStep: null,
            responsibleAgent: null,
          }),
        ],
      }),
    )

    expect(screen.getByText('Kein Feedback gemeldet')).toBeInTheDocument()
    expect(screen.getByText('Keine Diffs gemeldet')).toBeInTheDocument()
    expect(screen.getByText('Keine Risiken gemeldet')).toBeInTheDocument()
    expect(screen.getByText('Keine Probleme gemeldet')).toBeInTheDocument()
    expect(screen.getByText('Keine offenen Vorschläge')).toBeInTheDocument()
    expect(screen.getByTestId('responsible-agent')).toHaveTextContent(
      'Kein verantwortlicher Agent belegt.',
    )
    expect(screen.queryByTestId('unified-diff')).not.toBeInTheDocument()
    expect(screen.queryByTestId('feedback-entry')).not.toBeInTheDocument()
  })

  it('shows its empty state and fires no request while nothing is selected', async () => {
    renderApp(WORKSPACE_URL, { fetchImpl: inspectorServer().fetchImpl })

    expect(await screen.findByText('Keine Komponente ausgewählt')).toBeInTheDocument()
    expect(screen.queryByTestId('inspector-context')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Belegquelle' })).not.toBeInTheDocument()
  })
})

describe('inspector — relationship selection', () => {
  it('shows the applied bundle members for parallel relationships', async () => {
    const server = inspectorServer({
      architecture: {
        ...RELATIONSHIP_ARCHITECTURE,
        relationships: [APPLIED_RELATIONSHIP, BUNDLED_APPLIED_RELATIONSHIP],
      },
    })
    renderApp(
      `${WORKSPACE_URL}?relationship=${APPLIED_RELATIONSHIP.relationshipId}`,
      { fetchImpl: server.fetchImpl },
    )

    const bundle = await screen.findByTestId('inspector-relationship-bundle')
    expect(bundle.querySelectorAll('li')).toHaveLength(2)
    expect(bundle).toHaveTextContent('HTTP · GET')
    expect(bundle).toHaveTextContent('NATS · orders.cancelled')
    expect(bundle.querySelector('[data-selected="true"]')).toHaveTextContent('HTTP · GET')
  })

  it('keeps applied and proposed edges separate when their endpoints match', async () => {
    const server = inspectorServer({ architecture: RELATIONSHIP_ARCHITECTURE })
    renderApp(
      `${WORKSPACE_URL}?relationship=${PROPOSED_RELATIONSHIP.relationshipId}`,
      { fetchImpl: server.fetchImpl },
    )

    const context = await screen.findByTestId('inspector-relationship-context')
    await waitFor(() => {
      expect(context).toHaveAttribute('data-relationship-id', PROPOSED_RELATIONSHIP.relationshipId)
      expect(context).toHaveTextContent(`NATS · ${PROPOSED_RELATIONSHIP.channel}`)
    })
    expect(screen.queryByTestId('inspector-relationship-bundle')).not.toBeInTheDocument()
  })
})

describe('inspector — unified diffs grouped by change, agent and run', () => {
  it('shows the three files of one changeId as one change and the others separately', async () => {
    await renderInspector()

    const groups = screen.getAllByTestId('diff-group')
    expect(groups).toHaveLength(3)

    const change = groups.find(
      (group) => group.getAttribute('data-change-id') === CHANGE_ID,
    )
    expect(change).toBeDefined()
    expect(change).toHaveAttribute('data-file-count', '3')
    expect(change).toHaveAttribute('data-agent-id', IMPLEMENTER_AGENT_ID)
    expect(change).toHaveAttribute('data-run-id', RUN_ID)
    expect(within(change!).getAllByTestId('unified-diff')).toHaveLength(3)
    expect(within(change!).getByText(`Änderung ${CHANGE_ID}`)).toBeInTheDocument()
    expect(within(change!).getByText('3 Dateien')).toBeInTheDocument()

    // A second change of the same run stays its own group.
    expect(
      groups.some((group) => group.getAttribute('data-change-id') === OTHER_CHANGE_ID),
    ).toBe(true)

    // The unattributed diff is not folded into any change.
    const unattributed = groups.find(
      (group) => group.getAttribute('data-change-id') === '',
    )
    expect(unattributed).toBeDefined()
    expect(unattributed).toHaveAttribute('data-file-count', '1')
    expect(within(unattributed!).getByText(/Ohne/)).toBeInTheDocument()
  })

  it('shows a diff with its file path and its additions and removals', async () => {
    await renderInspector()

    const diff = screen
      .getAllByTestId('unified-diff')
      .find(
        (element) =>
          element.getAttribute('data-file-path') ===
          'internal/orders/domain/pricing/pricing.go',
      )
    expect(diff).toBeDefined()

    const kinds = [...diff!.querySelectorAll('[data-line-kind]')].map((row) =>
      row.getAttribute('data-line-kind'),
    )
    expect(kinds).toContain('addition')
    expect(kinds).toContain('removal')
    expect(kinds).toContain('context')
    expect(within(diff!).getByText('+1')).toBeInTheDocument()
    expect(within(diff!).getByText('−1')).toBeInTheDocument()
  })
})

describe('inspector — diff pagination', () => {
  it('pages through every diff without a gap and without a duplicate', async () => {
    const user = userEvent.setup()
    // Two pages that deliberately overlap on `CHANGE_DIFFS[1]`, which is what
    // happens when the collection grows between two requests.
    await renderInspector(
      SELECTED_URL,
      inspectorServer({
        pages: [
          inspectorPage({ diffs: [ALL_DIFFS[0]!, ALL_DIFFS[1]!] }),
          inspectorPage({ diffs: [ALL_DIFFS[1]!, ...CHANGE_DIFFS], feedback: [] }),
        ],
      }),
    )

    expect(screen.getAllByTestId('unified-diff')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Weitere Diffs laden' }))

    await waitFor(() =>
      expect(screen.getAllByTestId('unified-diff')).toHaveLength(ALL_DIFFS.length),
    )

    const paths = screen
      .getAllByTestId('unified-diff')
      .map((element) => element.getAttribute('data-file-path'))
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.sort()).toEqual(ALL_DIFFS.map((diff) => diff.filePath).sort())

    // Last page reached: nothing left to fetch.
    expect(
      screen.queryByRole('button', { name: 'Weitere Diffs laden' }),
    ).not.toBeInTheDocument()

    // The non-paged collections keep coming from the first page.
    expect(screen.getAllByTestId('feedback-entry')).toHaveLength(1)
  })
})

describe('inspector — current run and history never mix', () => {
  it('defaults to the current run and keeps the history behind its own tab', async () => {
    const user = userEvent.setup()
    const { router } = await renderInspector()

    const tabs = screen.getByRole('tablist', { name: 'Belegquelle' })
    expect(within(tabs).getByRole('tab', { name: 'Aktueller Run' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('inspector-current-run')).toBeInTheDocument()
    expect(screen.queryByTestId('inspector-history')).not.toBeInTheDocument()

    await user.click(within(tabs).getByRole('tab', { name: 'Historie' }))

    const history = await screen.findByTestId('inspector-history')
    expect(history).toBeInTheDocument()
    // Nothing of the current run leaks into the history view.
    expect(screen.queryByTestId('inspector-current-run')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unified-diff')).not.toBeInTheDocument()
    expect(screen.queryByTestId('feedback-entry')).not.toBeInTheDocument()
    expect(router.state.location.search).toEqual({
      component: COMPONENT_ID,
      history: true,
    })

    // …and nothing of the history leaks back.
    await user.click(within(tabs).getByRole('tab', { name: 'Aktueller Run' }))
    await waitFor(() =>
      expect(screen.getByTestId('inspector-current-run')).toBeInTheDocument(),
    )
    expect(screen.queryByTestId('history-entry')).not.toBeInTheDocument()
  })

  it('keeps corrections and retractions as their own entries and overwrites nothing', async () => {
    const user = userEvent.setup()
    await renderInspector()

    await user.click(screen.getByRole('tab', { name: 'Historie' }))
    const entries = await screen.findAllByTestId('history-entry')

    expect(entries).toHaveLength(4)

    const correction = entries.find(
      (entry) => entry.getAttribute('data-entry-kind') === 'correction',
    )
    const retraction = entries.find(
      (entry) => entry.getAttribute('data-entry-kind') === 'retraction',
    )
    expect(correction).toBeDefined()
    expect(retraction).toBeDefined()
    expect(correction).toHaveTextContent('Die Rundungsaussage war falsch herum formuliert.')
    expect(retraction).toHaveTextContent(
      'Der gemeldete Diff gehörte zu einer anderen Komponente.',
    )

    // The corrected and the retracted statements are still there, marked but
    // intact — a correction adds, it does not replace.
    const corrected = entries.find(
      (entry) => entry.getAttribute('data-corrected') === 'true',
    )
    const retracted = entries.find(
      (entry) => entry.getAttribute('data-retracted') === 'true',
    )
    expect(corrected).toHaveAttribute('data-event-type', 'feedback.published')
    expect(corrected).toHaveTextContent('später korrigiert')
    expect(retracted).toHaveAttribute('data-event-type', 'diff.reported')
    expect(retracted).toHaveTextContent('später zurückgezogen')

    // Every entry names its run, so an old one is never read as current.
    expect(entries.every((entry) => entry.getAttribute('data-run-id') === OLDER_RUN_ID)).toBe(
      true,
    )
  })
})

describe('inspector — deep focus', () => {
  it('enlarges the reading area without losing the architecture context', async () => {
    const user = userEvent.setup()
    await renderInspector()

    expect(screen.getByTestId('inspector-feedback')).toBeInTheDocument()
    expect(screen.getByTestId('inspector-diffs')).toBeInTheDocument()

    await user.click(
      within(screen.getByTestId('inspector-diffs')).getByRole('button', {
        name: 'Deep Focus',
      }),
    )

    await screen.findByTestId('deep-focus-banner')

    // The diffs get the whole pane: everything else in the run view steps aside.
    expect(screen.getByTestId('inspector-diffs')).toBeInTheDocument()
    expect(screen.queryByTestId('inspector-feedback')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inspector-risks')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('diff-group')).toHaveLength(3)

    // …while the architecture stays on screen, which is the whole point.
    expect(screen.getByTestId('pane-architecture')).toBeInTheDocument()
    expect(screen.getByTestId('inspector-context')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Beenden/ }))
    await waitFor(() =>
      expect(screen.getByTestId('inspector-feedback')).toBeInTheDocument(),
    )
  })
})

describe('inspector — live updates never disturb the reader', () => {
  it('keeps selection, run context and scroll position when a new diff arrives', async () => {
    const server = inspectorServer()
    const { router, queryClient } = await renderInspector(SELECTED_URL, server)

    const viewport = screen.getByTestId('inspector-scroll')
    // jsdom has no layout, so the scroll offset is made observable explicitly.
    Object.defineProperty(viewport, 'scrollTop', {
      value: 240,
      writable: true,
      configurable: true,
    })
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }))

    const readGroup = screen
      .getAllByTestId('diff-group')
      .find((group) => group.getAttribute('data-change-id') === CHANGE_ID)!
    const readGroupKey = readGroup.getAttribute('data-scroll-anchor')

    // A new diff arrives and lands *above* what is being read, because the read
    // API serves evidence newest first.
    const arriving = reportedDiff({
      diffId: 'diff-2026-08-04-0099',
      changeId: 'change-2026-08-04-0099',
      filePath: 'internal/orders/domain/tax/rounding.go',
      position: 44,
    })
    server.publish([inspectorPage({ diffs: [arriving, ...ALL_DIFFS] })])

    await act(async () => {
      applyLiveEvent(queryClient, diffReported(arriving, 44))
    })

    await waitFor(() => expect(screen.getAllByTestId('diff-group')).toHaveLength(4))

    // Selection: unchanged, in the URL and in the pane.
    expect(router.state.location.search).toEqual({ component: COMPONENT_ID })
    expect(screen.getByTestId('inspector-context')).toHaveAttribute(
      'data-component-id',
      COMPONENT_ID,
    )

    // Run context: unchanged, and still the current run rather than history.
    expect(screen.getByTestId('inspector-context')).toHaveAttribute('data-run-id', RUN_ID)
    expect(screen.getByTestId('inspector-current-run')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Aktueller Run' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Scroll position: the container was never remounted and never reset.
    expect(screen.getByTestId('inspector-scroll')).toBe(viewport)
    expect(viewport.scrollTop).toBe(240)

    // The group being read is still there, and still the same element.
    const stillThere = screen
      .getAllByTestId('diff-group')
      .find((group) => group.getAttribute('data-change-id') === CHANGE_ID)
    expect(stillThere).toBe(readGroup)
    expect(stillThere).toHaveAttribute('data-scroll-anchor', readGroupKey!)
  })
})
