import { describe, expect, it } from 'vitest'

import type { AppliedComponent, Component } from '@/api/types'
import { createI18n, type CanvasKey, type Language } from '@/i18n'
import { WORK_STATES } from '@/state/workStates'
import { appliedComponent, NESTED_COMPONENTS } from '@/test/architectureFixtures'

import type { ChangeOverlay } from './changeOverlays'
import { DISCLOSURE_LABEL_KEYS } from './detailLevel'
import {
  CANVAS_A11Y_KEYS,
  canvasAriaLabelConfig,
  edgeAccessibleName,
  identifyingNames,
  nodeAccessibleName,
  nodeDisclosureLabel,
  withEdgeAccessibility,
  withNodeAccessibility,
  componentNamesById,
  workStatePhrase,
  type CanvasVoice,
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
 * The voice the canvas passes in, built from the **real** catalogues.
 *
 * Not a stub, for both halves. Counted nouns are localised (#40) and a
 * hand-written double would prove that the plumbing works while saying nothing
 * about whether `count.relationship` exists or whether German and English
 * pluralise the same number the same way. The sentences around them are
 * localised too since #42, and a stubbed `t` would hide a key that is missing
 * from a catalogue behind a plausible-looking string.
 */
function voiceFor(language: Language): CanvasVoice {
  const instance = createI18n({ language })
  const count: CountText = (noun, value) =>
    instance.t(`count.${noun}`, { count: value, ns: 'common' })
  return { t: instance.getFixedT(null, 'canvas'), count }
}

const voice = voiceFor('de')
/** The German rendering of a canvas key, for readable expectations. */
const say = (key: CanvasKey): string => voice.t(key)

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
    const names = identifyingNames(nodes, voice)

    expect(names.get('platform.db')).toBe('Orders DB, Datenspeicher')
    expect(names.get('external.payments')).toBe('Payment Provider, Extern')
  })

  it('tells a container apart from a leaf, with the number of components in it', () => {
    const names = identifyingNames(nodesOf(NESTED_COMPONENTS), voice)

    // `platform.core` holds `orders` and `billing`.
    expect(names.get('platform.core')).toBe('Core Services, Service, Container mit 2 Komponenten')
    // A container with exactly one child says "Komponente", not "Komponenten".
    expect(names.get('platform.api.http')).toBe('HTTP Layer, Modul, Container mit 1 Komponente')
    expect(names.get('platform.api.http.router')).toBe('Router, Modul')
  })

  it('leaves the reported name, id and kind exactly as the agent reported them', () => {
    const names = identifyingNames(nodesOf(NESTED_COMPONENTS), voice)
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
      voice,
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
      voice,
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
      voice,
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
      voice,
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
    const names = [...identifyingNames(nodes, voice).values()]

    expect(names).toHaveLength(nodes.length)
    expect(new Set(names).size).toBe(nodes.length)
  })
})

describe('canvas accessibility — the reported work state, in words', () => {
  it('uses the one central definition and never a second vocabulary', () => {
    for (const definition of WORK_STATES) {
      const phrase = workStatePhrase(overlay({ state: definition.id, operation: null }), voice)
      expect(phrase[0]).toBe(say(definition.labelKey))
    }
  })

  it('spells out the operation, so two states of the same colour differ in words', () => {
    expect(workStatePhrase(overlay({ state: 'planned', operation: 'add' }), voice)).toEqual([
      'geplant · hinzufügen',
    ])
    expect(workStatePhrase(overlay({ state: 'planned', operation: 'remove' }), voice)).toEqual([
      'geplant · entfernen',
    ])
  })

  it('says explicitly when nothing was reported', () => {
    expect(workStatePhrase(null, voice)).toEqual([say(CANVAS_A11Y_KEYS.noWorkState)])
  })

  it('marks a proposal and a ghost as not being part of the applied model', () => {
    expect(workStatePhrase(overlay({ presence: 'proposal' }), voice)).toContain(
      say(CANVAS_A11Y_KEYS.proposalNote),
    )
    expect(
      workStatePhrase(overlay({ state: 'removed', operation: 'remove', presence: 'ghost' }), voice),
    ).toContain(say(CANVAS_A11Y_KEYS.ghostNote))
  })

  it('counts the agents instead of dropping one of them', () => {
    expect(workStatePhrase(overlay({ agentIds: ['a', 'b'] }), voice)).toContain(
      '2 Agents melden dazu',
    )
  })

  it('never adds a judgement of its own', () => {
    const forbidden = /gut|schlecht|falsch|richtig|riskant|Fehler|Problem/i
    const spoken = [
      ...WORK_STATES.flatMap((definition) =>
        workStatePhrase(overlay({ state: definition.id, operation: 'remove' }), voice),
      ),
      say(CANVAS_A11Y_KEYS.graphInstructions),
      say(CANVAS_A11Y_KEYS.nodeInstructions),
      say(CANVAS_A11Y_KEYS.edgeInstructions),
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

    expect(nodeAccessibleName(withState, 'Orders DB, Datenspeicher', voice)).toBe(
      'Orders DB, Datenspeicher, aktiv',
    )
    expect(nodeAccessibleName(node, 'Orders DB, Datenspeicher', voice)).toBe(
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

    expect(nodeAccessibleName(closed, 'API Gateway, Service, Container mit 2 Komponenten', voice)).toBe(
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

    const name = nodeAccessibleName(rolledUp, 'API Gateway, Service', voice)
    expect(name).toContain('aktiv')
    expect(name).toContain(say(CANVAS_A11Y_KEYS.rolledUpNote))
  })

  it('keeps the group role, a role description and the current-item state', () => {
    const nodes = withNodeAccessibility(
      nodesOf(NESTED_COMPONENTS).map((node) =>
        node.id === 'platform.db' ? { ...node, selected: true } : node,
      ),
      voice,
    )

    for (const node of nodes) {
      // Not `button`: a container renders a real disclosure control inside it,
      // and a widget role would make that child presentational.
      expect(node.ariaRole).toBe('group')
      expect(node.ariaLabel).toBeTruthy()
      expect(node.domAttributes?.['aria-roledescription']).toBe(
        node.data.isCompound
          ? say(CANVAS_A11Y_KEYS.containerRoleDescription)
          : say(CANVAS_A11Y_KEYS.componentRoleDescription),
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

  it('marks both endpoint rings as current for a relationship selection', () => {
    const nodes = withNodeAccessibility(
      nodesOf(NESTED_COMPONENTS).map((node) =>
        node.id === 'platform.api.http.router' || node.id === 'platform.core.orders'
          ? { ...node, data: { ...node.data, relationshipSelected: true } }
          : node,
      ),
      voice,
    )

    expect(
      nodes.find((node) => node.id === 'platform.api.http.router')?.domAttributes,
    ).toHaveProperty('aria-current', true)
    expect(
      nodes.find((node) => node.id === 'platform.core.orders')?.domAttributes,
    ).toHaveProperty('aria-current', true)
    expect(nodes.find((node) => node.id === 'platform.db')?.domAttributes).not.toHaveProperty(
      'aria-current',
    )
  })

  it('names the disclosure control after the container it opens', () => {
    expect(nodeDisclosureLabel('API Gateway', false, voice, 3)).toBe(
      'Aufklappen: API Gateway (3 Komponenten)',
    )
    expect(nodeDisclosureLabel('API Gateway', false, voice)).toBe('Aufklappen: API Gateway')
    expect(nodeDisclosureLabel('API Gateway', true, voice)).toBe('Einklappen: API Gateway')
  })

  it('takes the disclosure verbs from the collection #34 already owns', () => {
    expect(nodeDisclosureLabel('X', false, voice)).toContain(
      say(DISCLOSURE_LABEL_KEYS.expand),
    )
    expect(nodeDisclosureLabel('X', true, voice)).toContain(
      say(DISCLOSURE_LABEL_KEYS.collapse),
    )
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
    expect(edgeAccessibleName(edge!, names, voice)).toBe(
      'Gemeldete Beziehung von Orders zu Orders DB, Datenzugriff SELECT/INSERT, kein Änderungsstatus gemeldet',
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

    const label = edgeAccessibleName(edge!, names, voice)
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
    for (const edge of withEdgeAccessibility(model.edges, names, voice)) {
      expect(edge.ariaLabel).toBeTruthy()
      expect(edge.domAttributes?.['aria-roledescription']).toBe(
        say(CANVAS_A11Y_KEYS.relationshipRoleDescription),
      )
    }
  })
})

describe('canvas accessibility — the instructions describe what is really there', () => {
  it('replaces React Flow’s English defaults on both node description keys', () => {
    const config = canvasAriaLabelConfig(voice.t)
    expect(config['node.a11yDescription.default']).toBe(
      say(CANVAS_A11Y_KEYS.nodeInstructions),
    )
    expect(config['node.a11yDescription.keyboardDisabled']).toBe(
      say(CANVAS_A11Y_KEYS.nodeInstructions),
    )
  })

  it('never offers deleting or moving — the cockpit only observes', () => {
    const spoken = [
      say(CANVAS_A11Y_KEYS.graphInstructions),
      say(CANVAS_A11Y_KEYS.nodeInstructions),
      say(CANVAS_A11Y_KEYS.edgeInstructions),
    ]
    for (const text of spoken) {
      expect(text.toLowerCase()).not.toContain('löschen')
      expect(text.toLowerCase()).not.toContain('verschieben')
    }
    expect(say(CANVAS_A11Y_KEYS.nodeInstructions)).toContain('Enter oder Leertaste')
    expect(say(CANVAS_A11Y_KEYS.graphInstructions)).toContain('Tabulatortaste')

    // …and they say the same thing in English, from the same keys.
    const english = voiceFor('en')
    expect(english.t(CANVAS_A11Y_KEYS.nodeInstructions)).toContain('Enter or Space')
    expect(english.t(CANVAS_A11Y_KEYS.graphInstructions)).toContain('Tab')
  })
})

/**
 * Since #42 the whole accessible name follows the language: the counted nouns
 * come from `common:count.*` (#40) and the scaffolding around them from
 * `canvas:a11y.*`. A screen reader reading English must hear neither
 * "1 Komponenten" nor "Container mit 2 components".
 */
describe('canvas accessibility — the whole name follows the language', () => {
  const containerOf = (language: Language, childCount: number): string => {
    const nodes = nodesOf(NESTED_COMPONENTS)
    const node = nodes.find((one) => one.id === 'platform.core') as ArchitectureNode
    const sized: ArchitectureNode = { ...node, data: { ...node.data, childCount } }
    return identifyingNames([sized], voiceFor(language)).get('platform.core') ?? ''
  }

  it('counts components and names the container in each language', () => {
    // The component name and its reported kind are the agent's; only the kind
    // *word* and the scaffolding are ours.
    expect(containerOf('de', 2)).toBe('Core Services, Service, Container mit 2 Komponenten')
    expect(containerOf('en', 2)).toBe(
      'Core Services, Service, container holding 2 components',
    )
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

    expect(nodeAccessibleName(closed, 'API Gateway', voiceFor('de'))).toContain(
      'eingeklappt, 3 Komponenten verborgen',
    )
    expect(nodeAccessibleName(closed, 'API Gateway', voiceFor('en'))).toContain(
      'collapsed, 3 components hidden',
    )
  })

  it('counts and names the relationships of a bundle', () => {
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

    const german = edgeAccessibleName(edge!, names, voiceFor('de'))
    const english = edgeAccessibleName(edge!, names, voiceFor('en'))

    expect(german).toContain('Sammelkante mit 2 Beziehungen')
    expect(english).toContain('bundled edge with 2 relationships')
    // The reported NATS topics themselves are identical in both languages.
    for (const channel of ['a', 'b']) {
      expect(german).toContain(`NATS-Topic ${channel}`)
      expect(english).toContain(`NATS topic ${channel}`)
    }
  })

  it('counts the agents behind one element, in both languages', () => {
    const twoAgents = overlay({ agentIds: ['a', 'b'] })
    expect(workStatePhrase(twoAgents, voiceFor('de'))).toContain('2 Agents melden dazu')
    expect(workStatePhrase(twoAgents, voiceFor('en'))).toContain(
      '2 agents are reporting on it',
    )
  })

  it('names the disclosure control with a localised count', () => {
    expect(nodeDisclosureLabel('Backend', false, voiceFor('de'), 10)).toBe(
      'Aufklappen: Backend (10 Komponenten)',
    )
    expect(nodeDisclosureLabel('Backend', false, voiceFor('en'), 10)).toBe(
      'Expand: Backend (10 components)',
    )
  })
})
