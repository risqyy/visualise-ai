import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeEventSource } from '@/test/fakeEventSource'
import { PROJECT_ID, RUN_ID, component, streamedEvent } from '@/test/fixtures'

import { affectedQueryKeys, connectLiveStream, streamUrl } from './liveStream'
import { queryKeys } from './queryKeys'
import { applyLiveEvent } from './useLiveStream'

const COMPONENT_A = 'shop-platform.orders.domain'
const COMPONENT_B = 'shop-platform.billing.domain'

/** Every key the cockpit can hold, so "only these were touched" is provable. */
function seedCache(queryClient: QueryClient): Record<string, QueryKey> {
  const keys = {
    projects: queryKeys.projects(),
    projectDetail: queryKeys.projectDetail(PROJECT_ID),
    architecture: queryKeys.architecture(PROJECT_ID),
    runs: queryKeys.runs(PROJECT_ID),
    runDetail: queryKeys.runDetail(PROJECT_ID, RUN_ID),
    agents: queryKeys.agents(PROJECT_ID, RUN_ID),
    plans: queryKeys.plans(PROJECT_ID, RUN_ID),
    inspectorA: queryKeys.componentInspector(PROJECT_ID, COMPONENT_A, RUN_ID),
    historyA: queryKeys.componentHistory(PROJECT_ID, COMPONENT_A),
    inspectorB: queryKeys.componentInspector(PROJECT_ID, COMPONENT_B, RUN_ID),
    historyB: queryKeys.componentHistory(PROJECT_ID, COMPONENT_B),
  }

  for (const [name, key] of Object.entries(keys)) {
    queryClient.setQueryData(key, { seeded: name })
  }
  return keys
}

function invalidatedNames(
  queryClient: QueryClient,
  keys: Record<string, QueryKey>,
): string[] {
  return Object.entries(keys)
    .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated === true)
    .map(([name]) => name)
    .sort()
}

describe('affectedQueryKeys', () => {
  it('maps a component change to the architecture and that one component only', () => {
    const event = streamedEvent('component.change_applied', {
      operation: 'modify',
      component: component({ componentId: COMPONENT_A }),
    })

    expect(affectedQueryKeys(event)).toEqual([
      queryKeys.architecture(PROJECT_ID),
      queryKeys.component(PROJECT_ID, COMPONENT_A),
    ])
  })

  it('maps agent progress to the agent tree of that run only', () => {
    const event = streamedEvent('agent.progress_reported', {
      percent: 40,
      scope: 'own_task',
      basis: 'reported_estimate',
    })

    expect(affectedQueryKeys(event)).toEqual([queryKeys.agents(PROJECT_ID, RUN_ID)])
  })

  it('resolves a correction through to the corrected event type', () => {
    const event = streamedEvent('correction.issued', {
      correctsClientEventId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      reason: 'wrong component',
      correctedType: 'diff.reported',
      correctedPayload: {
        diffId: 'diff-1',
        componentIds: [COMPONENT_B],
        filePath: 'internal/ingest/handler.go',
        unifiedDiff: '--- a\n+++ b\n',
      },
    })

    expect(affectedQueryKeys(event)).toEqual([
      queryKeys.component(PROJECT_ID, COMPONENT_B),
    ])
  })
})

describe('applyLiveEvent', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    queryClient.clear()
  })

  it('invalidates exactly the affected keys for component.change_applied', () => {
    const keys = seedCache(queryClient)

    applyLiveEvent(
      queryClient,
      streamedEvent('component.change_applied', {
        operation: 'modify',
        component: component({ componentId: COMPONENT_A }),
      }),
    )

    expect(invalidatedNames(queryClient, keys)).toEqual([
      'architecture',
      'historyA',
      'inspectorA',
    ])
  })

  it('leaves every other query untouched for an agent progress report', () => {
    const keys = seedCache(queryClient)

    applyLiveEvent(
      queryClient,
      streamedEvent('agent.progress_reported', {
        percent: 12,
        scope: 'own_task',
        basis: 'completed_steps',
      }),
    )

    expect(invalidatedNames(queryClient, keys)).toEqual(['agents'])
  })

  it('never drops cached data while invalidating', () => {
    const keys = seedCache(queryClient)

    applyLiveEvent(
      queryClient,
      streamedEvent('architecture.snapshot_published', {
        snapshotId: 'snapshot-1',
        components: [component()],
        relationships: [],
      }),
    )

    expect(queryClient.getQueryData(keys.architecture!)).toEqual({
      seeded: 'architecture',
    })
    expect(queryClient.getQueryData(keys.agents!)).toEqual({ seeded: 'agents' })
  })
})

describe('connectLiveStream', () => {
  beforeEach(() => {
    FakeEventSource.reset()
  })

  it('connects to the project stream and reports the live state', () => {
    const states: string[] = []
    const handle = connectLiveStream({
      projectId: PROJECT_ID,
      onEvent: () => {},
      onStateChange: (state) => states.push(state),
      createEventSource: (url) => new FakeEventSource(url),
    })

    expect(FakeEventSource.last.url).toBe(streamUrl(PROJECT_ID, null))
    FakeEventSource.last.open()

    expect(states).toEqual(['live'])
    expect(handle.getState()).toBe('live')
    handle.close()
  })

  it('delivers parsed events and remembers the highest position', () => {
    const received: number[] = []
    const handle = connectLiveStream({
      projectId: PROJECT_ID,
      onEvent: (event) => received.push(event.position),
      createEventSource: (url) => new FakeEventSource(url),
    })

    FakeEventSource.last.open()
    FakeEventSource.last.emit(
      streamedEvent(
        'agent.status_reported',
        { status: 'working' },
        { position: 41 },
      ),
    )
    FakeEventSource.last.emitRaw('agent.status_reported', 'not json')

    expect(received).toEqual([41])
    expect(handle.getLastEventPosition()).toBe(41)
    handle.close()
  })

  it('reports reconnecting without destroying cached data', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const keys = seedCache(queryClient)
    const states: string[] = []

    const handle = connectLiveStream({
      projectId: PROJECT_ID,
      onEvent: (event) => applyLiveEvent(queryClient, event),
      onStateChange: (state) => states.push(state),
      createEventSource: (url) => new FakeEventSource(url),
      retryDelayMs: () => 0,
    })

    FakeEventSource.last.open()
    FakeEventSource.last.emit(
      streamedEvent(
        'agent.status_reported',
        { status: 'working' },
        { position: 41 },
      ),
    )

    // The browser drops the connection and retries on its own.
    FakeEventSource.last.dropConnection()

    expect(handle.getState()).toBe('reconnecting')
    expect(states).toEqual(['live', 'reconnecting'])
    // The whole cache survives — a lost stream must never blank the cockpit.
    for (const [name, key] of Object.entries(keys)) {
      expect(queryClient.getQueryData(key)).toEqual({ seeded: name })
    }

    handle.close()
    queryClient.clear()
  })

  it('reopens the stream at the last seen position when the browser gives up', async () => {
    const handle = connectLiveStream({
      projectId: PROJECT_ID,
      onEvent: () => {},
      createEventSource: (url) => new FakeEventSource(url),
      retryDelayMs: () => 0,
    })

    FakeEventSource.last.open()
    FakeEventSource.last.emit(
      streamedEvent(
        'agent.status_reported',
        { status: 'working' },
        { position: 41 },
      ),
    )
    FakeEventSource.last.fail()

    expect(handle.getState()).toBe('reconnecting')

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(2)
    })
    expect(FakeEventSource.last.url).toBe(streamUrl(PROJECT_ID, 41))
    expect(FakeEventSource.last.url).toContain('lastEventPosition=41')

    handle.close()
  })

  it('falls back to offline after repeated failures and keeps retrying', async () => {
    const states: string[] = []
    const handle = connectLiveStream({
      projectId: PROJECT_ID,
      onEvent: () => {},
      onStateChange: (state) => states.push(state),
      createEventSource: (url) => new FakeEventSource(url),
      retryDelayMs: () => 0,
      offlineAfterAttempts: 1,
    })

    FakeEventSource.last.fail()
    expect(handle.getState()).toBe('reconnecting')

    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2))
    FakeEventSource.last.fail()

    expect(handle.getState()).toBe('offline')
    expect(states).toEqual(['reconnecting', 'offline'])

    handle.close()
  })
})
