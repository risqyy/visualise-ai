import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { selectLedgerFor, useChangeLedgerStore } from '@/state/changeLedgerStore'
import { useLiveConnectionStore } from '@/state/liveConnectionStore'
import { useUiStore } from '@/state/uiStore'
import { FakeEventSource } from '@/test/fakeEventSource'
import { component, streamedEvent } from '@/test/fixtures'

import { queryKeys } from './queryKeys'
import { streamUrl } from './liveStream'
import { useLiveStream } from './useLiveStream'

const A = 'project-a'
// Opaque project IDs must also be safe as storage keys.
const B = '__proto__'
const createEventSource = (url: string) => new FakeEventSource(url)
const ledger = (projectId: string) => selectLedgerFor(useChangeLedgerStore.getState(), projectId)
const change = (projectId: string, position: number) => streamedEvent('component.change_applied', {
  operation: 'modify', component: component({ name: `${projectId}-${position}` }),
}, { projectId, position, clientEventId: `event-${projectId}-${position}` })

/** Retains a queued browser callback even when its listener is later removed. */
class QueuedEventSource extends FakeEventSource {
  queued = new Map<string, (event: Event) => void>()
  override addEventListener(type: string, listener: (event: Event) => void) {
    this.queued.set(type, listener)
    super.addEventListener(type, listener)
  }
}

let client: QueryClient
function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  FakeEventSource.reset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  client.clear()
  vi.useRealTimers()
})

describe('project-scoped live sessions', () => {
  it('reconciles fresh cached reads after subscribing when no frame has ever supplied a cursor', async () => {
    let revision = 2
    const readArchitecture = vi.fn(async () => ({ revision }))
    client.setQueryData(queryKeys.architecture(A), { revision: 1 })
    client.setQueryData(queryKeys.architecture(B), { revision: 1 })
    const { result, rerender } = renderHook(({ projectId }) => {
      useLiveStream(projectId, { createEventSource })
      return useQuery({ queryKey: queryKeys.architecture(projectId), queryFn: readArchitecture, staleTime: 30_000 })
    }, { wrapper: Wrapper, initialProps: { projectId: A } })
    expect(result.current.data).toEqual({ revision: 1 })
    expect(readArchitecture).not.toHaveBeenCalled()
    // A write between the initial GET and the subscription is covered by reads,
    // without inventing an observed event or replaying historical overlays.
    act(() => FakeEventSource.last.open())
    await waitFor(() => expect(result.current.data).toEqual({ revision: 2 }))
    expect(client.getQueryState(queryKeys.architecture(B))?.isInvalidated).toBe(false)
    rerender({ projectId: B })
    act(() => FakeEventSource.last.open())
    await waitFor(() => expect(result.current.data).toEqual({ revision: 2 }))
    revision = 3
    rerender({ projectId: A })
    expect(result.current.data).toEqual({ revision: 2 })
    expect(FakeEventSource.last.url).toBe(streamUrl(A, null))
    act(() => FakeEventSource.last.open())
    await waitFor(() => expect(result.current.data).toEqual({ revision: 3 }))
    expect(ledger(A).history).toHaveLength(0)
    expect(useLiveConnectionStore.getState()).toMatchObject({ lastEventPosition: null, appliedEventCount: 0 })
  })

  it('keeps A and B cursors, counters and evidence together across navigation and offline gap recovery', () => {
    vi.useFakeTimers()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { rerender, unmount } = renderHook(({ projectId }) => useLiveStream(projectId, { createEventSource }), {
      wrapper: Wrapper, initialProps: { projectId: A },
    })
    act(() => { FakeEventSource.last.open(); FakeEventSource.last.emit(change(A, 1000)) })
    const originalLedger = ledger(A)
    const aSource = FakeEventSource.last
    rerender({ projectId: B })
    expect(aSource.closed).toBe(true)
    expect(FakeEventSource.last.url).toBe(streamUrl(B, null))
    expect(useLiveConnectionStore.getState()).toMatchObject({ projectId: B, state: 'connecting', lastEventPosition: null, lastEventAt: null, appliedEventCount: 0 })
    expect(ledger(B).history).toHaveLength(0)

    act(() => { FakeEventSource.last.open(); FakeEventSource.last.emit(change(B, 101)) })
    expect(useLiveConnectionStore.getState()).toMatchObject({ state: 'live', lastEventPosition: 101, appliedEventCount: 1 })
    // Four actual CLOSED-source retries reach offline, yet retain the snapshot.
    client.setQueryData(queryKeys.architecture(B), { marker: 'last-loaded' })
    const camera = { x: 40, y: 60, zoom: 1.5 }
    useUiStore.getState().setCamera(camera)
    useUiStore.getState().setSelectedComponentId('selected-component')
    for (const delay of [1000, 2000, 4000]) {
      act(() => { FakeEventSource.last.fail(); vi.advanceTimersByTime(delay) })
    }
    act(() => FakeEventSource.last.fail())
    expect(useLiveConnectionStore.getState().state).toBe('offline')
    expect(client.getQueryData(queryKeys.architecture(B))).toEqual({ marker: 'last-loaded' })
    act(() => vi.advanceTimersByTime(8000))
    expect(FakeEventSource.last.url).toBe(streamUrl(B, 101))
    invalidate.mockClear()
    act(() => {
      FakeEventSource.last.open()
      // The server replays the missed gap in order. Repeated frames are inert.
      for (const position of [101, 102, 102, 103]) FakeEventSource.last.emit(change(B, position))
    })
    expect(ledger(B).history.map((entry) => entry.position)).toEqual([101, 102, 103])
    expect(invalidate.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([
      queryKeys.architecture(B), queryKeys.component(B, component().componentId), queryKeys.views(B),
      queryKeys.architecture(B), queryKeys.component(B, component().componentId), queryKeys.views(B),
    ])
    expect(useLiveConnectionStore.getState()).toMatchObject({ state: 'live', lastEventPosition: 103, appliedEventCount: 3 })
    expect(useUiStore.getState()).toMatchObject({ camera, selectedComponentId: 'selected-component' })

    rerender({ projectId: A })
    expect(FakeEventSource.last.url).toBe(streamUrl(A, 1000))
    expect(ledger(A)).toBe(originalLedger)
    expect(useLiveConnectionStore.getState()).toMatchObject({ state: 'connecting', lastEventPosition: 1000, appliedEventCount: 1 })
    act(() => { FakeEventSource.last.open(); FakeEventSource.last.emit(change(A, 1001)) })
    expect(ledger(A).history.map((entry) => entry.position)).toEqual([1000, 1001])
    expect(ledger(B).history.map((entry) => entry.position)).toEqual([101, 102, 103])
    unmount()
  })

  it('retains open work evidence when returning to a project, then completes it from replay', () => {
    const { rerender } = renderHook(({ projectId }) => useLiveStream(projectId, { createEventSource }), {
      wrapper: Wrapper, initialProps: { projectId: A },
    })
    act(() => FakeEventSource.last.emit(streamedEvent('work.step_started', {
      workStepId: 'step', title: 'implement', componentIds: [component().componentId],
    }, { projectId: A, position: 1000 })))
    expect(Object.values(ledger(A).openWorkSteps)).toHaveLength(1)
    rerender({ projectId: B })
    act(() => FakeEventSource.last.emit(change(B, 101)))
    expect(Object.values(ledger(B).openWorkSteps)).toHaveLength(0)
    rerender({ projectId: A })
    expect(Object.values(ledger(A).openWorkSteps)).toHaveLength(1)
    act(() => FakeEventSource.last.emit(streamedEvent('work.step_completed', {
      workStepId: 'step', summary: 'done',
    }, { projectId: A, position: 1001 })))
    expect(Object.values(ledger(A).openWorkSteps)).toHaveLength(0)
  })

  it('keeps the same stream for run/view navigation and resumes after a same-project remount', () => {
    const { rerender, unmount } = renderHook((props: { projectId: string; run: string; view: string }) => useLiveStream(props.projectId, { createEventSource }), {
      wrapper: Wrapper, initialProps: { projectId: A, run: 'run-1', view: 'view-1' },
    })
    act(() => FakeEventSource.last.emit(change(A, 1000)))
    rerender({ projectId: A, run: 'run-2', view: 'view-2' })
    expect(FakeEventSource.instances).toHaveLength(1)
    unmount()
    renderHook(() => useLiveStream(A, { createEventSource }), { wrapper: Wrapper })
    expect(FakeEventSource.last.url).toBe(streamUrl(A, 1000))
    expect(ledger(A).history).toHaveLength(1)
  })

  it('ignores foreign frames and queued callbacks from departed projects or replaced sources', () => {
    vi.useFakeTimers()
    const createQueuedSource = (url: string) => new QueuedEventSource(url)
    const { rerender } = renderHook(({ projectId }) => useLiveStream(projectId, { createEventSource: createQueuedSource }), {
      wrapper: Wrapper, initialProps: { projectId: A },
    })
    const departed = FakeEventSource.last as QueuedEventSource
    rerender({ projectId: B })
    const replaced = FakeEventSource.last as QueuedEventSource
    act(() => { replaced.fail(); vi.advanceTimersByTime(1000) })
    const current = FakeEventSource.last
    act(() => {
      for (const source of [departed, replaced]) {
        source.queued.get('open')?.(new Event('open'))
        source.queued.get('error')?.(new Event('error'))
        source.queued.get('component.change_applied')?.(new MessageEvent('component.change_applied', { data: JSON.stringify(change(B, 9000)) }))
      }
      current.emit(change(A, 1000))
    })
    expect(useLiveConnectionStore.getState()).toMatchObject({ projectId: B, state: 'reconnecting', lastEventPosition: null, appliedEventCount: 0 })
    expect(ledger(A).history).toHaveLength(0)
    expect(ledger(B).history).toHaveLength(0)
    expect(FakeEventSource.instances).toHaveLength(3)
    act(() => { current.open(); current.emit(change(B, 101)) })
    expect(useLiveConnectionStore.getState()).toMatchObject({ state: 'live', lastEventPosition: 101, appliedEventCount: 1 })
  })

  it('starts a fresh page at the live tail regardless of cached read-model positions', () => {
    client.setQueryData(queryKeys.architecture(A), { projectPosition: 9999 })
    const { rerender, unmount } = renderHook(({ enabled }) => useLiveStream(A, { enabled, createEventSource }), {
      wrapper: Wrapper, initialProps: { enabled: false },
    })
    expect(FakeEventSource.instances).toHaveLength(0)
    rerender({ enabled: true })
    expect(FakeEventSource.last.url).toBe(streamUrl(A, null))
    act(() => FakeEventSource.last.emit(change(A, 1000)))
    rerender({ enabled: false })
    expect(useLiveConnectionStore.getState()).toMatchObject({ projectId: null, state: 'offline', lastEventPosition: null })
    rerender({ enabled: true })
    expect(FakeEventSource.last.url).toBe(streamUrl(A, 1000))
    unmount()
    useLiveConnectionStore.getState().reset()
    useChangeLedgerStore.getState().reset()
    renderHook(() => useLiveStream(A, { createEventSource }), { wrapper: Wrapper })
    expect(FakeEventSource.last.url).toBe(streamUrl(A, null))
    expect(ledger(A).history).toHaveLength(0)
  })
})
