import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useLiveConnectionStore } from '@/state/liveConnectionStore'

import {
  affectedQueryKeys,
  connectLiveStream,
  type EventSourceLike,
  type LiveStreamHandle,
} from './liveStream'
import type { ProjectId, StreamedEvent } from './types'

/**
 * Applies one live event to the query cache.
 *
 * `invalidateQueries` marks the affected keys stale and refetches the ones that
 * are currently mounted. It never removes cached data, so the visible snapshot
 * stays on screen while the refetch is in flight — which is exactly the
 * behaviour the acceptance criteria demand for a flaky connection.
 *
 * Only the keys `affectedQueryKeys` returns are touched. There is no fallback
 * that invalidates everything.
 */
export function applyLiveEvent(queryClient: QueryClient, event: StreamedEvent): void {
  for (const queryKey of affectedQueryKeys(event)) {
    void queryClient.invalidateQueries({ queryKey })
  }
}

export interface UseLiveStreamOptions {
  /** Injected in tests; defaults to the browser `EventSource`. */
  createEventSource?: (url: string) => EventSourceLike
  /** Set to `false` to keep the stream closed (e.g. while no project is open). */
  enabled?: boolean
}

/**
 * Subscribes to the project stream for as long as the component is mounted and
 * routes every event to the query keys it affects.
 *
 * The connection state lands in `useLiveConnectionStore`, never in the cache.
 */
export function useLiveStream(
  projectId: ProjectId | undefined,
  options: UseLiveStreamOptions = {},
): void {
  const queryClient = useQueryClient()
  const { createEventSource, enabled = true } = options

  useEffect(() => {
    if (!projectId || !enabled) return

    const { setState, recordEvent } = useLiveConnectionStore.getState()

    // No `EventSource` (jsdom, or a browser without SSE): report the connection
    // as offline instead of throwing. The HTTP read models still work, the
    // cockpit simply stops updating by itself.
    if (!createEventSource && typeof EventSource === 'undefined') {
      setState('offline')
      return
    }

    setState('connecting')

    const handle: LiveStreamHandle = connectLiveStream({
      projectId,
      initialPosition: useLiveConnectionStore.getState().lastEventPosition,
      onEvent: (event) => {
        recordEvent(event.position)
        applyLiveEvent(queryClient, event)
      },
      onStateChange: setState,
      ...(createEventSource ? { createEventSource } : {}),
    })

    return () => {
      handle.close()
      useLiveConnectionStore.getState().setState('offline')
    }
  }, [projectId, enabled, queryClient, createEventSource])
}
