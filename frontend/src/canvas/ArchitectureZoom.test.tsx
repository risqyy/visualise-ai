import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { ArchitectureResponse } from '@/api/types'
import { applyLiveEvent } from '@/api/useLiveStream'
import { useUiStore } from '@/state/uiStore'
import {
  LARGE_COMPONENTS,
  LARGE_DEEP_ANCESTORS,
  LARGE_DEEP_COMPONENT_ID,
  activeChange,
  largeArchitectureResponse,
  largeGrownArchitectureResponse,
} from '@/test/architectureFixtures'
import { PROJECT_ID, RUN_ID, createFakeFetch, streamedEvent } from '@/test/fixtures'
import { renderApp } from '@/test/renderApp'

import {
  MIN_LEGIBLE_FONT_SIZE_PX,
  MIN_READABLE_ZOOM,
  NODE_LABEL_FONT_SIZE_PX,
} from './detailLevel'
import { LEAF_NODE_SIZE } from './graphProjection'

/**
 * The readable entry point (#34).
 *
 * Everything here is asserted on a model of **32 components over four levels**,
 * because that is where the old behaviour broke: fitting all of it put the
 * camera at a zoom where a node was 46 × 20 px and its name rendered at 2.6 px.
 *
 * Two mechanisms have to hold together, and both are checked as *numbers* on
 * the rendered surface rather than as intentions:
 *
 * 1. the automatic camera never falls below `MIN_READABLE_ZOOM`,
 * 2. a project opens on its top levels, and everything below stays reachable.
 *
 * And neither of them may cost the property the rest of the canvas is built
 * on: after the first picture, the camera belongs to the user.
 */

const WORKSPACE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}`
const ARCHITECTURE_PATH = `/api/v1/projects/${PROJECT_ID}/architecture`
const CANVAS_TIMEOUT = 15_000

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

function renderLargeModel(url = WORKSPACE_URL) {
  const architecture = architectureFetch(largeArchitectureResponse)
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

describe('architecture canvas — a large model opens readable', () => {
  it(
    'never opens below the readable zoom, however many components there are',
    async () => {
      expect(LARGE_COMPONENTS.length).toBeGreaterThanOrEqual(30)

      renderLargeModel()
      const canvas = await waitForCanvas()
      await waitForCameraSettled()

      const { zoom } = useUiStore.getState().camera

      // The acceptance criterion, as a measurement: the name of a visible
      // component is at least as large as the smallest type the product
      // renders anywhere else.
      expect(zoom).toBeGreaterThanOrEqual(MIN_READABLE_ZOOM)
      expect(NODE_LABEL_FONT_SIZE_PX * zoom).toBeGreaterThanOrEqual(
        MIN_LEGIBLE_FONT_SIZE_PX,
      )
      expect(LEAF_NODE_SIZE.width * zoom).toBeGreaterThanOrEqual(175)
      expect(LEAF_NODE_SIZE.height * zoom).toBeGreaterThanOrEqual(73)

      // Still exactly one automatic camera movement.
      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
    },
    CANVAS_TIMEOUT,
  )

  it(
    'shows the system and container level and keeps the rest one click away',
    async () => {
      const user = userEvent.setup()
      renderLargeModel()
      const canvas = await waitForCanvas()

      // The reported model is still the whole model — collapsing hides
      // components, it does not remove them.
      expect(canvas.getAttribute('data-node-count')).toBe(String(LARGE_COMPONENTS.length))
      expect(canvas.getAttribute('data-visible-node-count')).toBe('8')
      expect(canvas.getAttribute('data-hidden-node-count')).toBe(
        String(LARGE_COMPONENTS.length - 8),
      )

      // The top level is drawn…
      expect(screen.getByTestId('canvas-node-mesh.s1')).toHaveAttribute(
        'data-collapsed',
        'true',
      )
      expect(screen.getByTestId('canvas-node-mesh.s1')).toHaveAttribute(
        'data-hidden-count',
        '6',
      )
      // …and what is inside it is not.
      expect(screen.queryByTestId(`canvas-node-${LARGE_DEEP_COMPONENT_ID}`)).toBeNull()

      // Opening one container reveals its children and nothing else.
      await user.click(screen.getByTestId('node-disclosure-mesh.s1'))
      await waitFor(
        () => expect(canvas.getAttribute('data-layouting')).toBe('false'),
        { timeout: CANVAS_TIMEOUT },
      )

      expect(await screen.findByTestId('canvas-node-mesh.s1.a')).toBeInTheDocument()
      expect(screen.queryByTestId('canvas-node-mesh.s2.a')).toBeNull()
      // Opening a container is not a reason to move the camera.
      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
    },
    CANVAS_TIMEOUT,
  )

  it(
    'keeps a hidden relationship visible by lifting it onto the container',
    async () => {
      renderLargeModel()
      await waitForCanvas()

      // `mesh.s1.a.l1 → mesh.db` is reported between two components, one of
      // which is inside a closed container. The edge is drawn on the container,
      // and it still carries both of the relationships it stands for.
      const bundle = await screen.findByTestId('edge-bundle-rel:mesh.s1~>mesh.db')
      expect(bundle).toBeInTheDocument()
      expect(bundle).toHaveTextContent('2')
    },
    CANVAS_TIMEOUT,
  )
})

describe('architecture canvas — hiding a component never hides the work on it', () => {
  it(
    'shows the state of a hidden component on the container that holds it',
    async () => {
      const architecture = architectureFetch({
        ...largeArchitectureResponse,
        activeChanges: [
          activeChange({
            changeId: 'change-deep-0001',
            targetKind: 'component',
            targetId: LARGE_DEEP_COMPONENT_ID,
            operation: 'remove',
            snapshot: LARGE_COMPONENTS.find(
              (one) => one.componentId === LARGE_DEEP_COMPONENT_ID,
            ) as unknown as Record<string, unknown>,
          }),
        ],
      })
      renderApp(WORKSPACE_URL, { fetchImpl: architecture.fetchImpl })
      await waitForCanvas()

      // The component the change is about is behind two closed containers…
      expect(screen.queryByTestId(`canvas-node-${LARGE_DEEP_COMPONENT_ID}`)).toBeNull()

      // …and the phase of the work on it is on the container the user can see.
      const container = await screen.findByTestId('canvas-node-mesh.s1')
      expect(container).toHaveAttribute('data-work-state', 'planned')
      expect(container).toHaveAttribute('data-overlay-rolled-up', 'true')

      // The *operation* is not rolled up: `geplant · entfernen` on the container
      // would claim the container is being removed.
      expect(container).toHaveAttribute('data-operation', 'none')
      expect(container).toHaveAttribute('data-work-state-label', 'geplant')
      // It is the container's own presence, not the proposal's.
      expect(container).toHaveAttribute('data-presence', 'applied')
    },
    CANVAS_TIMEOUT,
  )
})

describe('architecture canvas — the whole model stays one action away', () => {
  it(
    'expands everything and fits it when the user asks for the overview',
    async () => {
      const user = userEvent.setup()
      renderLargeModel()
      const canvas = await waitForCanvas()
      await waitForCameraSettled()

      await user.click(screen.getByTestId('canvas-fit-view'))
      await waitFor(
        () =>
          expect(canvas.getAttribute('data-hidden-node-count')).toBe('0'),
        { timeout: CANVAS_TIMEOUT },
      )
      await waitFor(
        () => expect(canvas.getAttribute('data-layouting')).toBe('false'),
        { timeout: CANVAS_TIMEOUT },
      )
      await waitFor(
        () => expect(canvas.getAttribute('data-fit-view-count')).toBe('2'),
        { timeout: CANVAS_TIMEOUT },
      )

      // Every component is now drawn…
      expect(canvas.getAttribute('data-visible-node-count')).toBe(
        String(LARGE_COMPONENTS.length),
      )
      expect(
        screen.getByTestId(`canvas-node-${LARGE_DEEP_COMPONENT_ID}`),
      ).toBeInTheDocument()
      // …and the camera was allowed below the readable zoom for it, because
      // this is the overview the user explicitly asked for.
      await waitFor(() =>
        expect(useUiStore.getState().camera.zoom).toBeLessThan(MIN_READABLE_ZOOM),
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'returns to the readable entry picture on request',
    async () => {
      const user = userEvent.setup()
      renderLargeModel()
      const canvas = await waitForCanvas()
      await waitForCameraSettled()

      await user.click(screen.getByTestId('canvas-fit-view'))
      await waitFor(() => expect(canvas.getAttribute('data-hidden-node-count')).toBe('0'), {
        timeout: CANVAS_TIMEOUT,
      })

      await user.click(screen.getByTestId('canvas-back-to-overview'))
      await waitFor(
        () => expect(canvas.getAttribute('data-visible-node-count')).toBe('8'),
        { timeout: CANVAS_TIMEOUT },
      )
      await waitFor(
        () =>
          expect(useUiStore.getState().camera.zoom).toBeGreaterThanOrEqual(
            MIN_READABLE_ZOOM,
          ),
        { timeout: CANVAS_TIMEOUT },
      )
    },
    CANVAS_TIMEOUT,
  )
})

describe('architecture canvas — a deep link reaches a deep component', () => {
  it(
    'opens the containers on the way, selects it and shows it in the inspector',
    async () => {
      renderLargeModel(`${WORKSPACE_URL}?component=${LARGE_DEEP_COMPONENT_ID}`)
      const canvas = await waitForCanvas()

      const node = await screen.findByTestId(
        `canvas-node-${LARGE_DEEP_COMPONENT_ID}`,
        undefined,
        { timeout: CANVAS_TIMEOUT },
      )
      expect(node).toHaveAttribute('data-selected', 'true')

      // Exactly the path to it was opened — its siblings' containers were not.
      for (const ancestor of LARGE_DEEP_ANCESTORS) {
        expect(screen.getByTestId(`canvas-node-${ancestor}`)).not.toHaveAttribute(
          'data-collapsed',
        )
      }
      expect(screen.getByTestId('canvas-node-mesh.s2')).toHaveAttribute(
        'data-collapsed',
        'true',
      )

      // URL, selection and inspector agree.
      expect(useUiStore.getState().selectedComponentId).toBe(LARGE_DEEP_COMPONENT_ID)
      expect(await screen.findByTestId('inspector-context')).toBeInTheDocument()

      // And it still cost exactly one camera movement.
      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
    },
    CANVAS_TIMEOUT,
  )

  it(
    'moves the selection up when the user closes the container holding it',
    async () => {
      const user = userEvent.setup()
      const { router } = renderLargeModel(
        `${WORKSPACE_URL}?component=${LARGE_DEEP_COMPONENT_ID}`,
      )
      await waitForCanvas()
      await screen.findByTestId(`canvas-node-${LARGE_DEEP_COMPONENT_ID}`, undefined, {
        timeout: CANVAS_TIMEOUT,
      })

      await user.click(screen.getByTestId('node-disclosure-mesh.s1'))

      // The URL never points at something that is not on screen.
      await waitFor(() =>
        expect(router.state.location.search).toEqual({ component: 'mesh.s1' }),
      )
      await waitFor(() =>
        expect(screen.getByTestId('canvas-node-mesh.s1')).toHaveAttribute(
          'data-collapsed',
          'true',
        ),
      )
      expect(screen.queryByTestId(`canvas-node-${LARGE_DEEP_COMPONENT_ID}`)).toBeNull()
    },
    CANVAS_TIMEOUT,
  )
})

describe('architecture canvas — the user keeps the camera', () => {
  it(
    'leaves an explicitly chosen camera alone when an event arrives',
    async () => {
      const user = userEvent.setup()
      const { queryClient, publish } = renderLargeModel(
        `${WORKSPACE_URL}?component=mesh.db`,
      )
      const canvas = await waitForCanvas()
      await waitForCameraSettled()

      // The user takes the camera over with the one action that is allowed to
      // move it: the explicit overview.
      await user.click(screen.getByTestId('canvas-fit-view'))
      await waitFor(() => expect(canvas.getAttribute('data-hidden-node-count')).toBe('0'), {
        timeout: CANVAS_TIMEOUT,
      })
      await waitFor(
        () => expect(canvas.getAttribute('data-layouting')).toBe('false'),
        { timeout: CANVAS_TIMEOUT },
      )
      await waitForCameraSettled()

      const cameraBefore = useUiStore.getState().camera
      const transformBefore = viewportTransform()
      const fitsBefore = canvas.getAttribute('data-fit-view-count')
      expect(transformBefore).not.toBe('')

      // A real structural live update through the SSE apply path.
      publish(largeGrownArchitectureResponse)
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent('architecture.snapshot_published', {
            snapshotId: 'snapshot-large-2',
            components: largeGrownArchitectureResponse.components,
            relationships: largeGrownArchitectureResponse.relationships,
          }),
        )
      })

      expect(
        await screen.findByTestId('canvas-node-mesh.s1.a.l3', undefined, {
          timeout: CANVAS_TIMEOUT,
        }),
      ).toBeInTheDocument()
      await waitFor(
        () => expect(canvas.getAttribute('data-layouting')).toBe('false'),
        { timeout: CANVAS_TIMEOUT },
      )

      // The model grew; zoom, pan, selection and the fit count did not move.
      expect(canvas.getAttribute('data-fit-view-count')).toBe(fitsBefore)
      expect(viewportTransform()).toBe(transformBefore)
      expect(useUiStore.getState().camera).toEqual(cameraBefore)
      expect(useUiStore.getState().selectedComponentId).toBe('mesh.db')
    },
    CANVAS_TIMEOUT,
  )

  it(
    'does not re-disclose the model when an event adds a component',
    async () => {
      const { queryClient, publish } = renderLargeModel()
      const canvas = await waitForCanvas()
      await waitForCameraSettled()

      const cameraBefore = useUiStore.getState().camera
      const collapsedBefore = useUiStore.getState().collapsedComponentIds

      publish(largeGrownArchitectureResponse)
      await act(async () => {
        applyLiveEvent(
          queryClient,
          streamedEvent('architecture.snapshot_published', {
            snapshotId: 'snapshot-large-3',
            components: largeGrownArchitectureResponse.components,
            relationships: largeGrownArchitectureResponse.relationships,
          }),
        )
      })
      await waitFor(
        () =>
          expect(canvas.getAttribute('data-node-count')).toBe(
            String(largeGrownArchitectureResponse.components.length),
          ),
        { timeout: CANVAS_TIMEOUT },
      )
      await waitFor(
        () => expect(canvas.getAttribute('data-layouting')).toBe('false'),
        { timeout: CANVAS_TIMEOUT },
      )

      // What the user has open is theirs, exactly like the camera is.
      expect(useUiStore.getState().collapsedComponentIds).toEqual(collapsedBefore)
      expect(useUiStore.getState().camera).toEqual(cameraBefore)
      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
    },
    CANVAS_TIMEOUT,
  )
})
