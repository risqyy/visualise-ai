/**
 * The live observer that runs *inside* the page.
 *
 * ADR 0006 and ADR 0010 make three of the four work states — `aktiv`,
 * `kürzlich angewandt` and `entfernt` — statements about **what this tab
 * watched happen**: a stream opened without a cursor starts at the live tail, so
 * after a reload the change ledger legitimately starts empty. Polling the DOM
 * from the test process would therefore sample a moving target and could miss a
 * state that was on screen for half a second.
 *
 * This module is installed with `page.addInitScript` before the application
 * boots and records the **maximum** each counter ever reached plus every
 * distinct overlay mark it ever saw. The assertions then read a recording of the
 * whole run instead of a snapshot of its end.
 *
 * Everything below runs in the browser and must stay self-contained: no imports,
 * no references to the test process.
 */

export interface LiveObserverMark {
  state: string
  operation: string
  label: string
  borderStyle: string
  presence: string
  text: string
  testId: string
}

export interface LiveObserverState {
  samples: number
  maxCounts: Record<string, number>
  maxTotal: number
  /** Every distinct `state|operation` combination the canvas ever rendered. */
  marks: Record<string, LiveObserverMark>
  maxOverlayNodeCount: number
  maxOverlayEdgeCount: number
  /** Every distinct value the live-connection badge went through, in order. */
  connectionStates: string[]
  /** Component ids that were ever drawn as a removed ghost. */
  ghostComponentIds: string[]
}

export function installLiveObserver(): void {
  const STATE_IDS = ['planned', 'active', 'recently_applied', 'removed']

  const state: LiveObserverState = {
    samples: 0,
    maxCounts: { planned: 0, active: 0, recently_applied: 0, removed: 0 },
    maxTotal: 0,
    marks: {},
    maxOverlayNodeCount: 0,
    maxOverlayEdgeCount: 0,
    connectionStates: [],
    ghostComponentIds: [],
  }
  ;(window as unknown as { __e2eLive: LiveObserverState }).__e2eLive = state

  const readNumber = (element: Element | null, attribute: string): number => {
    const raw = element?.getAttribute(attribute)
    const value = Number(raw)
    return Number.isFinite(value) ? value : 0
  }

  const sample = (): void => {
    state.samples += 1

    for (const id of STATE_IDS) {
      const counter = document.querySelector(`[data-testid="change-counter-${id}"]`)
      if (counter === null) continue
      const count = readNumber(counter, 'data-count')
      const previous = state.maxCounts[id] ?? 0
      if (count > previous) state.maxCounts[id] = count
    }

    const counter = document.querySelector('[data-testid="change-counter"]')
    const total = readNumber(counter, 'data-total')
    if (total > state.maxTotal) state.maxTotal = total

    for (const mark of Array.from(document.querySelectorAll('[data-work-state-label]'))) {
      const markState = mark.getAttribute('data-work-state') ?? ''
      const operation = mark.getAttribute('data-operation') ?? 'none'
      const key = `${markState}|${operation}`
      if (state.marks[key] !== undefined) continue
      state.marks[key] = {
        state: markState,
        operation,
        label: mark.getAttribute('data-work-state-label') ?? '',
        borderStyle: mark.getAttribute('data-border-style') ?? '',
        presence: mark.getAttribute('data-presence') ?? '',
        text: (mark.textContent ?? '').replace(/\s+/g, ' ').trim(),
        testId: mark.getAttribute('data-testid') ?? '',
      }
    }

    for (const node of Array.from(document.querySelectorAll('[data-presence="ghost"]'))) {
      const componentId =
        node.getAttribute('data-component-id') ??
        node.closest('[data-component-id]')?.getAttribute('data-component-id') ??
        ''
      if (componentId !== '' && !state.ghostComponentIds.includes(componentId)) {
        state.ghostComponentIds.push(componentId)
      }
    }

    const canvas = document.querySelector('[data-testid="architecture-canvas"]')
    if (canvas !== null) {
      const overlayNodes = readNumber(canvas, 'data-overlay-node-count')
      const overlayEdges = readNumber(canvas, 'data-overlay-edge-count')
      if (overlayNodes > state.maxOverlayNodeCount) state.maxOverlayNodeCount = overlayNodes
      if (overlayEdges > state.maxOverlayEdgeCount) state.maxOverlayEdgeCount = overlayEdges
    }

    const badge = document.querySelector('[data-testid="live-connection-state"]')
    const connection = badge?.getAttribute('data-state')
    if (
      typeof connection === 'string' &&
      state.connectionStates[state.connectionStates.length - 1] !== connection
    ) {
      state.connectionStates.push(connection)
    }
  }

  const start = (): void => {
    new MutationObserver(sample).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
    })
    // Backstop for a state that appears and disappears between two mutations of
    // the observed subtree. 50 ms is far below the ~150 ms transition the
    // overlays use, so nothing that was rendered can slip through unseen.
    window.setInterval(sample, 50)
    sample()
  }

  if (document.body !== null) start()
  else document.addEventListener('DOMContentLoaded', start)
}
