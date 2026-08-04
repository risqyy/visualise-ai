import { describe, expect, it } from 'vitest'

import type { AppliedComponent, Component } from '@/api/types'
import { createI18n, type Language } from '@/i18n'
import { WORK_STATES } from '@/state/workStates'
import { appliedComponent, NESTED_COMPONENTS } from '@/test/architectureFixtures'

import type { ChangeOverlay } from './changeOverlays'
import { DISCLOSURE_LABELS } from './detailLevel'
import {
  CANVAS_A11Y_TEXT,
  CANVAS_ARIA_LABEL_CONFIG,
  edgeAccessibleName,
  identifyingNames,
  nodeAccessibleName,
  nodeDisclosureLabel,
  withEdgeAccessibility,
  withNodeAccessibility,
  componentNamesById,
  workStatePhrase,
  type CountText,
} from './canvasAccessibility'
import { projectArchitecture, type ArchitectureNode } from './graphProjection'

/**
 * The accessible surface of the canvas, tested where it is decided.
 *
 * These are the properties a screen reader depends on and a screenshot cannot
 * show: that every node has a name, that no two names are the same, that the
 * name says what the box says, and that nothing is announced which the agent
 * did not report.
 */

/**
 * The counting function the canvas passes in, built from the **real**
 * catalogues.
 *
 * Not a stub: counted nouns are the one part of an accessible name that is
 * already localised (#40), and a hand-written double here would prove that the
 * plumbing works while saying nothing about whether `count.relationship`
 * exists or whether German and English pluralise the same number the same way.
 */
function countTextFor(language: Language): CountText {
  const instance = createI18n({ language })
  return (noun, count) => instance.t(`count.${noun}`, { count, ns: 'common' })
}

const countText = countTextFor('de')

function nodesOf(components: readonly AppliedComponent[]): ArchitectureNode[] {
  return projectArchitecture({ components, relationships: [] }).nodes
}

function overlay(partial: Partial<ChangeOverlay> = {}): ChangeOverlay {
  return {
    targetKind: 'component',
    targetId: 'platform.db',
    state: 'planned',
    presence: 'applied',
    operation: 'add',
    contributions: [],
    agentIds: ['subagent-architecture-mapper'],
    descriptor: null,
    ...partial,
  }
}

describe('canvas accessibility — every node is named', () => {
  it('names a node after the reported component name and its kind', () => {
    const nodes = nodesOf(NESTED_COMPONENTS)
    const names = identifyingNames(nodes, countText)

    expect(names.get('platform.db')).toBe('Orders DB, Datenspeicher')
    expect(names.get('external.payments')).toBe('Payment Provider, Extern')
  })

  it('tells a container apart from a leaf, with the number of components in it', () => {
    const names = identifyingNames(nodesOf(NESTED_COMPONENTS), countText)

    // `platform.core` holds `orders` and `billing`.
    expect(names.get('platform.core')).toBe('Core Services, Service, Container mit 2 Komponenten')
    // A container with exactly one child says "Komponente", not "Komponenten".
    expect(names.get('platform.api.http')).toBe('HTTP Layer, Modul, Container mit 1 Komponente')
    expect(names.get('platform.api.http.router')).toBe('Router, Modul')
  })

  it('leaves the reported name, id and kind exactly as the agent reported them', () => {
    const names = identifyingNames(nodesOf(NESTED_COMPONENTS), countText)
    for (const component of NESTED_COMPONENTS) {
      expect(names.get(component.componentId)).toContain(component.name)
    }
  })
})

describe('canvas accessibility — names stay unique', () => {
  /**
   * Nothing forbids an agent from reporting the same component name twice: a
   * `Router` in the HTTP layer and a `Router` in the gRPC layer are two
   * different components with two different ids. The picture tells them apart
   * by where they sit; the accessible name has to do the same.
   */
  const SAME_NAME_IN_TWO_CONTAINERS: Component[] = [
    { componentId: 'a', name: 'API Gateway', kind: 'service', parentComponentId: null },
    { componentId: 'b', name: 'Worker Pool', kind: 'service', parentComponentId: null },
    { componentId: 'a.router', name: 'Router', kind: 'module', parentComponentId: 'a' },
    { componentId: 'b.router', name: 'Router', kind: 'module', parentComponentId: 'b' },
  ]

  it('qualifies two identically named components with their containers', () => {
    const names = identifyingNames(
      nodesOf(SAME_NAME_IN_TWO_CONTAINERS.map((one) => appliedComponent(one))),
      countText,
    )

    expect(names.get('a.router')).toBe('Router, Modul, in API Gateway')
    expect(names.get('b.router')).toBe('Router, Modul, in Worker Pool')
    expect(names.get('a.router')).not.toBe(names.get('b.router'))
  })

  it('only qualifies the names that would otherwise collide', () => {
    const withCache: Component[] = [
      ...SAME_NAME_IN_TWO_CONTAINERS,
      { componentId: 'a.cache', name: 'Cache', kind: 'datastore', parentComponentId: 'a' },
    ]
    const names = identifyingNames(
      nodesOf(withCache.map((one) => appliedComponent(one))),
      countText,
    )

    // `Cache` is unambiguous on its own and does not drag its container along.
    expect(names.get('a.cache')).toBe('Cache, Datenspeicher')
  })

  it('walks further up when the direct container is not enough', () => {
    const deep: Component[] = [
      { componentId: 'eu', name: 'EU', kind: 'system', parentComponentId: null },
      { componentId: 'us', name: 'US', kind: 'system', parentComponentId: null },
      { componentId: 'eu.edge', name: 'Edge', kind: 'service', parentComponentId: 'eu' },
      { componentId: 'us.edge', name: 'Edge', kind: 'service', parentComponentId: 'us' },
      { componentId: 'eu.edge.router', name: 'Router', kind: 'module', parentComponentId: 'eu.edge' },
      { componentId: 'us.edge.router', name: 'Router', kind: 'module', parentComponentId: 'us.edge' },
    ]
    const names = identifyingNames(
      nodesOf(deep.map((one) => appliedComponent(one))),
      countText,
    )

    expect(names.get('eu.edge.router')).toBe('Router, Modul, in Edge, in EU')
    expect(names.get('us.edge.router')).toBe('Router, Modul, in Edge, in US')
  })

  it('falls back to the reported component id when even the path collides', () => {
    const siblings: Component[] = [
      { componentId: 'root', name: 'Platform', kind: 'system', parentComponentId: null },
      { componentId: 'root.one', name: 'Worker', kind: 'module', parentComponentId: 'root' },
      { componentId: 'root.two', name: 'Worker', kind: 'module', parentComponentId: 'root' },
    ]
    const names = identifyingNames(
      nodesOf(siblings.map((one) => appliedComponent(one))),
      countText,
    )

    expect(names.get('root.one')).toBe(
      'Worker, Modul, in Platform, Komponenten-ID root.one',
    )
    expect(names.get('root.two')).toBe(
      'Worker, Modul, in Platform, Komponenten-ID root.two',
    )
  })

  it('gives every node of the nested snapshot a distinct name', () => {
    const nodes = nodesOf(NESTED_COMPONENTS)
    const names = [...identifyingNames(nodes, countText).values()]

    expect(names).toHaveLength(nodes.length)
    expect(new Set(names).size).toBe(nodes.length)
  })
})

describe('canvas accessibility — the reported work state, in words', () => {
  it('uses the one central definition and never a second vocabulary', () => {
    for (const definition of WORK_STATES) {
      const phrase = workStatePhrase(overlay({ state: definition.id, operation: null }), countText)
      expect(phrase[0]).toBe(definition.label)
    }
  })

  it('spells out the operation, so two states of the same colour differ in words', () => {
    expect(workStatePhrase(overlay({ state: 'planned', operation: 'add' }), countText)).toEqual([
      'geplant · hinzufügen',
    ])
    expect(workStatePhrase(overlay({ state: 'planned', operation: 'remove' }), countText)).toEqual([
      'geplant · entfernen',
    ])
  })

  it('says explicitly when nothing was reported', () => {
    expect(workStatePhrase(null, countText)).toEqual([CANVAS_A11Y_TEXT.noWorkState])
  })

  it('marks a proposal and a ghost as not being part of the applied model', () => {
    expect(workStatePhrase(overlay({ presence: 'proposal' }), countText)).toContain(
      CANVAS_A11Y_TEXT.proposalNote,
    )
    expect(
      workStatePhrase(overlay({ state: 'removed', operation: 'remove', presence: 'ghost' }), countText),
    ).toContain(CANVAS_A11Y_TEXT.ghostNote)
  })

  it('counts the agents instead of dropping one of them', () => {
    expect(workStatePhrase(overlay({ agentIds: ['a', 'b'] }), countText)).toContain(
      '2 Agents melden dazu',
    )
  })

  it('never adds a judgement of its own', () => {
    const forbidden = /gut|schlecht|falsch|richtig|riskant|Fehler|Problem/i
    const spoken = [
      ...WORK_STATES.flatMap((definition) =>
        workStatePhrase(overlay({ state: definition.id, operation: 'remove' }), countText),
      ),
      CANVAS_A11Y_TEXT.graphInstructions,
      CANVAS_A11Y_TEXT.nodeInstructions,
      CANVAS_A11Y_TEXT.edgeInstructions,
    ]
    for (const text of spoken) expect(text).not.toMatch(forbidden)
  })
})

describe('canvas accessibility — the full node name', () => {
  it('appends the reported state to the identity', () => {
    const nodes = nodesOf(NESTED_COMPONENTS)
    const node = nodes.find((one) => one.id === 'platform.db') as ArchitectureNode
    const withState: ArchitectureNode = {
      ...node,
      data: { ...node.data, overlay: overlay({ state: 'active', operation: null }) },
    }

    expect(nodeAccessibleName(withState, 'Orders DB, Datenspeicher', countText)).toBe(
      'Orders DB, Datenspeicher, aktiv',
    )
    expect(nodeAccessibleName(node, 'Orders DB, Datenspeicher', countText)).toBe(
      'Orders DB, Datenspeicher, kein Änderungsstatus gemeldet',
    )
  })

  it('says that a container is closed and how much is behind it', () => {
    const nodes = nodesOf(NESTED_COMPONENTS)
    const node = nodes.find((one) => one.id === 'platform.api') as ArchitectureNode
    const closed: ArchitectureNode = {
      ...node,
      data: { ...node.data, collapsed: true, hiddenDescendantCount: 3 },
    }

    expect(nodeAccessibleName(closed, 'API Gateway, Service, Container mit 2 Komponenten', countText)).toBe(
      'API Gateway, Service, Container mit 2 Komponenten, eingeklappt, 3 Komponenten verborgen, kein Änderungsstatus gemeldet',
    )
  })

  it('does not claim a container is what an agent is working on inside it', () => {
    const nodes = nodesOf(NESTED_COMPONENTS)
    const node = nodes.find((one) => one.id === 'platform.api') as ArchitectureNode
    const rolledUp: ArchitectureNode = {
      ...node,
      data: {
        ...node.data,
        collapsed: true,
        hiddenDescendantCount: 3,
        overlay: overlay({ state: 'active', operation: null }),
        overlayRolledUp: true,
      },
    }

    const name = nodeAccessibleName(rolledUp, 'API Gateway, Service', countText)
    expect(name).toContain('aktiv')
    expect(name).toContain(CANVAS_A11Y_TEXT.rolledUpNote)
  })

  it('keeps the group role, a role description and the current-item state', () => {
    const nodes = withNodeAccessibility(
      nodesOf(NESTED_COMPONENTS).map((node) =>
        node.id === 'platform.db' ? { ...node, selected: true } : node,
      ),
      countText,
    )

    for (const node of nodes) {
      // Not `button`: a container renders a real disclosure control inside it,
      // and a widget role would make that child presentational.
      expect(node.ariaRole).toBe('group')
      expect(node.ariaLabel).toBeTruthy()
      expect(node.domAttributes?.['aria-roledescription']).toBe(
        node.data.isCompound
          ? CANVAS_A11Y_TEXT.containerRoleDescription
          : CANVAS_A11Y_TEXT.componentRoleDescription,
      )
    }

    const selected = nodes.find((node) => node.id === 'platform.db')
    expect(selected?.domAttributes?.['aria-current']).toBe(true)
    // Absent rather than `false`: `aria-current="false"` means "not the current
    // item" and is noise on 27 of 28 boxes.
    expect(
      nodes.find((node) => node.id === 'platform.bus')?.domAttributes,
    ).not.toHaveProperty('aria-current')
  })

  it('names the disclosure control after the container it opens', () => {
    expect(nodeDisclosureLabel('API Gateway', false, countText, 3)).toBe(
      'Aufklappen: API Gateway (3 Komponenten)',
    )
    expect(nodeDisclosureLabel('API Gateway', false, countText)).toBe('Aufklappen: API Gateway')
    expect(nodeDisclosureLabel('API Gateway', true, countText)).toBe('Einklappen: API Gateway')
  })

  it('takes the disclosure verbs from the collection #34 already owns', () => {
    expect(nodeDisclosureLabel('X', false, countText)).toContain(DISCLOSURE_LABELS.expand)
    expect(nodeDisclosureLabel('X', true, countText)).toContain(DISCLOSURE_LABELS.collapse)
  })
})

describe('canvas accessibility — edges are named from what they carry', () => {
  const projection = projectArchitecture({
    components: NESTED_COMPONENTS,
    relationships: [],
  })
  const names = componentNamesById(projection.nodes)

  it('names a single relationship with its endpoints and its kind', () => {
    const model = projectArchitecture({
      components: NESTED_COMPONENTS,
      relationships: [
        {
          relationshipId: 'r-03',
          sourceComponentId: 'platform.core.orders',
          targetComponentId: 'platform.db',
          kind: 'data',
          label: '',
          protocol: 'SQL',
          operation: 'SELECT/INSERT',
          channel: '',
          appliedAt: '2026-08-04T09:05:00Z',
          appliedByAgentId: 'orchestrator-root',
          appliedRunId: 'run-2026-08-04-0001',
          position: 1,
        },
      ],
    })
    const edge = model.edges[0]
    expect(edge).toBeDefined()
    expect(edgeAccessibleName(edge!, names, countText)).toBe(
      'Beziehung von Orders zu Orders DB, Datenzugriff SELECT/INSERT, kein Änderungsstatus gemeldet',
    )
  })

  it('says how many relationships a bundle carries and lists every one of them', () => {
    const topics = ['orders.created', 'orders.cancelled'].map((channel, index) => ({
      relationshipId: `r-1${index}`,
      sourceComponentId: 'platform.core.orders' as const,
      targetComponentId: 'platform.bus' as const,
      kind: 'nats_topic' as const,
      label: '',
      protocol: 'NATS',
      operation: 'publish',
      channel,
      appliedAt: '2026-08-04T09:05:00Z',
      appliedByAgentId: 'orchestrator-root',
      appliedRunId: 'run-2026-08-04-0001',
      position: index + 1,
    }))
    const model = projectArchitecture({
      components: NESTED_COMPONENTS,
      relationships: topics,
    })
    const edge = model.edges[0]
    expect(edge).toBeDefined()

    const label = edgeAccessibleName(edge!, names, countText)
    expect(label).toContain('Sammelkante mit 2 Beziehungen')
    // Both topics stay individually announced — a bundle is a rendering, not a
    // merge (ADR 0008).
    expect(label).toContain('orders.created')
    expect(label).toContain('orders.cancelled')
  })

  it('marks every edge as a relationship and gives it a name', () => {
    const model = projectArchitecture({
      components: NESTED_COMPONENTS,
      relationships: [],
    })
    for (const edge of withEdgeAccessibility(model.edges, names, countText)) {
      expect(edge.ariaLabel).toBeTruthy()
      expect(edge.domAttributes?.['aria-roledescription']).toBe(
        CANVAS_A11Y_TEXT.relationshipRoleDescription,
      )
    }
  })
})

describe('canvas accessibility — the instructions describe what is really there', () => {
  it('replaces React Flow’s English defaults on both node description keys', () => {
    expect(CANVAS_ARIA_LABEL_CONFIG['node.a11yDescription.default']).toBe(
      CANVAS_A11Y_TEXT.nodeInstructions,
    )
    expect(CANVAS_ARIA_LABEL_CONFIG['node.a11yDescription.keyboardDisabled']).toBe(
      CANVAS_A11Y_TEXT.nodeInstructions,
    )
  })

  it('never offers deleting or moving — the cockpit only observes', () => {
    const spoken = [
      CANVAS_A11Y_TEXT.graphInstructions,
      CANVAS_A11Y_TEXT.nodeInstructions,
      CANVAS_A11Y_TEXT.edgeInstructions,
    ]
    for (const text of spoken) {
      expect(text.toLowerCase()).not.toContain('löschen')
      expect(text.toLowerCase()).not.toContain('verschieben')
    }
    expect(CANVAS_A11Y_TEXT.nodeInstructions).toContain('Enter oder Leertaste')
    expect(CANVAS_A11Y_TEXT.graphInstructions).toContain('Tabulatortaste')
  })
})

/**
 * Counted nouns come from the catalogues, in the reader's language.
 *
 * This is the one part of an accessible name that is already localised (#40 /
 * ADR 0019). The surrounding scaffolding is still German until #42 migrates the
 * `canvas` namespace — but a screen reader reading English must not hear
 * "1 Komponenten", and it must not hear a German plural either.
 */
describe('canvas accessibility — the counting follows the language', () => {
  const containerOf = (language: Language, childCount: number): string => {
    const nodes = nodesOf(NESTED_COMPONENTS)
    const node = nodes.find((one) => one.id === 'platform.core') as ArchitectureNode
    const sized: ArchitectureNode = { ...node, data: { ...node.data, childCount } }
    return identifyingNames([sized], countTextFor(language)).get('platform.core') ?? ''
  }

  it('counts components in German and in English', () => {
    expect(containerOf('de', 2)).toBe('Core Services, Service, Container mit 2 Komponenten')
    expect(containerOf('en', 2)).toBe('Core Services, Service, Container mit 2 components')
  })

  it('uses the singular form of each language for exactly one', () => {
    expect(containerOf('de', 1)).toContain('1 Komponente')
    expect(containerOf('de', 1)).not.toContain('1 Komponenten')
    expect(containerOf('en', 1)).toContain('1 component')
    expect(containerOf('en', 1)).not.toContain('1 components')
  })

  it('counts the components a closed container hides, in both languages', () => {
    const nodes = nodesOf(NESTED_COMPONENTS)
    const node = nodes.find((one) => one.id === 'platform.api') as ArchitectureNode
    const closed: ArchitectureNode = {
      ...node,
      data: { ...node.data, collapsed: true, hiddenDescendantCount: 3 },
    }

    expect(nodeAccessibleName(closed, 'API Gateway', countTextFor('de'))).toContain(
      'eingeklappt, 3 Komponenten verborgen',
    )
    expect(nodeAccessibleName(closed, 'API Gateway', countTextFor('en'))).toContain(
      'eingeklappt, 3 components verborgen',
    )
  })

  it('counts the relationships of a bundle — the key #40 had no caller for', () => {
    const topics = ['a', 'b'].map((channel, index) => ({
      relationshipId: `r-2${index}`,
      sourceComponentId: 'platform.core.orders' as const,
      targetComponentId: 'platform.bus' as const,
      kind: 'nats_topic' as const,
      label: '',
      protocol: 'NATS',
      operation: 'publish',
      channel,
      appliedAt: '2026-08-04T09:05:00Z',
      appliedByAgentId: 'orchestrator-root',
      appliedRunId: 'run-2026-08-04-0001',
      position: index + 1,
    }))
    const model = projectArchitecture({
      components: NESTED_COMPONENTS,
      relationships: topics,
    })
    const edge = model.edges[0]
    expect(edge).toBeDefined()
    const names = componentNamesById(model.nodes)

    expect(edgeAccessibleName(edge!, names, countTextFor('de'))).toContain(
      'Sammelkante mit 2 Beziehungen',
    )
    expect(edgeAccessibleName(edge!, names, countTextFor('en'))).toContain(
      'Sammelkante mit 2 relationships',
    )
  })

  it('counts the agents behind one element, in both languages', () => {
    const twoAgents = overlay({ agentIds: ['a', 'b'] })
    expect(workStatePhrase(twoAgents, countTextFor('de'))).toContain('2 Agents melden dazu')
    expect(workStatePhrase(twoAgents, countTextFor('en'))).toContain('2 agents melden dazu')
  })

  it('names the disclosure control with a localised count', () => {
    expect(nodeDisclosureLabel('Backend', false, countTextFor('de'), 10)).toBe(
      'Aufklappen: Backend (10 Komponenten)',
    )
    expect(nodeDisclosureLabel('Backend', false, countTextFor('en'), 10)).toBe(
      'Aufklappen: Backend (10 components)',
    )
  })
})
