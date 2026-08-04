import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ArchitectureResponse, Component } from '@/api/types'
import { applyLiveEvent } from '@/api/useLiveStream'
import { DEFAULT_CAMERA, useUiStore } from '@/state/uiStore'
import { WORK_STATES } from '@/state/workStates'
import {
  NESTED_COMPONENTS,
  NESTED_RELATIONSHIPS,
  SHIPPING_BUS_RELATIONSHIP,
  SHIPPING_COMPONENT,
  activeChange,
  architectureWithChanges,
  grownArchitectureResponse,
  nestedArchitectureResponse,
} from '@/test/architectureFixtures'
import { PROJECT_ID, RUN_ID, createFakeFetch, streamedEvent } from '@/test/fixtures'
import { renderApp } from '@/test/renderApp'

/**
 * The live change overlays end to end: a committed event goes through the real
 * SSE apply path, the read model refetches, and the canvas shows the reported
 * work state.
 *
 * Every assertion about *what a state looks like* deliberately reads
 * `data-work-state-label`, `data-border-style`, `data-operation` and the visible
 * text. None of them reads a colour — that is the point of the encoding, and a
 * test that checked a hue would prove the opposite of what is required.
 */

const WORKSPACE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}`
const ARCHITECTURE_PATH = `/api/v1/projects/${PROJECT_ID}/architecture`
const CANVAS_TIMEOUT = 15_000

const PAYMENTS_DESCRIPTOR: Component = {
  componentId: 'external.payments',
  name: 'Payment Provider',
  kind: 'external',
  parentComponentId: null,
}

/** The nested model after the payment provider and its edge were removed. */
const withoutPayments: ArchitectureResponse = {
  projectPosition: 70,
  components: NESTED_COMPONENTS.filter(
    (one) => one.componentId !== 'external.payments',
  ),
  relationships: NESTED_RELATIONSHIPS.filter((one) => one.relationshipId !== 'r-08'),
  activeChanges: [],
}

function architectureFetch(initial: ArchitectureResponse) {
  const state = { response: initial }
  const fetchImpl = createFakeFetch({
    get [ARCHITECTURE_PATH]() {
      return state.response
    },
  })
  return {
    fetchImpl,
    publish(next: ArchitectureResponse) {
      state.response = next
    },
  }
}

function renderCanvas(url = WORKSPACE_URL, initial = nestedArchitectureResponse) {
  const architecture = architectureFetch(initial)
  const app = renderApp(url, { fetchImpl: architecture.fetchImpl })
  return { ...app, ...architecture }
}

async function waitForCanvas(): Promise<HTMLElement> {
  const canvas = await screen.findByTestId('architecture-canvas', undefined, {
    timeout: CANVAS_TIMEOUT,
  })
  await waitFor(() => expect(canvas.getAttribute('data-layouting')).toBe('false'), {
    timeout: CANVAS_TIMEOUT,
  })
  return canvas
}

async function waitForSettledLayout(canvas: HTMLElement): Promise<void> {
  await waitFor(() => expect(canvas.getAttribute('data-layouting')).toBe('false'), {
    timeout: CANVAS_TIMEOUT,
  })
}

/** The overlay mark of one component node, or `null` when it carries none. */
function overlayMarkOf(componentId: string): HTMLElement | null {
  const node = screen.queryByTestId(`canvas-node-${componentId}`)
  if (!node) return null
  return within(node).queryByTestId(`overlay-mark-component-${componentId}`)
}

// ---------------------------------------------------------------------------
// The four states
// ---------------------------------------------------------------------------

describe('live change overlays — every state appears after its own event', () => {
  it(
    'geplant: a planned change is drawn as a proposal and leaves the applied model alone',
    async () => {
      const { queryClient, publish } = renderCanvas()
      const canvas = await waitForCanvas()

      const nodesBefore = canvas.getAttribute('data-node-count')
      const edgesBefore = canvas.getAttribute('data-edge-count')
      expect(nodesBefore).toBe(String(NESTED_COMPONENTS.length))
      expect(canvas.getAttribute('data-overlay-node-count')).toBe('0')
      expect(screen.queryByTestId('canvas-node-platform.core.shipping')).toBeNull()

      // A planned change never enters `components`/`relationships` — the read
      // API returns it under `activeChanges`, and this response says so.
      publish(architectureWithChanges([activeChange({ operation: 'add' })]))
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'component.change_planned',
            {
              changeId: 'change-0001',
              operation: 'add',
              component: SHIPPING_COMPONENT,
              rationale: 'Versand wird eigenständig.',
            },
            { position: 50, agentId: 'subagent-architecture-mapper' },
          ),
        )
      })

      const proposal = await screen.findByTestId(
        'canvas-node-platform.core.shipping',
        undefined,
        { timeout: CANVAS_TIMEOUT },
      )
      await waitForSettledLayout(canvas)

      // The applied model is byte-identical to what it was…
      expect(canvas.getAttribute('data-node-count')).toBe(nodesBefore)
      expect(canvas.getAttribute('data-edge-count')).toBe(edgesBefore)
      // …and the proposal is drawn next to it, marked as a proposal.
      expect(canvas.getAttribute('data-overlay-node-count')).toBe('1')
      expect(proposal).toHaveAttribute('data-work-state', 'planned')
      expect(proposal).toHaveAttribute('data-work-state-label', 'geplant')
      expect(proposal).toHaveAttribute('data-presence', 'proposal')
      expect(proposal).toHaveAttribute('data-applied', 'false')
      expect(overlayMarkOf('platform.core.shipping')).toHaveTextContent(
        'geplant · hinzufügen',
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'aktiv: a started work step marks the components it named',
    async () => {
      const { queryClient } = renderCanvas()
      const canvas = await waitForCanvas()

      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'work.step_started',
            {
              workStepId: 'work-1',
              title: 'Bestellungen umbauen',
              componentIds: ['platform.core.orders'],
            },
            { position: 51, agentId: 'subagent-implementer' },
          ),
        )
      })

      await waitFor(() =>
        expect(screen.getByTestId('canvas-node-platform.core.orders')).toHaveAttribute(
          'data-work-state',
          'active',
        ),
      )
      const node = screen.getByTestId('canvas-node-platform.core.orders')
      expect(node).toHaveAttribute('data-work-state-label', 'aktiv')
      expect(node).toHaveAttribute('data-presence', 'applied')
      // A running work step reports work, not an operation on the model.
      expect(node).toHaveAttribute('data-operation', 'none')
      expect(overlayMarkOf('platform.core.orders')).toHaveTextContent('aktiv')
      // The applied model did not change because work started on it.
      expect(canvas.getAttribute('data-node-count')).toBe(
        String(NESTED_COMPONENTS.length),
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'kürzlich angewandt: an applied change updates the model and keeps the component traceable',
    async () => {
      const { queryClient, publish } = renderCanvas()
      const canvas = await waitForCanvas()
      expect(canvas.getAttribute('data-node-count')).toBe(
        String(NESTED_COMPONENTS.length),
      )

      publish(grownArchitectureResponse)
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'component.change_applied',
            {
              changeId: 'change-0001',
              operation: 'add',
              component: SHIPPING_COMPONENT,
            },
            { position: 52, agentId: 'subagent-architecture-mapper' },
          ),
        )
      })

      const node = await screen.findByTestId(
        'canvas-node-platform.core.shipping',
        undefined,
        { timeout: CANVAS_TIMEOUT },
      )
      await waitForSettledLayout(canvas)

      // The applied model really grew — this is not an overlay any more.
      expect(canvas.getAttribute('data-node-count')).toBe(
        String(NESTED_COMPONENTS.length + 1),
      )
      expect(canvas.getAttribute('data-overlay-node-count')).toBe('0')
      expect(node).toHaveAttribute('data-work-state', 'recently_applied')
      expect(node).toHaveAttribute('data-work-state-label', 'kürzlich angewandt')
      expect(node).toHaveAttribute('data-presence', 'applied')
      expect(node).toHaveAttribute('data-applied', 'true')
      // The component reference stays readable: the mark names the operation and
      // its title names the agent that applied it.
      expect(overlayMarkOf('platform.core.shipping')).toHaveTextContent(
        'kürzlich angewandt · hinzugefügt',
      )
      expect(overlayMarkOf('platform.core.shipping')).toHaveAttribute(
        'title',
        expect.stringContaining('subagent-architecture-mapper'),
      )
      expect(within(node).getByTestId('node-name')).toHaveTextContent('Shipping')
    },
    CANVAS_TIMEOUT,
  )

  it(
    'Entfernung: a removed component stays visible as what disappeared',
    async () => {
      const { queryClient, publish } = renderCanvas()
      const canvas = await waitForCanvas()

      publish(withoutPayments)
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'component.change_applied',
            { operation: 'remove', component: PAYMENTS_DESCRIPTOR },
            { position: 53, agentId: 'subagent-architecture-mapper' },
          ),
        )
      })

      await waitFor(
        () =>
          expect(canvas.getAttribute('data-node-count')).toBe(
            String(NESTED_COMPONENTS.length - 1),
          ),
        { timeout: CANVAS_TIMEOUT },
      )
      await waitForSettledLayout(canvas)

      const ghost = screen.getByTestId('canvas-node-external.payments')
      expect(ghost).toHaveAttribute('data-work-state', 'removed')
      expect(ghost).toHaveAttribute('data-presence', 'ghost')
      expect(ghost).toHaveAttribute('data-applied', 'false')
      // Red is one channel. The dotted border, the label and the icon are three
      // more, and this assertion uses only those.
      expect(ghost).toHaveAttribute('data-border-style', 'dotted')
      expect(ghost).toHaveAttribute('data-work-state-label', 'entfernt')
      expect(ghost).toHaveAttribute('data-operation', 'remove')
      expect(overlayMarkOf('external.payments')).toHaveTextContent(
        'entfernt · entfernt',
      )
    },
    CANVAS_TIMEOUT,
  )
})

// ---------------------------------------------------------------------------
// Colour-independence
// ---------------------------------------------------------------------------

describe('live change overlays — distinguishable without colour', () => {
  it(
    'tells two proposals of the same colour apart by their words alone',
    async () => {
      const { queryClient, publish } = renderCanvas()
      const canvas = await waitForCanvas()

      publish(
        architectureWithChanges([
          activeChange({ changeId: 'change-add', operation: 'add' }),
          activeChange({
            changeId: 'change-remove',
            targetId: 'platform.db',
            operation: 'remove',
            agentId: 'subagent-implementer',
            position: 51,
          }),
        ]),
      )
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'component.change_planned',
            { changeId: 'change-add', operation: 'add', component: SHIPPING_COMPONENT },
            { position: 54 },
          ),
        )
      })

      await screen.findByTestId('canvas-node-platform.core.shipping', undefined, {
        timeout: CANVAS_TIMEOUT,
      })
      await waitForSettledLayout(canvas)

      const added = overlayMarkOf('platform.core.shipping')
      const removed = overlayMarkOf('platform.db')

      // Same state, therefore the same colour and the same border style…
      expect(added).toHaveAttribute('data-work-state', 'planned')
      expect(removed).toHaveAttribute('data-work-state', 'planned')
      expect(added?.getAttribute('data-border-style')).toBe(
        removed?.getAttribute('data-border-style'),
      )
      // …and still unmistakable, because the operation is written out.
      expect(added).toHaveTextContent('geplant · hinzufügen')
      expect(removed).toHaveTextContent('geplant · entfernen')
      expect(added).toHaveAttribute('data-operation', 'add')
      expect(removed).toHaveAttribute('data-operation', 'remove')
    },
    CANVAS_TIMEOUT,
  )

  it('gives the four states four distinct non-colour signatures', () => {
    // Label, icon and line style each separate all four states on their own, so
    // no state depends on being seen in colour.
    const signatures = WORK_STATES.map(
      (state) => `${state.label}|${state.borderStyle}|${state.strokeDasharray}`,
    )
    expect(new Set(signatures).size).toBe(4)
    expect(new Set(WORK_STATES.map((state) => state.icon)).size).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Concurrency, retraction, snapshots, camera, counter
// ---------------------------------------------------------------------------

describe('live change overlays — concurrent agents', () => {
  it(
    'shows both agents when two of them change the same component',
    async () => {
      const { queryClient, publish } = renderCanvas()
      await waitForCanvas()

      publish(
        architectureWithChanges([
          activeChange({
            changeId: 'change-a',
            targetId: 'platform.core.orders',
            operation: 'modify',
            agentId: 'subagent-implementer',
            position: 50,
          }),
          activeChange({
            changeId: 'change-b',
            targetId: 'platform.core.orders',
            operation: 'modify',
            agentId: 'subagent-reviewer',
            position: 51,
          }),
        ]),
      )
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'component.change_planned',
            {
              changeId: 'change-b',
              operation: 'modify',
              component: {
                componentId: 'platform.core.orders',
                name: 'Orders',
                kind: 'module',
                parentComponentId: 'platform.core',
              },
            },
            { position: 55, agentId: 'subagent-reviewer' },
          ),
        )
      })

      await waitFor(() =>
        expect(screen.getByTestId('canvas-node-platform.core.orders')).toHaveAttribute(
          'data-agent-count',
          '2',
        ),
      )

      const mark = overlayMarkOf('platform.core.orders')
      // The count is on screen, not only in the DOM…
      expect(mark).toHaveTextContent('2')
      // …and neither proposal was dropped in favour of the other.
      const title = mark?.getAttribute('title') ?? ''
      expect(title).toContain('subagent-implementer')
      expect(title).toContain('subagent-reviewer')
      expect(title).toContain('2 Agents')
    },
    CANVAS_TIMEOUT,
  )
})

describe('live change overlays — retraction', () => {
  it(
    'removes the overlay of a withdrawn proposal and keeps the model untouched',
    async () => {
      const { queryClient, publish } = renderCanvas(
        WORKSPACE_URL,
        architectureWithChanges([activeChange({ operation: 'add' })]),
      )
      const canvas = await waitForCanvas()

      const proposal = await screen.findByTestId('canvas-node-platform.core.shipping')
      expect(proposal).toHaveAttribute('data-presence', 'proposal')
      expect(canvas.getAttribute('data-node-count')).toBe(
        String(NESTED_COMPONENTS.length),
      )

      // The agent withdraws the proposal. The server stops reporting it under
      // `activeChanges`; the event log keeps both events.
      publish(nestedArchitectureResponse)
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'retraction.issued',
            {
              retractsClientEventId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
              reason: 'Versand bleibt vorerst in den Bestellungen.',
            },
            { position: 56 },
          ),
        )
      })

      await waitFor(
        () =>
          expect(
            screen.queryByTestId('canvas-node-platform.core.shipping'),
          ).not.toBeInTheDocument(),
        { timeout: CANVAS_TIMEOUT },
      )
      await waitForSettledLayout(canvas)

      // The applied model was never involved in any of this.
      expect(canvas.getAttribute('data-node-count')).toBe(
        String(NESTED_COMPONENTS.length),
      )
      expect(canvas.getAttribute('data-overlay-node-count')).toBe('0')
    },
    CANVAS_TIMEOUT,
  )
})

describe('live change overlays — a replacing snapshot', () => {
  it(
    'leaves consistent overlays behind: no ghost of something the snapshot contains',
    async () => {
      const { queryClient, publish } = renderCanvas()
      const canvas = await waitForCanvas()

      // First a removal, which leaves a ghost on the canvas.
      publish(withoutPayments)
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'component.change_applied',
            { operation: 'remove', component: PAYMENTS_DESCRIPTOR },
            { position: 57 },
          ),
        )
      })
      await waitFor(() =>
        expect(screen.getByTestId('canvas-node-external.payments')).toHaveAttribute(
          'data-presence',
          'ghost',
        ),
      )

      // Then a snapshot that contains the component again. A ghost of it would
      // now contradict the model on screen.
      publish(nestedArchitectureResponse)
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'architecture.snapshot_published',
            {
              snapshotId: 'snapshot-2',
              components: NESTED_COMPONENTS,
              relationships: NESTED_RELATIONSHIPS,
            },
            { position: 58 },
          ),
        )
      })

      await waitFor(
        () =>
          expect(screen.getByTestId('canvas-node-external.payments')).toHaveAttribute(
            'data-applied',
            'true',
          ),
        { timeout: CANVAS_TIMEOUT },
      )
      await waitForSettledLayout(canvas)

      expect(screen.getByTestId('canvas-node-external.payments')).not.toHaveAttribute(
        'data-work-state',
      )
      expect(canvas.getAttribute('data-overlay-node-count')).toBe('0')
      expect(canvas.getAttribute('data-node-count')).toBe(
        String(NESTED_COMPONENTS.length),
      )
      expect(screen.getByTestId('change-counter')).toHaveAttribute('data-total', '0')
    },
    CANVAS_TIMEOUT,
  )
})

describe('live change overlays — the camera and the selection stay put', () => {
  it(
    'draws a new proposal without moving zoom, pan or selection',
    async () => {
      const { queryClient, publish } = renderCanvas(
        `${WORKSPACE_URL}?component=platform.db`,
      )
      const canvas = await waitForCanvas()

      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
      await waitFor(
        () => expect(useUiStore.getState().camera).not.toEqual(DEFAULT_CAMERA),
        { timeout: CANVAS_TIMEOUT },
      )
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

      const cameraBefore = useUiStore.getState().camera
      const transformBefore =
        document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? ''
      expect(transformBefore).not.toBe('')

      // A proposed component *and* a proposed relationship: both add elements to
      // the picture, so the layout really does change under the camera.
      publish(
        architectureWithChanges([
          activeChange({ changeId: 'change-add', operation: 'add' }),
          activeChange({
            changeId: 'change-rel',
            targetKind: 'relationship',
            targetId: SHIPPING_BUS_RELATIONSHIP.relationshipId,
            agentId: 'subagent-architecture-mapper',
            snapshot: SHIPPING_BUS_RELATIONSHIP as unknown as Record<string, unknown>,
            position: 51,
          }),
        ]),
      )
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'component.change_planned',
            { changeId: 'change-add', operation: 'add', component: SHIPPING_COMPONENT },
            { position: 59 },
          ),
        )
      })

      await screen.findByTestId('canvas-node-platform.core.shipping', undefined, {
        timeout: CANVAS_TIMEOUT,
      })
      await waitForSettledLayout(canvas)

      expect(canvas.getAttribute('data-overlay-node-count')).toBe('1')
      expect(canvas.getAttribute('data-overlay-edge-count')).toBe('1')
      // Nothing about the camera or the selection moved with it.
      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
      expect(
        document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform,
      ).toBe(transformBefore)
      expect(useUiStore.getState().camera).toEqual(cameraBefore)
      expect(useUiStore.getState().selectedComponentId).toBe('platform.db')
      expect(screen.getByTestId('canvas-node-platform.db')).toHaveAttribute(
        'data-selected',
        'true',
      )
    },
    CANVAS_TIMEOUT,
  )
})

describe('live change overlays — the quiet counter', () => {
  it(
    'counts the running changes per state without demanding attention',
    async () => {
      const { queryClient, publish } = renderCanvas()
      await waitForCanvas()

      const counter = screen.getByTestId('change-counter')
      expect(counter).toHaveAttribute('data-total', '0')

      publish(
        architectureWithChanges([
          activeChange({ changeId: 'change-add', operation: 'add' }),
          activeChange({
            changeId: 'change-rel',
            targetKind: 'relationship',
            targetId: SHIPPING_BUS_RELATIONSHIP.relationshipId,
            snapshot: SHIPPING_BUS_RELATIONSHIP as unknown as Record<string, unknown>,
            position: 51,
          }),
        ]),
      )
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'component.change_planned',
            { changeId: 'change-add', operation: 'add', component: SHIPPING_COMPONENT },
            { position: 60 },
          ),
        )
        applyLiveEvent(
          queryClient,
          streamedEvent(
            'work.step_started',
            {
              workStepId: 'work-1',
              title: 'Bestellungen umbauen',
              componentIds: ['platform.core.orders'],
            },
            { position: 61, agentId: 'subagent-implementer' },
          ),
        )
      })

      await waitFor(() =>
        expect(screen.getByTestId('change-counter-planned')).toHaveAttribute(
          'data-count',
          '2',
        ),
      )
      expect(screen.getByTestId('change-counter-active')).toHaveAttribute(
        'data-count',
        '1',
      )
      expect(screen.getByTestId('change-counter')).toHaveTextContent('2geplant')
      expect(screen.getByTestId('change-counter')).toHaveTextContent('1aktiv')

      // Quiet by construction: no animation class anywhere on the counter, and
      // no live region that would interrupt a screen reader on every event.
      const html = screen.getByTestId('change-counter').outerHTML
      expect(html).not.toContain('animate-')
      expect(screen.getByTestId('change-counter')).not.toHaveAttribute('aria-live')
    },
    CANVAS_TIMEOUT,
  )
})
