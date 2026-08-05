import { describe, expect, it } from 'vitest'

import type { StreamedEvent } from '@/api/types'
import { EMPTY_LEDGER, ingestEvent, type ChangeLedger } from '@/state/changeLedger'
import { WORK_STATES } from '@/state/workStates'
import {
  NESTED_COMPONENTS,
  NESTED_RELATIONSHIPS,
  SHIPPING_BUS_RELATIONSHIP,
  SHIPPING_COMPONENT,
  activeChange,
} from '@/test/architectureFixtures'
import { streamedEvent } from '@/test/fixtures'
import { translateWith } from '@/test/translate'

import {
  buildChangeOverlays,
  overlayLabel,
  overlayTitle,
  type ChangeOverlayInput,
} from './changeOverlays'

/**
 * The German `t` of the real catalogue. `overlayLabel` and `overlayTitle` build
 * their sentence from it since #42, so these assertions still check the exact
 * words a reader sees — they just no longer live in the source file.
 */
const t = translateWith('canvas')

function fold(...events: StreamedEvent[]): ChangeLedger {
  return events.reduce(ingestEvent, EMPTY_LEDGER)
}

function input(overrides: Partial<ChangeOverlayInput> = {}): ChangeOverlayInput {
  return {
    components: NESTED_COMPONENTS,
    relationships: NESTED_RELATIONSHIPS,
    activeChanges: [],
    ledger: EMPTY_LEDGER,
    ...overrides,
  }
}

describe('change overlays — the applied model is never touched', () => {
  it('draws a planned addition as its own node, outside the applied model', () => {
    const model = buildChangeOverlays(
      input({ activeChanges: [activeChange({ operation: 'add' })] }),
    )

    // Nothing was attached to an applied component…
    expect(model.components.size).toBe(0)
    // …the proposal became a separate element instead.
    expect(model.extraComponents).toHaveLength(1)
    const entry = model.extraComponents[0]
    expect(entry?.component.componentId).toBe(SHIPPING_COMPONENT.componentId)
    expect(entry?.overlay.state).toBe('planned')
    expect(entry?.overlay.presence).toBe('proposal')
    expect(model.counts.planned).toBe(1)
  })

  it('draws a planned relationship from the reported snapshot alone', () => {
    const model = buildChangeOverlays(
      input({
        activeChanges: [
          activeChange({
            changeId: 'change-rel',
            targetKind: 'relationship',
            targetId: SHIPPING_BUS_RELATIONSHIP.relationshipId,
            snapshot: SHIPPING_BUS_RELATIONSHIP as unknown as Record<string, unknown>,
          }),
        ],
      }),
    )

    expect(model.extraRelationships).toHaveLength(1)
    expect(model.extraRelationships[0]?.relationship.channel).toBe('shipping.dispatched')
  })

  it('marks a component of the applied model that a work step is running on', () => {
    const model = buildChangeOverlays(
      input({
        ledger: fold(
          streamedEvent(
            'work.step_started',
            {
              workStepId: 'work-1',
              title: 'Bestellungen umbauen',
              componentIds: ['platform.core.orders'],
            },
            { position: 10 },
          ),
        ),
      }),
    )

    const overlay = model.components.get('platform.core.orders')
    expect(overlay?.state).toBe('active')
    expect(overlay?.presence).toBe('applied')
    expect(overlay?.operation).toBeNull()
  })

  it('keeps a removed component visible as a ghost of what disappeared', () => {
    const removed = NESTED_COMPONENTS.filter(
      (one) => one.componentId !== 'platform.core.billing',
    )
    const model = buildChangeOverlays(
      input({
        components: removed,
        ledger: fold(
          streamedEvent(
            'component.change_applied',
            {
              operation: 'remove',
              component: {
                componentId: 'platform.core.billing',
                name: 'Billing',
                kind: 'module',
                parentComponentId: 'platform.core',
              },
            },
            { position: 10 },
          ),
        ),
      }),
    )

    const ghost = model.extraComponents[0]
    expect(ghost?.overlay.state).toBe('removed')
    expect(ghost?.overlay.presence).toBe('ghost')
    expect(ghost?.overlay.operation).toBe('remove')
    expect(model.counts.removed).toBe(1)
  })

  it('reports an applied addition as recently applied on the model element', () => {
    const model = buildChangeOverlays(
      input({
        components: [...NESTED_COMPONENTS],
        ledger: fold(
          streamedEvent(
            'component.change_applied',
            { operation: 'modify', component: { ...SHIPPING_COMPONENT } },
            { position: 10 },
          ),
        ),
      }),
    )

    // The component is not in this applied model, so it is a proposal-shaped
    // leftover rather than a model element — the overlay says so instead of
    // pretending the model contains it.
    expect(model.components.size).toBe(0)
    expect(model.extraComponents[0]?.overlay.state).toBe('recently_applied')
  })
})

describe('change overlays — concurrent agents', () => {
  const twoAgents = () =>
    buildChangeOverlays(
      input({
        activeChanges: [
          activeChange({
            changeId: 'change-a',
            targetId: 'platform.core.orders',
            operation: 'modify',
            agentId: 'subagent-implementer',
            position: 50,
          }),
          activeChange({
            changeId: 'change-b',
            targetId: 'platform.core.orders',
            operation: 'modify',
            agentId: 'subagent-reviewer',
            position: 51,
          }),
        ],
      }),
    )

  it('keeps both agents on the same component instead of letting one win', () => {
    const overlay = twoAgents().components.get('platform.core.orders')

    expect(overlay?.contributions).toHaveLength(2)
    expect(overlay?.agentIds).toEqual(['subagent-implementer', 'subagent-reviewer'])
  })

  it('names every contributing agent in the text of the overlay', () => {
    const overlay = twoAgents().components.get('platform.core.orders')
    const title = overlayTitle(overlay!, t)

    expect(title).toContain('2 Agents')
    expect(title).toContain('subagent-implementer')
    expect(title).toContain('subagent-reviewer')
  })

  it('does not lose the earlier proposal when a later change is applied', () => {
    const model = buildChangeOverlays(
      input({
        activeChanges: [
          activeChange({
            changeId: 'change-b',
            targetId: 'platform.core.orders',
            operation: 'modify',
            agentId: 'subagent-reviewer',
            position: 50,
          }),
        ],
        ledger: fold(
          streamedEvent(
            'component.change_applied',
            {
              operation: 'modify',
              component: {
                componentId: 'platform.core.orders',
                name: 'Orders',
                kind: 'module',
                parentComponentId: 'platform.core',
              },
            },
            { position: 60, agentId: 'subagent-implementer' },
          ),
        ),
      }),
    )

    const overlay = model.components.get('platform.core.orders')
    // The newest statement decides the state…
    expect(overlay?.state).toBe('recently_applied')
    // …and the other agent's still-standing proposal is right next to it.
    expect(overlay?.agentIds).toHaveLength(2)
    expect(
      overlay?.contributions.map((contribution) => contribution.source),
    ).toEqual(['planned_change', 'applied_change'])
  })
})

describe('change overlays — retraction and replacing snapshots', () => {
  it('drops a retracted proposal from the overlay', () => {
    const withProposal = buildChangeOverlays(input({ activeChanges: [activeChange()] }))
    expect(withProposal.total).toBe(1)

    // The read API stops reporting a retracted change; nothing else is needed.
    const afterRetraction = buildChangeOverlays(input({ activeChanges: [] }))
    expect(afterRetraction.total).toBe(0)
  })

  it('ignores a change whose reporting event was retracted', () => {
    const ledger = fold(
      streamedEvent(
        'component.change_applied',
        { operation: 'remove', component: SHIPPING_COMPONENT },
        { position: 10, clientEventId: 'aaaaaaaa-0000-4000-8000-000000000003' },
      ),
      streamedEvent(
        'retraction.issued',
        {
          retractsClientEventId: 'aaaaaaaa-0000-4000-8000-000000000003',
          reason: 'Falsch gemeldet.',
        },
        { position: 11 },
      ),
    )

    expect(buildChangeOverlays(input({ ledger })).total).toBe(0)
    // The history itself is untouched.
    expect(ledger.history).toHaveLength(1)
  })

  it('is consistent again after a replacing snapshot', () => {
    const ledger = fold(
      streamedEvent(
        'component.change_applied',
        {
          operation: 'remove',
          component: {
            componentId: 'platform.db',
            name: 'Orders DB',
            kind: 'datastore',
            parentComponentId: 'platform',
          },
        },
        { position: 10 },
      ),
      streamedEvent(
        'architecture.snapshot_published',
        {
          snapshotId: 'snapshot-2',
          components: NESTED_COMPONENTS,
          relationships: NESTED_RELATIONSHIPS,
        },
        { position: 11 },
      ),
    )

    // The snapshot contains `platform.db` again. A ghost of it would contradict
    // the model that is now on screen, so the ledger dropped the statement.
    const model = buildChangeOverlays(input({ ledger }))
    expect(model.total).toBe(0)
    expect(model.extraComponents).toHaveLength(0)
  })
})

describe('change overlays — readable without colour', () => {
  it('gives every state a distinct label, icon and line style', () => {
    // The rendered words, not the keys: what has to be distinct is what the
    // reader sees.
    const labels = WORK_STATES.map((state) => t(state.labelKey))
    const icons = WORK_STATES.map((state) => state.icon)
    const borders = WORK_STATES.map((state) => state.borderStyle)
    const dashes = WORK_STATES.map((state) => state.strokeDasharray)

    expect(new Set(labels).size).toBe(WORK_STATES.length)
    expect(new Set(icons).size).toBe(WORK_STATES.length)
    expect(new Set(borders).size).toBe(WORK_STATES.length)
    expect(new Set(dashes).size).toBe(WORK_STATES.length)
  })

  it('spells the operation out, so two proposals of the same colour differ in words', () => {
    const added = buildChangeOverlays(
      input({ activeChanges: [activeChange({ operation: 'add' })] }),
    ).extraComponents[0]?.overlay
    const removedProposal = buildChangeOverlays(
      input({
        activeChanges: [
          activeChange({ targetId: 'platform.db', operation: 'remove', changeId: 'change-rm' }),
        ],
      }),
    ).components.get('platform.db')

    expect(added && overlayLabel(added, t)).toBe('geplant · hinzufügen')
    expect(removedProposal && overlayLabel(removedProposal, t)).toBe('geplant · entfernen')
    // Same state, same colour — the words are what tells them apart.
    expect(added?.state).toBe(removedProposal?.state)
  })

  it('never states a judgement, only a phase of work', () => {
    const model = buildChangeOverlays(
      input({ activeChanges: [activeChange({ operation: 'remove', targetId: 'platform.db' })] }),
    )
    const text = overlayTitle(model.components.get('platform.db')!, t)

    for (const verdict of ['Fehler', 'falsch', 'schlecht', 'Risiko', 'gefährlich', 'gut']) {
      expect(text.toLowerCase()).not.toContain(verdict.toLowerCase())
    }
  })
})
