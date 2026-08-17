import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'

import type { ArchitectureResponse, ComponentId } from '@/api/types'
import { useUiStore } from '@/state/uiStore'
import {
  NESTED_COMPONENTS,
  activeChange,
  architectureWithChanges,
  nestedArchitectureResponse,
} from '@/test/architectureFixtures'
import {
  PROJECT_ID,
  RUN_ID,
  agent,
  createFakeFetch,
  historyResponse,
  inspectorResponse,
} from '@/test/fixtures'
import { renderApp } from '@/test/renderApp'

import { translateWith } from '@/test/translate'

import { CANVAS_A11Y_KEYS } from './canvasAccessibility'

/**
 * The German rendering of a canvas key. `renderApp` starts in German by
 * default, so this is what the rendered application actually says.
 */
const say = translateWith('canvas')

/**
 * The accessible architecture graph, exercised through the real application.
 *
 * `canvasAccessibility.test.ts` covers how a name is built. This file covers
 * what a keyboard and a screen reader actually get out of the rendered
 * cockpit — the graph, the selection and the hand-over to the inspector, which
 * is the acceptance criterion of #35.
 */

const WORKSPACE_URL = `/projects/${PROJECT_ID}/runs/${RUN_ID}`
const ARCHITECTURE_PATH = `/api/v1/projects/${PROJECT_ID}/architecture`

/** ELK runs for real in these tests; it needs a moment on a nested model. */
const CANVAS_TIMEOUT = 15_000

/**
 * A read-API double whose inspector answers for the component that was asked
 * for, so "the inspector shows what the keyboard selected" is a real assertion
 * rather than a canned body.
 */
function accessibleFetch(architecture: ArchitectureResponse = nestedArchitectureResponse) {
  return createFakeFetch({
    [ARCHITECTURE_PATH]: architecture,
    ...Object.fromEntries(
      NESTED_COMPONENTS.map((component) => [
        `/api/v1/projects/${PROJECT_ID}/components/${component.componentId}`,
        {
          ...inspectorResponse,
          component,
          responsibleAgent: agent(),
        },
      ]),
    ),
    ...Object.fromEntries(
      NESTED_COMPONENTS.map((component) => [
        `/api/v1/projects/${PROJECT_ID}/components/${component.componentId}/history`,
        historyResponse,
      ]),
    ),
  })
}

/**
 * Renders the workspace with **every** container open.
 *
 * A project otherwise opens on its top levels with deeper containers collapsed
 * (ADR 0017), and a component behind a closed container is deliberately not in
 * the DOM and not a tab stop. These tests are about what a screen reader gets
 * from a *drawn* node, so they draw all of them; the closed case has its own
 * block below.
 */
function renderGraph(url = WORKSPACE_URL, architecture = nestedArchitectureResponse) {
  return renderApp(url, {
    fetchImpl: accessibleFetch(architecture),
    expandAllComponents: true,
  })
}

/** Renders the workspace on the disclosure a project actually opens with. */
function renderCollapsedGraph(
  url = WORKSPACE_URL,
  architecture = nestedArchitectureResponse,
) {
  return renderApp(url, { fetchImpl: accessibleFetch(architecture) })
}

async function waitForCanvas(): Promise<HTMLElement> {
  const canvas = await screen.findByTestId('architecture-canvas', undefined, {
    timeout: CANVAS_TIMEOUT,
  })
  await waitFor(() => expect(canvas.getAttribute('data-layouting')).toBe('false'), {
    timeout: CANVAS_TIMEOUT,
  })
  // ELK is loaded through a dynamic import and runs off the render pass, so
  // "not laying out" is reached one tick before the first node is in the DOM.
  await waitFor(
    () => expect(document.querySelectorAll('.react-flow__node').length).toBeGreaterThan(0),
    { timeout: CANVAS_TIMEOUT },
  )
  // And the automatic camera placement runs in an effect after that again, so
  // `data-fit-view-count`, the viewport transform and the stored camera are
  // still one commit away. Reading them synchronously here is a race that goes
  // red exactly when the machine is busy.
  await waitFor(
    () => expect(Number(canvas.getAttribute('data-fit-view-count'))).toBeGreaterThan(0),
    { timeout: CANVAS_TIMEOUT },
  )
  return canvas
}

/** Every node React Flow made a tab stop, as the accessibility tree sees it. */
function nodeElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
}

function nodeElement(componentId: ComponentId): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${componentId}"]`,
  )
  if (!element) throw new Error(`no node rendered for ${componentId}`)
  return element
}

function viewportTransform(): string {
  return document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? ''
}

describe('accessible architecture graph — every node arrives named', () => {
  it(
    'gives every focusable node a role, a role description and a unique name',
    async () => {
      renderGraph()
      await waitForCanvas()

      const nodes = nodeElements()
      expect(nodes.length).toBe(NESTED_COMPONENTS.length)

      const names: string[] = []
      for (const node of nodes) {
        // Before this change every one of these was an *unnamed* group. The
        // role stays `group` — a container holds a real disclosure button, and
        // a widget role would make that child presentational.
        expect(node).toHaveAttribute('tabindex', '0')
        expect(node).toHaveAttribute('role', 'group')
        const name = node.getAttribute('aria-label')
        expect(name).toBeTruthy()
        names.push(name as string)
      }
      expect(new Set(names).size).toBe(nodes.length)

      // A container and a leaf are told apart by words, not by box size.
      expect(nodeElement('platform.core')).toHaveAttribute(
        'aria-roledescription',
        say(CANVAS_A11Y_KEYS.containerRoleDescription),
      )
      expect(nodeElement('platform.db')).toHaveAttribute(
        'aria-roledescription',
        say(CANVAS_A11Y_KEYS.componentRoleDescription),
      )
      expect(nodeElement('platform.core').getAttribute('aria-label')).toContain(
        'Container mit 2 Komponenten',
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'is reachable by its accessible name and names the whole surface',
    async () => {
      renderGraph()
      await waitForCanvas()

      expect(
        screen.getByRole('group', { name: /^Orders DB, Datenspeicher/ }),
      ).toBe(nodeElement('platform.db'))

      const flow = document.querySelector('.react-flow')
      expect(flow).toHaveAttribute('aria-label', say(CANVAS_A11Y_KEYS.graphLabel))
      const describedBy = flow?.getAttribute('aria-describedby') ?? ''
      expect(document.getElementById(describedBy)?.textContent).toBe(
        say(CANVAS_A11Y_KEYS.graphInstructions),
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'replaces React Flow’s English node description, which offered deleting',
    async () => {
      renderGraph()
      await waitForCanvas()

      const node = nodeElement('platform.db')
      const description = document.getElementById(
        node.getAttribute('aria-describedby') ?? '',
      )
      expect(description?.textContent).toBe(say(CANVAS_A11Y_KEYS.nodeInstructions))
      expect(description?.textContent).not.toMatch(/delete|remove/i)
    },
    CANVAS_TIMEOUT,
  )

  it(
    'names every edge from the reported relationship instead of from its ids',
    async () => {
      renderGraph()
      await waitForCanvas()

      const edges = [...document.querySelectorAll('.react-flow__edge')]
      expect(edges.length).toBeGreaterThan(0)
      for (const edge of edges) {
        const name = edge.getAttribute('aria-label') ?? ''
        expect(name).not.toMatch(/^Edge from /)
        expect(name).toContain('Beziehung von ')
        expect(edge).toHaveAttribute(
          'aria-roledescription',
          say(CANVAS_A11Y_KEYS.relationshipRoleDescription),
        )
      }

      // The bundle says how many relationships it carries and lists all three.
      const bundle = document.querySelector(
        '.react-flow__edge[data-id="rel:platform.core.orders~>platform.bus"]',
      )
      const bundleName = bundle?.getAttribute('aria-label') ?? ''
      expect(bundleName).toContain('Sammelkante mit 3 Beziehungen')
      for (const channel of ['orders.created', 'orders.cancelled', 'orders.shipped']) {
        expect(bundleName).toContain(channel)
      }
    },
    CANVAS_TIMEOUT,
  )
})

describe('accessible architecture graph — selection by keyboard alone', () => {
  it(
    'selects a single relationship with Enter and preserves edge focus',
    async () => {
      const user = userEvent.setup()
      const { router } = renderGraph()
      await waitForCanvas()

      const edge = document.querySelector<HTMLElement>(
        '.react-flow__edge[data-id="rel:platform.api.http.router~>platform.core.orders"]',
      )
      expect(edge).not.toBeNull()
      edge?.focus()
      await user.keyboard('{Enter}')

      await waitFor(() =>
        expect(router.state.location.search).toEqual({ relationship: 'r-01' }),
      )
      expect(await screen.findByTestId('inspector-relationship-context')).toHaveAttribute(
        'data-relationship-id',
        'r-01',
      )
      await waitFor(() => {
        expect(edge).toHaveAttribute('aria-current', 'true')
        expect(nodeElement('platform.api.http.router')).toHaveAttribute(
          'aria-current',
          'true',
        )
        expect(nodeElement('platform.core.orders')).toHaveAttribute('aria-current', 'true')
      })
      expect(document.activeElement).toBe(edge)
    },
    CANVAS_TIMEOUT,
  )

  it(
    'selects with Enter, writes the URL and hands the component to the inspector',
    async () => {
      const user = userEvent.setup()
      const { router } = renderGraph()
      await waitForCanvas()

      const node = nodeElement('platform.db')
      expect(node).not.toHaveAttribute('aria-current')

      node.focus()
      expect(document.activeElement).toBe(node)
      await user.keyboard('{Enter}')

      await waitFor(() =>
        expect(router.state.location.search).toEqual({ component: 'platform.db' }),
      )
      await waitFor(() =>
        expect(nodeElement('platform.db')).toHaveAttribute('aria-current', 'true'),
      )
      // Visual and accessible state stay one thing, not two.
      expect(
        within(nodeElement('platform.db')).getByTestId('canvas-node-platform.db'),
      ).toHaveAttribute('data-selected', 'true')

      // The inspector really followed the keyboard.
      const inspector = screen.getByTestId('pane-inspector')
      await waitFor(() => expect(inspector).toHaveTextContent('Orders DB'))

      // Focus stayed where the user put it.
      expect(document.activeElement).toBe(nodeElement('platform.db'))
    },
    CANVAS_TIMEOUT,
  )

  it(
    'selects with the space bar and toggles the selection off again',
    async () => {
      const user = userEvent.setup()
      const { router } = renderGraph()
      await waitForCanvas()

      nodeElement('platform.bus').focus()
      await user.keyboard('[Space]')
      await waitFor(() =>
        expect(router.state.location.search).toEqual({ component: 'platform.bus' }),
      )

      nodeElement('platform.bus').focus()
      await user.keyboard('[Space]')
      await waitFor(() => expect(router.state.location.search).toEqual({}))
      expect(nodeElement('platform.bus')).not.toHaveAttribute('aria-current')
    },
    CANVAS_TIMEOUT,
  )

  it(
    'clears the selection with Escape without throwing the focus away',
    async () => {
      const user = userEvent.setup()
      const { router } = renderGraph(`${WORKSPACE_URL}?component=platform.db`)
      await waitForCanvas()

      await waitFor(() =>
        expect(nodeElement('platform.db')).toHaveAttribute('aria-current', 'true'),
      )

      nodeElement('platform.db').focus()
      await user.keyboard('{Escape}')

      await waitFor(() => expect(router.state.location.search).toEqual({}))
      expect(document.activeElement).toBe(nodeElement('platform.db'))
    },
    CANVAS_TIMEOUT,
  )

  it(
    'lets Escape travel on when there is nothing to deselect',
    async () => {
      const user = userEvent.setup()
      const { router } = renderGraph(`${WORKSPACE_URL}?focus=feedback`)
      await waitForCanvas()
      await waitFor(() => expect(router.state.location.search).toEqual({ focus: 'feedback' }))

      // Nothing is selected, so the canvas must not swallow the key — deep
      // focus is the layer that owns Escape here.
      nodeElement('platform.db').focus()
      await user.keyboard('{Escape}')

      await waitFor(() => expect(router.state.location.search).toEqual({}))
    },
    CANVAS_TIMEOUT,
  )

  it(
    'never announces a node movement that a read-only canvas does not perform',
    async () => {
      const user = userEvent.setup()
      renderGraph(`${WORKSPACE_URL}?component=platform.db`)
      await waitForCanvas()

      const node = nodeElement('platform.db')
      node.focus()
      await user.keyboard('{ArrowRight}{ArrowDown}{ArrowLeft}{ArrowUp}')

      const live = [...document.querySelectorAll('[aria-live]')]
      expect(live.length).toBeGreaterThan(0)
      for (const region of live) expect(region.textContent).toBe('')
    },
    CANVAS_TIMEOUT,
  )
})

/**
 * The progressive disclosure of #34 (ADR 0017), from the accessibility side.
 *
 * A collapsed container is a different picture — fewer boxes, a stacked edge,
 * a count of what is behind it — and it has to be a different announcement.
 */
describe('accessible architecture graph — a closed container says so', () => {
  it(
    'draws only the open levels and names each of them',
    async () => {
      renderCollapsedGraph()
      await waitForCanvas()

      const nodes = nodeElements()
      // Deeper containers start closed, so this is deliberately *not* all 10.
      expect(nodes.length).toBeLessThan(NESTED_COMPONENTS.length)
      for (const node of nodes) {
        expect(node.getAttribute('aria-label')).toBeTruthy()
      }
      // What is behind a closed container is not drawn and is not a tab stop.
      expect(
        document.querySelector('.react-flow__node[data-id="platform.api.http.router"]'),
      ).toBeNull()
    },
    CANVAS_TIMEOUT,
  )

  it(
    'says that it is closed, how much is behind it, and offers a named control',
    async () => {
      renderCollapsedGraph()
      await waitForCanvas()

      const container = nodeElement('platform.api')
      const name = container.getAttribute('aria-label') ?? ''
      expect(name).toContain('API Gateway')
      expect(name).toContain('eingeklappt')

      // The visible count and the announced count are the same number.
      const hidden = within(container).getByTestId('node-hidden-count').textContent ?? ''
      const hiddenCount = Number(/(\d+)/.exec(hidden)?.[1])
      expect(hiddenCount).toBeGreaterThan(0)
      expect(name).toContain(`${hiddenCount} Komponenten verborgen`)

      // The disclosure control is a real, separately reachable button, and it
      // names the container it belongs to rather than only its action.
      const toggle = screen.getByTestId('node-disclosure-platform.api')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(toggle.getAttribute('aria-label')).toBe(
        `Aufklappen: API Gateway (${hiddenCount} Komponenten)`,
      )
    },
    CANVAS_TIMEOUT,
  )

  it(
    'opens a container from the keyboard without selecting it or moving the camera',
    async () => {
      const user = userEvent.setup()
      const { router } = renderCollapsedGraph()
      const canvas = await waitForCanvas()

      const transformBefore = viewportTransform()
      const toggle = screen.getByTestId('node-disclosure-platform.api')
      toggle.focus()
      expect(document.activeElement).toBe(toggle)

      // Enter on the toggle must open the container — not select the node it
      // sits in. The canvas keyboard handler leaves real controls alone.
      await user.keyboard('{Enter}')

      await waitFor(
        () =>
          expect(
            document.querySelector('.react-flow__node[data-id="platform.api.http"]'),
          ).not.toBeNull(),
        { timeout: CANVAS_TIMEOUT },
      )
      await waitFor(() => expect(canvas.getAttribute('data-layouting')).toBe('false'), {
        timeout: CANVAS_TIMEOUT,
      })

      expect(router.state.location.search).toEqual({})
      expect(screen.getByTestId('node-disclosure-platform.api')).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(nodeElement('platform.api').getAttribute('aria-label')).not.toContain(
        'eingeklappt',
      )
      // Opening rearranges the boxes; it does not move the camera (ADR 0008).
      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
      expect(viewportTransform()).toBe(transformBefore)
    },
    CANVAS_TIMEOUT,
  )
})

describe('accessible architecture graph — the state a screen reader hears is the state on screen', () => {
  it(
    'announces the reported work state with the same words the mark carries',
    async () => {
      renderGraph(WORKSPACE_URL, architectureWithChanges([activeChange()]))
      await waitForCanvas()

      const proposal = await screen.findByTestId(
        'canvas-node-platform.core.shipping',
        undefined,
        { timeout: CANVAS_TIMEOUT },
      )
      // What the box says…
      expect(proposal).toHaveAttribute('data-work-state', 'planned')
      expect(proposal).toHaveAttribute('data-presence', 'proposal')

      // …is what the accessible name says.
      const name = nodeElement('platform.core.shipping').getAttribute('aria-label') ?? ''
      expect(name).toContain('Shipping')
      expect(name).toContain('geplant · hinzufügen')
      expect(name).toContain(say(CANVAS_A11Y_KEYS.proposalNote))
      // …and it is a phase of work, never a verdict.
      expect(name).not.toMatch(/gut|schlecht|Fehler|riskant/i)
    },
    CANVAS_TIMEOUT,
  )

  it(
    'says explicitly when an agent reported nothing about a component',
    async () => {
      renderGraph()
      await waitForCanvas()

      for (const node of nodeElements()) {
        const inner = node.querySelector('[data-component-id]')
        const label = node.getAttribute('aria-label') ?? ''
        if (inner?.getAttribute('data-work-state') === null) {
          expect(label).toContain(say(CANVAS_A11Y_KEYS.noWorkState))
        }
      }
    },
    CANVAS_TIMEOUT,
  )
})

/**
 * What the keyboard may and may not do to the camera.
 *
 * Two different guarantees, and they are worth keeping apart:
 *
 * * **No fit, ever.** `data-fit-view-count` counts the one automatic movement
 *   of the first model plus explicit user requests. Focusing, selecting and
 *   deselecting never touch it.
 * * **No zoom change, ever.** The scale the user is reading at is theirs.
 *
 * A **pan** is a different matter. React Flow's `autoPanOnNodeFocus` brings a
 * node that lies outside the viewport into view at the same zoom, and it is
 * deliberately left on (ADR 0018): since ADR 0017 the entry zoom is 0.77 rather
 * than 0.20, so a large model no longer fits on screen and a focus ring on an
 * off-screen node would be a ring nobody can see. That pan is requested by the
 * user's own Tab press — never by arriving data.
 */
describe('accessible architecture graph — the camera stays where the user left it', () => {
  it(
    'never fits and never changes the zoom while the keyboard walks the graph',
    async () => {
      const user = userEvent.setup()
      const canvas = await (async () => {
        renderGraph()
        return waitForCanvas()
      })()

      await waitFor(() => expect(canvas.getAttribute('data-fit-view-count')).toBe('1'))
      const zoomBefore = useUiStore.getState().camera.zoom

      for (const node of nodeElements()) node.focus()
      nodeElement('platform.core.orders').focus()
      await user.keyboard('{Enter}')

      await waitFor(() =>
        expect(nodeElement('platform.core.orders')).toHaveAttribute(
          'aria-current',
          'true',
        ),
      )

      // The one automatic fit of the first model, and nothing on top of it.
      expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
      expect(useUiStore.getState().camera.zoom).toBe(zoomBefore)
      expect(viewportTransform()).toContain(`scale(${zoomBefore})`)
    },
    CANVAS_TIMEOUT,
  )

  it(
    'publishes the live zoom so the focus ring can stay a constant width',
    async () => {
      renderGraph()
      const canvas = await waitForCanvas()

      const published = canvas.style.getPropertyValue('--vai-canvas-zoom')
      expect(Number(published)).toBeGreaterThan(0)
      expect(Number(published)).toBeCloseTo(useUiStore.getState().camera.zoom, 5)
    },
    CANVAS_TIMEOUT,
  )
})

describe('accessible architecture graph — automated audit', () => {
  /**
   * axe-core over the two panes this issue is about, run against the rendered
   * DOM after a keyboard selection — the graph, the selection and the
   * hand-over to the inspector in one pass.
   *
   * Two deliberate boundaries:
   *
   * * **Colour rules are off.** jsdom has neither layout nor rendering, so
   *   `color-contrast` is undecidable there rather than passing. That colour is
   *   never the only channel is asserted where it is decided —
   *   `workStates.test.ts` requires a label, an icon and a line style next to
   *   every hue.
   * * **The audit is scoped to the two panes.** Run over the whole page, axe
   *   additionally reports the two resize handles of the workspace layout under
   *   `region` ("all page content should be contained by landmarks"): they sit
   *   *between* the panes and therefore inside none of them. That is a
   *   best-practice finding about the workspace shell (#7/#41), not about the
   *   architecture graph, and silently disabling the rule here would hide it
   *   for the panes too.
   */
  it(
    'reports no violations for the graph, a selection and the inspector',
    async () => {
      const user = userEvent.setup()
      renderGraph()
      await waitForCanvas()

      nodeElement('platform.db').focus()
      await user.keyboard('{Enter}')
      await waitFor(() =>
        expect(screen.getByTestId('pane-inspector')).toHaveTextContent('Orders DB'),
      )

      const results = await axe.run(
        {
          include: [
            ['[data-testid="pane-architecture"]'],
            ['[data-testid="pane-inspector"]'],
          ],
        },
        {
          resultTypes: ['violations'],
          rules: { 'color-contrast': { enabled: false } },
        },
      )

      const summary = results.violations.map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.length}×) — ` +
          violation.nodes
            .map((node) => node.target.join(' '))
            .slice(0, 3)
            .join(' | '),
      )
      expect(summary).toEqual([])
    },
    CANVAS_TIMEOUT,
  )
})
