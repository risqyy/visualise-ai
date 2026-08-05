import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { queryKeys } from '@/api/queryKeys'
import type { ArchitectureResponse } from '@/api/types'
import { applyLiveEvent } from '@/api/useLiveStream'
import { DEFAULT_CAMERA, useUiStore } from '@/state/uiStore'
import {
  BUNDLED_TOPIC_CHANNELS,
  NESTED_COMPONENTS,
  NESTED_RELATIONSHIPS,
  grownArchitectureResponse,
  nestedArchitectureResponse,
} from '@/test/architectureFixtures'
import { PROJECT_ID, RUN_ID, createFakeFetch, streamedEvent } from '@/test/fixtures'
import { renderApp } from '@/test/renderApp'

import { RELATIONSHIP_KIND_STYLES } from './relationshipKinds'

const WORKSPACE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}`
const ARCHITECTURE_PATH = `/api/v1/projects/${PROJECT_ID}/architecture`
const BUNDLE_EDGE_ID = 'rel:platform.core.orders~>platform.bus'

/** ELK runs for real in these tests; it needs a moment on a nested model. */
const CANVAS_TIMEOUT = 15_000

/**
 * A fetch double whose architecture response can be swapped, so a test can
 * simulate a live update that really changes the model.
 */
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

/**
 * Renders the canvas with every container open.
 *
 * A project opens on its top levels with deeper containers collapsed (#34 /
 * ADR 0017), which is what `ArchitectureZoom.test.tsx` covers. The assertions
 * in this file are about bundling, selection and the camera on components that
 * sit three and four levels down, so they start from the state the user reaches
 * with "Gesamtes Modell einpassen" — a real, reachable state, and the one these
 * tests have always described.
 */
function renderCanvas(url = WORKSPACE_URL, initial = nestedArchitectureResponse) {
  const architecture = architectureFetch(initial)
  const app = renderApp(url, {
    fetchImpl: architecture.fetchImpl,
    expandAllComponents: true,
  })
  return { ...app, ...architecture }
}

/** Resolves once the first ELK layout landed. */
async function waitForCanvas(): Promise<HTMLElement> {
  const canvas = await screen.findByTestId('architecture-canvas', undefined, {
    timeout: CANVAS_TIMEOUT,
  })
  await waitFor(
    () => expect(canvas.getAttribute('data-layouting')).toBe('false'),
    { timeout: CANVAS_TIMEOUT },
  )
  await waitForInitialFit(canvas)
  return canvas
}

/**
 * `data-layouting: false` only says that ELK is done.
 *
 * The automatic camera placement runs in an effect *after* the layout, so the
 * first `fitView` — and with it `data-fit-view-count`, the viewport transform
 * and the stored camera — is still one commit away when the flag flips.
 * Reading any of the three synchronously at that moment is a race that goes red
 * exactly when the machine is busy and green on every quiet developer laptop.
 */
async function waitForInitialFit(canvas: HTMLElement): Promise<void> {
  await waitFor(
    () => expect(Number(canvas.getAttribute('data-fit-view-count'))).toBeGreaterThan(0),
    { timeout: CANVAS_TIMEOUT },
  )
}

/** The rendered zoom and pan — the ground truth of where the camera is. */
function viewportTransform(): string {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
  return viewport?.style.transform ?? ''
}

/**
 * Resolves once the camera stopped moving, i.e. once the one automatic fit of
 * the first model has run its course. Everything after this point must leave
 * the camera alone.
 */
async function waitForCameraSettled(): Promise<void> {
  // The initial fit always moves the camera off the default for this fixture.
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
}

describe('architecture canvas — rendering', () => {
  it(
    'renders every component of the nested snapshot as a node',
    async () => {
      renderCanvas()
      const canvas = await waitForCanvas()

      expect(canvas.getAttribute('data-node-count')).toBe(
        String(NESTED_COMPONENTS.length),
      )

      for (const component of NESTED_COMPONENTS) {
        const node = await screen.findByTestId(`canvas-node-${component.componentId}`)
        expect(within(node).getByTestId('node-name')).toHaveTextContent(component.name)
      }

      // Containers render as compound nodes, leaves do not.
      expect(screen.getByTestId('canvas-node-platform')).toHaveAttribute(
        'data-compound',
        'true',
      )
      expect(
        screen.getByTestId('canvas-node-platform.api.http.router'),
      ).not.toHaveAttribute('data-compound')
    },
    CANVAS_TIMEOUT,
  )

  it(
    'draws one edge per node pair and keeps all eight relationships',
    async () => {
      renderCanvas()
      const canvas = await waitForCanvas()

      // Six pairs carry eight relationships — three NATS topics share a pair.
      expect(canvas.getAttribute('data-edge-count')).toBe('6')
      expect(NESTED_RELATIONSHIPS).toHaveLength(8)
    },
    CANVAS_TIMEOUT,
  )
})

describe('architecture canvas — colour-independent relationship kinds', () => {
  it('gives every kind a unique stroke pattern, an arrow head and a badge', () => {
    const dashArrays = RELATIONSHIP_KIND_STYLES.map((style) => style.strokeDasharray)
    const abbreviations = RELATIONSHIP_KIND_STYLES.map((style) => style.abbreviation)

    expect(RELATIONSHIP_KIND_STYLES).toHaveLength(6)
    // The stroke pattern alone already separates all six kinds…
    expect(new Set(dashArrays).size).toBe(6)
    // …and so does the badge text.
    expect(new Set(abbreviations).size).toBe(6)
    // Two different arrow heads add a third channel.
    expect(new Set(RELATIONSHIP_KIND_STYLES.map((style) => style.marker)).size).toBe(2)
    // None of the styles carries a colour at all: colour is reserved for the
    // work states, so a kind must survive a greyscale screenshot.
    for (const style of RELATIONSHIP_KIND_STYLES) {
      expect(Object.keys(style)).not.toContain('color')
      expect(Object.keys(style)).not.toContain('colorVar')
    }
  })

  it(
    'renders the drawn edge with its kind as stroke pattern and marker, not colour',
    async () => {
      renderCanvas()
      await waitForCanvas()

      // `platform.core.orders -> platform.db` is the single `data` edge.
      const path = await screen.findByTestId(
        'edge-path-rel:platform.core.orders~>platform.db',
      )
      expect(path).toHaveAttribute('data-relationship-kind', 'data')
      expect(path).toHaveAttribute('stroke-dasharray', '2 4')
      expect(path.getAttribute('marker-end')).toContain('vai-edge-marker-arrow')
      // The stroke itself is the neutral graphite of every edge.
      expect(path).toHaveAttribute('stroke', 'currentColor')
      expect(path.getAttribute('class')).toContain('text-muted-foreground')
    },
    CANVAS_TIMEOUT,
  )

  it('lists all six kinds in the legend with their line style and marker', async () => {
    renderCanvas()
    await waitForCanvas()

    for (const style of RELATIONSHIP_KIND_STYLES) {
      const entry = screen.getByTestId(`relationship-legend-${style.id}`)
      expect(entry).toHaveAttribute('data-dasharray', style.strokeDasharray)
      expect(entry).toHaveAttribute('data-marker', style.marker)
      expect(entry).toHaveTextContent(style.abbreviation)
    }
  })
})

describe('architecture canvas — edge bundling stays resolvable', () => {
  it(
    'bundles the three NATS topics and makes each of them reachable by clicking',
    async () => {
      const user = userEvent.setup()
      renderCanvas()
      await waitForCanvas()

      // Folded: one collector edge carrying the count.
      const bundle = await screen.findByTestId(`edge-bundle-${BUNDLE_EDGE_ID}`)
      expect(bundle).toHaveTextContent('3 × NATS')
      for (const channel of BUNDLED_TOPIC_CHANNELS) {
        expect(screen.queryByText(new RegExp(channel))).not.toBeInTheDocument()
      }

      // Unfolding it is an interaction on the canvas, available at any zoom.
      await user.click(bundle)

      // Every single topic is now individually addressable, labelled with its
      // own channel — the bundle was a rendering, never a merge.
      for (const relationshipId of ['r-05', 'r-06', 'r-07']) {
        const label = screen.getByTestId(`edge-label-${relationshipId}`)
        const channel = NESTED_RELATIONSHIPS.find(
          (relationship) => relationship.relationshipId === relationshipId,
        )?.channel
        expect(channel).toBeTruthy()
        expect(label).toHaveTextContent(`NATS · ${channel}`)
        expect(label).toHaveAttribute('title', expect.stringContaining('publish'))

        const path = screen.getByTestId(`edge-path-${relationshipId}`)
        expect(path).toHaveAttribute('data-relationship-kind', 'nats_topic')
      }

      // The three lines are drawn as separate, parallel paths.
      const paths = ['r-05', 'r-06', 'r-07'].map((id) =>
        screen.getByTestId(`edge-path-${id}`).getAttribute('d'),
      )
      expect(new Set(paths).size).toBe(3)

      // Folding it again returns to the collector edge.
      await user.click(screen.getByTestId(`edge-collapse-${BUNDLE_EDGE_ID}`))
      expect(screen.getByTestId(`edge-bundle-${BUNDLE_EDGE_ID}`)).toBeInTheDocument()
      expect(screen.queryByTestId('edge-label-r-05')).not.toBeInTheDocument()
    },
    CANVAS_TIMEOUT,
  )

  it(
    'selecting one topic of an unfolded bundle marks exactly that relationship',
    async () => {
      const user = userEvent.setup()
      renderCanvas()
      await waitForCanvas()

      await user.click(await screen.findByTestId(`edge-bundle-${BUNDLE_EDGE_ID}`))
      await user.click(screen.getByTestId('edge-label-r-06'))

      expect(useUiStore.getState().selectedRelationshipId).toBe('r-06')
    },
    CANVAS_TIMEOUT,
  )
})

describe('architecture canvas — selection', () => {
  it(
    'writes the clicked component into the `component` search parameter',
    async () => {
      const user = userEvent.setup()
      const { router } = renderCanvas()
      await waitForCanvas()

      expect(router.state.location.search).toEqual({})

      await user.click(await screen.findByTestId('canvas-node-platform.core.orders'))

      await waitFor(() =>
        expect(router.state.location.search).toEqual({
          component: 'platform.core.orders',
        }),
      )

      // The URL is the single source of truth; the canvas mirrors it back.
      await waitFor(() =>
        expect(screen.getByTestId('canvas-node-platform.core.orders')).toHaveAttribute(
          'data-selected',
          'true',
        ),
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'restores the selection from a deep link without a click',
    async () => {
      renderCanvas(`${WORKSPACE_URL}?component=platform.db`)
      await waitForCanvas()

      await waitFor(() =>
        expect(screen.getByTestId('canvas-node-platform.db')).toHaveAttribute(
          'data-selected',
          'true',
        ),
      )
    },
    CANVAS_TIMEOUT,
  )
})

describe('architecture canvas — live updates never move the camera', () => {
  it(
    'keeps zoom, pan and selection when the architecture is replaced live',
    async () => {
      const { queryClient, publish } = renderCanvas(
        `${WORKSPACE_URL}?component=platform.db`,
      )
      const canvas = await waitForCanvas()

      // The one automatic camera movement: the first model of this project.
      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
      await waitForCameraSettled()

      const cameraBefore = useUiStore.getState().camera
      const transformBefore = viewportTransform()
      expect(transformBefore).not.toBe('')
      expect(useUiStore.getState().selectedComponentId).toBe('platform.db')

      // A real live event: a replacing architecture snapshot, routed through
      // the very same code path the SSE client uses.
      publish(grownArchitectureResponse)
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent('architecture.snapshot_published', {
            snapshotId: 'snapshot-2',
            components: grownArchitectureResponse.components,
            relationships: grownArchitectureResponse.relationships,
          }),
        )
      })

      // The new component really arrived…
      expect(
        await screen.findByTestId('canvas-node-platform.core.shipping', undefined, {
          timeout: CANVAS_TIMEOUT,
        }),
      ).toBeInTheDocument()
      await waitFor(
        () => expect(canvas.getAttribute('data-layouting')).toBe('false'),
        { timeout: CANVAS_TIMEOUT },
      )

      // …and nothing about the camera or the selection moved with it.
      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
      expect(viewportTransform()).toBe(transformBefore)
      expect(useUiStore.getState().camera).toEqual(cameraBefore)
      expect(useUiStore.getState().selectedComponentId).toBe('platform.db')
      expect(screen.getByTestId('canvas-node-platform.db')).toHaveAttribute(
        'data-selected',
        'true',
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'fits the view again only when the user asks for it',
    async () => {
      const user = userEvent.setup()
      renderCanvas()
      const canvas = await waitForCanvas()

      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
      await user.click(screen.getByTestId('canvas-fit-view'))
      expect(canvas.getAttribute('data-fit-view-count')).toBe('2')
    },
    CANVAS_TIMEOUT,
  )
})

describe('architecture canvas — temporary node positions', () => {
  it(
    'keeps a dragged position out of the server state and out of the model',
    async () => {
      const { queryClient } = renderCanvas()
      await waitForCanvas()

      const cached = () =>
        queryClient.getQueryData<ArchitectureResponse>(queryKeys.architecture(PROJECT_ID))
      const before = structuredClone(cached())
      expect(before?.components).toHaveLength(NESTED_COMPONENTS.length)

      // What `onNodeDragStop` does: local UI state, nothing else.
      act(() => {
        useUiStore.getState().setNodePosition('external.payments', { x: 1234, y: 567 })
      })

      expect(useUiStore.getState().nodePositions).toEqual({
        'external.payments': { x: 1234, y: 567 },
      })
      // It really moves on screen…
      await waitFor(() =>
        expect(
          document.querySelector<HTMLElement>(
            '.react-flow__node[data-id="external.payments"]',
          )?.style.transform,
        ).toBe('translate(1234px,567px)'),
      )
      // The cached read model is byte-for-byte what the API returned.
      expect(cached()).toEqual(before)
      expect(JSON.stringify(cached())).not.toContain('1234')

      // A refetch brings the reported model back untouched — a drag can never
      // be mistaken for a domain change.
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: queryKeys.architecture(PROJECT_ID) })
      })
      expect(cached()).toEqual(before)

      // The drag is also not persisted: only layout-ish UI state is.
      const persisted = JSON.parse(localStorage.getItem('visualise-ai.ui') ?? '{}')
      expect(JSON.stringify(persisted)).not.toContain('nodePositions')

      // And it can be undone without touching the model.
      const reset = await screen.findByTestId('canvas-reset-positions')
      act(() => reset.click())
      expect(useUiStore.getState().nodePositions).toEqual({})
      expect(cached()).toEqual(before)
      await waitFor(() =>
        expect(
          document.querySelector<HTMLElement>(
            '.react-flow__node[data-id="external.payments"]',
          )?.style.transform,
        ).not.toBe('translate(1234px,567px)'),
      )
    },
    CANVAS_TIMEOUT,
  )
})
