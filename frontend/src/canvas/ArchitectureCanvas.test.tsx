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

  it(
    'keeps a nested edge label above its own SVG hit path',
    async () => {
      renderCanvas()
      await waitForCanvas()

      const label = await screen.findByTestId(`edge-bundle-${BUNDLE_EDGE_ID}`)
      const edgeGroup = document.querySelector<SVGGElement>(
        `.react-flow__edge[data-id="${BUNDLE_EDGE_ID}"]`,
      )
      const edgeSvg = edgeGroup?.closest('svg')
      const renderer = document.querySelector<HTMLElement>(
        '.react-flow__edgelabel-renderer',
      )

      expect(edgeSvg).not.toBeNull()
      expect(renderer).not.toBeNull()
      // The portal stays unstacked. The label itself carries the contextual
      // z-index, so a deeper parent chain cannot put its transparent SVG hit
      // path in front of the button.
      expect(renderer).not.toHaveStyle({ zIndex: '1' })
      expect(Number(label.style.zIndex)).toBeGreaterThan(
        Number(edgeSvg?.style.zIndex ?? 0),
      )
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
    'selects a single relationship from its line in the overview',
    async () => {
      const user = userEvent.setup()
      const { router } = renderCanvas()
      const canvas = await waitForCanvas()

      // The initial fit intentionally stays readable. Explicitly fitting the
      // whole model gives this test the actual overview interaction state.
      await user.click(screen.getByTestId('canvas-fit-view'))
      await waitFor(() => expect(canvas).toHaveAttribute('data-detail-level', 'overview'))

      // Individual labels stay hidden at overview so the graph does not become
      // a wall of long reported values. The line itself remains the hit target.
      expect(screen.queryByTestId('edge-label-r-01')).not.toBeInTheDocument()
      await user.click(
        screen.getByTestId('edge-path-rel:platform.api.http.router~>platform.core.orders'),
      )

      await waitFor(() =>
        expect(router.state.location.search).toEqual({ relationship: 'r-01' }),
      )
      expect(await screen.findByTestId('inspector-relationship-context')).toHaveAttribute(
        'data-relationship-id',
        'r-01',
      )
    },
    CANVAS_TIMEOUT,
  )

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
      // Opening a bundle is a disclosure action, not an implicit selection of
      // whichever relationship happens to be first in its list.
      expect(useUiStore.getState().selectedRelationshipId).toBeNull()

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
      await waitFor(() => {
        expect(screen.getByTestId('edge-path-r-06')).not.toHaveClass('opacity-25')
        expect(screen.getByTestId('edge-path-r-05')).toHaveClass('opacity-25')
        expect(screen.getByTestId('edge-path-r-07')).toHaveClass('opacity-25')
        expect(screen.getByTestId('edge-label-r-06')).not.toHaveClass('opacity-25')
        expect(screen.getByTestId('edge-label-r-05')).toHaveClass('opacity-25')
        expect(screen.getByTestId('edge-label-r-06')).toHaveAttribute('aria-current', 'true')
        expect(screen.getByTestId('edge-label-r-05')).not.toHaveAttribute('aria-current')
      })
    },
    CANVAS_TIMEOUT,
  )

  it(
    'writes an individual relationship selection to the URL and inspector',
    async () => {
      const user = userEvent.setup()
      const { router } = renderCanvas()
      await waitForCanvas()

      await user.click(await screen.findByTestId(`edge-bundle-${BUNDLE_EDGE_ID}`))
      await user.click(screen.getByTestId('edge-label-r-06'))

      await waitFor(() =>
        expect(router.state.location.search).toEqual({ relationship: 'r-06' }),
      )
      expect(await screen.findByTestId('inspector-relationship-context')).toHaveAttribute(
        'data-relationship-id',
        'r-06',
      )
      expect(screen.getByTestId('inspector-relationship-bundle')).toHaveTextContent(
        'NATS · orders.cancelled',
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'restores a relationship selection from a deep link without selecting a component',
    async () => {
      const { router } = renderCanvas(`${WORKSPACE_URL}?relationship=r-06`)
      await waitForCanvas()

      await waitFor(() =>
        expect(router.state.location.search).toEqual({ relationship: 'r-06' }),
      )
      expect(await screen.findByTestId('inspector-relationship-context')).toBeInTheDocument()
      expect(useUiStore.getState().selectedComponentId).toBeNull()
      expect(useUiStore.getState().selectedRelationshipId).toBe('r-06')
    },
    CANVAS_TIMEOUT,
  )

  it(
    'keeps the canvas undimmed for a valid-looking but missing relationship id',
    async () => {
      const { router } = renderCanvas(`${WORKSPACE_URL}?relationship=not-in-snapshot`)
      await waitForCanvas()

      await waitFor(() =>
        expect(router.state.location.search).toEqual({
          relationship: 'not-in-snapshot',
        }),
      )
      expect(await screen.findByTestId('inspector-relationship-context')).toHaveTextContent(
        'nicht im aktuellen Architektur-Snapshot',
      )
      expect(
        screen.getByTestId('edge-path-rel:platform.api.http.router~>platform.core.orders'),
      ).not.toHaveClass('opacity-25')
      expect(screen.getByTestId('canvas-node-platform.db')).not.toHaveAttribute(
        'data-relationship-selected',
        'true',
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'does not resurrect a stale store relationship when the URL has no selection',
    async () => {
      useUiStore.getState().setSelectedRelationshipId('r-06')
      const { router } = renderCanvas()
      await waitForCanvas()

      expect(router.state.location.search).toEqual({})
      expect(
        screen.getByTestId('edge-path-rel:platform.api.http.router~>platform.core.orders'),
      ).not.toHaveClass('opacity-25')
      expect(
        screen.getByTestId('edge-path-rel:platform.core.orders~>platform.bus'),
      ).not.toHaveClass('opacity-25')
    },
    CANVAS_TIMEOUT,
  )

  it(
    'clears a selected relationship when Escape is pressed on the folded bundle control',
    async () => {
      const user = userEvent.setup()
      const { router } = renderCanvas(`${WORKSPACE_URL}?relationship=r-06`)
      await waitForCanvas()

      const bundle = await screen.findByTestId(`edge-bundle-${BUNDLE_EDGE_ID}`)
      act(() => bundle.focus())
      await user.keyboard('{Escape}')

      await waitFor(() => expect(router.state.location.search).toEqual({}))
      expect(useUiStore.getState().selectedRelationshipId).toBeNull()
      expect(document.activeElement).toBe(bundle)
    },
    CANVAS_TIMEOUT,
  )
})

describe('architecture canvas — selection', () => {
  it(
    'searches name, kind, technology, tags and id, then selects the result',
    async () => {
      const user = userEvent.setup()
      const { router } = renderCanvas()
      await waitForCanvas()

      await user.click(screen.getByTestId('canvas-component-search'))
      const input = screen.getByTestId('canvas-component-search-input')
      expect(
        screen.getByText('Nach Name, Art, Technologie, Tag oder Komponenten-ID suchen.'),
      ).toBeVisible()

      input.focus()
      await user.keyboard('routing')
      const result = screen.getByTestId('canvas-component-search-result')
      expect(result).toHaveAttribute('data-component-id', 'platform.api.http.router')
      expect(result).toHaveTextContent('Router')
      expect(result).toHaveTextContent('Modul')
      expect(result).toHaveTextContent('Shop Platform / API Gateway / HTTP Layer')

      await user.click(result)
      await waitFor(() =>
        expect(router.state.location.search).toEqual({
          component: 'platform.api.http.router',
        }),
      )
      expect(screen.getByTestId('inspector-context')).toHaveAttribute(
        'data-component-id',
        'platform.api.http.router',
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'opens search with the command shortcut and reports an empty result state',
    async () => {
      const user = userEvent.setup()
      renderCanvas()
      await waitForCanvas()

      const trigger = screen.getByTestId('canvas-component-search')
      trigger.focus()
      await user.keyboard('{Control>}k{/Control}')
      const input = screen.getByTestId('canvas-component-search-input')
      input.focus()
      await user.keyboard('does-not-exist')

      expect(screen.getByText('Keine passende Komponente gefunden.')).toBeVisible()
      await user.keyboard('{Escape}')
      expect(screen.queryByTestId('canvas-component-search-input')).not.toBeInTheDocument()
    },
    CANVAS_TIMEOUT,
  )

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

  it(
    'uses the URL orientation and switches handles and camera explicitly',
    async () => {
      const user = userEvent.setup()
      const { router } = renderCanvas(`${WORKSPACE_URL}?layout=left-right`)
      const canvas = await waitForCanvas()

      expect(canvas).toHaveAttribute('data-layout-orientation', 'left-right')
      expect(
        document.querySelector('.react-flow__node[data-id="platform"] .react-flow__handle-right'),
      ).not.toBeNull()
      expect(canvas).toHaveAttribute('data-fit-view-count', '1')

      await user.click(screen.getByTestId('canvas-layout-top-down'))
      await waitFor(() =>
        expect(canvas).toHaveAttribute('data-layout-orientation', 'top-down'),
      )
      await waitFor(() => expect(canvas).toHaveAttribute('data-layouting', 'false'))
      await waitFor(() => expect(canvas).toHaveAttribute('data-fit-view-count', '2'))

      expect(router.state.location.search).toMatchObject({ layout: 'top-down' })
      expect(
        document.querySelector('.react-flow__node[data-id="platform"] .react-flow__handle-bottom'),
      ).not.toBeNull()
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
