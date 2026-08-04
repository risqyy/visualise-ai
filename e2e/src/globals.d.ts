import type { LiveObserverState } from './liveObserver.js'

declare global {
  interface Window {
    /** Installed by `installLiveObserver` before the application boots. */
    __e2eLive: LiveObserverState
  }
}

export {}
