import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import { useLiveConnectionStore } from '@/state/liveConnectionStore'
import { resetUiStore } from '@/state/uiStore'

/**
 * jsdom implements neither `ResizeObserver` nor `matchMedia`, both of which
 * react-resizable-panels and Radix rely on. The stubs are inert: they satisfy
 * the API surface without pretending to report sizes, so no test can
 * accidentally depend on a fake layout measurement.
 */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub

if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia

  // jsdom defines `scrollTo` but throws "not implemented" when it is called.
  Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true })

  // Radix positions its popovers with these; jsdom has no layout engine.
  window.HTMLElement.prototype.scrollIntoView ??= () => {}
  window.HTMLElement.prototype.releasePointerCapture ??= () => {}
  window.HTMLElement.prototype.hasPointerCapture ??= () => false
}

beforeEach(() => {
  localStorage.clear()
  resetUiStore()
  useLiveConnectionStore.getState().reset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
