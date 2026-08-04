import { describe, expect, it } from 'vitest'

import type { StreamedEvent } from '@/api/types'
import { PROJECT_ID, streamedEvent } from '@/test/fixtures'

import {
  EMPTY_LEDGER,
  RECENT_APPLIED_LIMIT,
  ingestEvent,
  openWorkSteps,
  recentAppliedChanges,
  standingChanges,
  type ChangeLedger,
} from './changeLedger'

const COMPONENT = {
  componentId: 'platform.core.shipping',
  name: 'Shipping',
  kind: 'module' as const,
  parentComponentId: 'platform.core',
}

function fold(...events: StreamedEvent[]): ChangeLedger {
  return events.reduce(ingestEvent, EMPTY_LEDGER)
}

describe('change ledger — what the read API cannot answer', () => {
  it('records a started work step and drops it again when it completes', () => {
    const started = fold(
      streamedEvent(
        'work.step_started',
        {
          workStepId: 'work-1',
          title: 'VAT-Extraktion',
          componentIds: ['platform.core.orders', 'platform.db'],
        },
        { position: 10 },
      ),
    )
    expect(openWorkSteps(started)).toHaveLength(1)
    expect(openWorkSteps(started)[0]?.componentIds).toEqual([
      'platform.core.orders',
      'platform.db',
    ])

    const completed = ingestEvent(
      started,
      streamedEvent(
        'work.step_completed',
        { workStepId: 'work-1', summary: 'fertig' },
        { position: 11 },
      ),
    )
    expect(openWorkSteps(completed)).toHaveLength(0)
  })

  it('appends every reported change instead of overwriting the previous one', () => {
    const ledger = fold(
      streamedEvent(
        'component.change_planned',
        { changeId: 'c-1', operation: 'add', component: COMPONENT },
        { position: 10, agentId: 'agent-a' },
      ),
      streamedEvent(
        'component.change_applied',
        { changeId: 'c-1', operation: 'add', component: COMPONENT },
        { position: 11, agentId: 'agent-b' },
      ),
    )

    expect(ledger.history).toHaveLength(2)
    expect(ledger.history.map((entry) => entry.phase)).toEqual(['planned', 'applied'])
    expect(ledger.history.map((entry) => entry.agentId)).toEqual(['agent-a', 'agent-b'])
  })

  it('marks a retracted change instead of deleting it — the history survives', () => {
    const planned = streamedEvent(
      'component.change_planned',
      { changeId: 'c-1', operation: 'add', component: COMPONENT },
      { position: 10, clientEventId: 'aaaaaaaa-0000-4000-8000-000000000001' },
    )
    const ledger = fold(
      planned,
      streamedEvent(
        'retraction.issued',
        {
          retractsClientEventId: 'aaaaaaaa-0000-4000-8000-000000000001',
          reason: 'Doch nicht nötig.',
        },
        { position: 11 },
      ),
    )

    // Still there, still inspectable…
    expect(ledger.history).toHaveLength(1)
    expect(ledger.history[0]?.retracted).toBe(true)
    // …but it no longer stands, so it contributes nothing to an overlay.
    expect(standingChanges(ledger)).toHaveLength(0)
  })

  it('supersedes the corrected event and folds in the corrected content', () => {
    const original = streamedEvent(
      'component.change_applied',
      { operation: 'add', component: { ...COMPONENT, name: 'Shiping' } },
      { position: 10, clientEventId: 'aaaaaaaa-0000-4000-8000-000000000002' },
    )
    const ledger = fold(
      original,
      streamedEvent(
        'correction.issued',
        {
          correctsClientEventId: 'aaaaaaaa-0000-4000-8000-000000000002',
          reason: 'Tippfehler im Namen.',
          correctedType: 'component.change_applied',
          correctedPayload: { operation: 'add', component: COMPONENT },
        },
        { position: 11 },
      ),
    )

    expect(ledger.history).toHaveLength(2)
    expect(ledger.history[0]?.superseded).toBe(true)
    const standing = standingChanges(ledger)
    expect(standing).toHaveLength(1)
    expect((standing[0]?.snapshot as { name: string }).name).toBe('Shipping')
  })

  it('resets the applied history when a snapshot replaces the model', () => {
    const ledger = fold(
      streamedEvent(
        'component.change_applied',
        { operation: 'remove', component: COMPONENT },
        { position: 10 },
      ),
      streamedEvent(
        'architecture.snapshot_published',
        { snapshotId: 'snapshot-2', components: [], relationships: [] },
        { position: 11 },
      ),
    )

    expect(ledger.history).toHaveLength(0)
  })

  it('keeps an open work step across a replacing snapshot', () => {
    const ledger = fold(
      streamedEvent(
        'work.step_started',
        { workStepId: 'work-1', title: 'Umbau', componentIds: ['platform.db'] },
        { position: 10 },
      ),
      streamedEvent(
        'architecture.snapshot_published',
        { snapshotId: 'snapshot-2', components: [], relationships: [] },
        { position: 11 },
      ),
    )

    // A work step is a statement about an agent, not about the model.
    expect(openWorkSteps(ledger)).toHaveLength(1)
  })

  it('ignores a replayed event, so a reconnect cannot double-count', () => {
    const event = streamedEvent(
      'component.change_applied',
      { operation: 'add', component: COMPONENT },
      { position: 10 },
    )
    const once = ingestEvent(EMPTY_LEDGER, event)
    const twice = ingestEvent(once, event)

    expect(twice).toBe(once)
    expect(twice.history).toHaveLength(1)
  })

  it('starts over when an event of another project arrives', () => {
    const ledger = fold(
      streamedEvent(
        'component.change_applied',
        { operation: 'add', component: COMPONENT },
        { position: 10 },
      ),
      streamedEvent(
        'component.change_applied',
        { operation: 'add', component: COMPONENT },
        { position: 3, projectId: 'other-project' },
      ),
    )

    expect(ledger.projectId).toBe('other-project')
    expect(ledger.history).toHaveLength(1)
  })

  it('counts recency instead of timing it', () => {
    let ledger = EMPTY_LEDGER
    for (let index = 0; index < RECENT_APPLIED_LIMIT + 3; index += 1) {
      ledger = ingestEvent(
        ledger,
        streamedEvent(
          'component.change_applied',
          {
            operation: 'add',
            component: { ...COMPONENT, componentId: `component-${index}` },
          },
          { position: 10 + index },
        ),
      )
    }

    const recent = recentAppliedChanges(ledger)
    expect(recent).toHaveLength(RECENT_APPLIED_LIMIT)
    // The oldest three fell out; nothing expired because time passed.
    expect(recent[0]?.targetId).toBe('component-3')
    expect(ledger.history).toHaveLength(RECENT_APPLIED_LIMIT + 3)
  })

  it('leaves the ledger untouched for an event it has nothing to say about', () => {
    const before = fold(
      streamedEvent(
        'component.change_applied',
        { operation: 'add', component: COMPONENT },
        { position: 10 },
      ),
    )
    const after = ingestEvent(
      before,
      streamedEvent(
        'agent.progress_reported',
        { percent: 40, scope: 'own_task', basis: 'completed_steps' },
        { position: 11 },
      ),
    )

    // Same object identity: an unrelated event cannot cause a re-render.
    expect(after.history).toBe(before.history)
    expect(after.projectId).toBe(PROJECT_ID)
  })
})
