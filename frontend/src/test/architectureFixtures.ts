import type {
  ActiveChange,
  AppliedComponent,
  AppliedRelationship,
  ArchitectureResponse,
  Component,
  Relationship,
  RelationshipKind,
} from '@/api/types'

/**
 * A nested architecture snapshot used by the canvas tests.
 *
 * It is deliberately not minimal — it is the smallest snapshot that still
 * exercises everything the canvas has to get right:
 *
 * * **four hierarchy levels** (`platform` → `platform.api` → `platform.api.http`
 *   → `platform.api.http.router`) plus a second root, so compound nesting is
 *   more than one level deep,
 * * **all six relationship kinds** of the contract,
 * * **three separate NATS topics between the same pair of components**, which
 *   is the case that must be bundled visually and stay individually resolvable,
 * * fields that the read API reports as empty strings rather than omitting them.
 *
 * The rows below are written as the *reported* descriptors (`Component`,
 * `Relationship`) and lifted into the read-model shapes the architecture
 * endpoint actually answers with (`AppliedComponent`, `AppliedRelationship`) by
 * `appliedComponent` / `appliedRelationship`. Those two builders are the single
 * place that fills in the provenance and the empty-string defaults the contract
 * requires, so a fixture can never accidentally describe a shape the read API
 * does not serve.
 *
 * It is test data only and never reaches application code.
 */

const APPLIED_AT = '2026-08-04T09:05:00Z'
const APPLIED_BY_AGENT_ID = 'orchestrator-root'
const APPLIED_RUN_ID = 'run-2026-08-04-0001'

type Provenance = Partial<
  Pick<AppliedComponent, 'appliedAt' | 'appliedByAgentId' | 'appliedRunId' | 'position'>
>

/**
 * Lifts a reported component into the applied read model.
 *
 * The read API never omits an optional field — it reports "not reported" as an
 * empty string, an empty object or an empty array.
 */
export function appliedComponent(
  reported: Component,
  provenance: Provenance = {},
): AppliedComponent {
  return {
    appliedAt: APPLIED_AT,
    appliedByAgentId: APPLIED_BY_AGENT_ID,
    appliedRunId: APPLIED_RUN_ID,
    position: 1,
    ...provenance,
    ...reported,
    description: reported.description ?? '',
    technology: reported.technology ?? {},
    tags: reported.tags ?? [],
  }
}

/** Lifts a reported relationship into the applied read model. */
export function appliedRelationship(
  reported: Relationship,
  provenance: Provenance = {},
): AppliedRelationship {
  return {
    appliedAt: APPLIED_AT,
    appliedByAgentId: APPLIED_BY_AGENT_ID,
    appliedRunId: APPLIED_RUN_ID,
    position: 1,
    ...provenance,
    ...reported,
    label: reported.label ?? '',
    protocol: reported.protocol ?? '',
    operation: reported.operation ?? '',
    channel: reported.channel ?? '',
  }
}

const REPORTED_COMPONENTS: Component[] = [
  {
    componentId: 'platform',
    name: 'Shop Platform',
    kind: 'system',
    parentComponentId: null,
    description: 'Gesamtsystem des Shops.',
    tags: ['core'],
  },
  {
    componentId: 'platform.api',
    name: 'API Gateway',
    kind: 'service',
    parentComponentId: 'platform',
    technology: { language: 'Go', framework: 'chi', runtime: 'container', version: '1.24' },
    tags: ['edge', 'public'],
  },
  {
    componentId: 'platform.api.http',
    name: 'HTTP Layer',
    kind: 'module',
    parentComponentId: 'platform.api',
    technology: { language: 'Go' },
    tags: [],
  },
  {
    componentId: 'platform.api.http.router',
    name: 'Router',
    kind: 'module',
    parentComponentId: 'platform.api.http',
    technology: { language: 'Go', framework: 'chi' },
    tags: ['routing'],
  },
  {
    componentId: 'platform.api.grpc',
    name: 'gRPC Layer',
    kind: 'module',
    parentComponentId: 'platform.api',
    technology: { language: 'Go', framework: 'grpc-go', version: '1.68' },
  },
  {
    componentId: 'platform.core',
    name: 'Core Services',
    kind: 'service',
    parentComponentId: 'platform',
    technology: {},
    tags: [],
  },
  {
    componentId: 'platform.core.orders',
    name: 'Orders',
    kind: 'module',
    parentComponentId: 'platform.core',
    technology: { language: 'Go', runtime: 'container' },
    tags: ['domain', 'orders'],
  },
  {
    componentId: 'platform.core.billing',
    name: 'Billing',
    kind: 'module',
    parentComponentId: 'platform.core',
    technology: { language: 'Go' },
    tags: ['domain'],
  },
  {
    componentId: 'platform.db',
    name: 'Orders DB',
    kind: 'datastore',
    parentComponentId: 'platform',
    technology: { runtime: 'PostgreSQL', version: '17' },
    tags: ['stateful'],
  },
  {
    componentId: 'platform.bus',
    name: 'Message Bus',
    kind: 'queue',
    parentComponentId: 'platform',
    technology: { runtime: 'NATS', version: '2.10' },
  },
  {
    componentId: 'external.payments',
    name: 'Payment Provider',
    kind: 'external',
    parentComponentId: null,
    description: 'Externer Zahlungsdienstleister.',
  },
]

export const NESTED_COMPONENTS: AppliedComponent[] = REPORTED_COMPONENTS.map(
  (component, index) => appliedComponent(component, { position: index + 1 }),
)

const REPORTED_RELATIONSHIPS: Relationship[] = [
  {
    relationshipId: 'r-01',
    sourceComponentId: 'platform.api.http.router',
    targetComponentId: 'platform.core.orders',
    kind: 'http',
    label: 'Bestellung anlegen',
    protocol: 'HTTP/1.1',
    operation: 'POST /orders',
    channel: '',
  },
  {
    relationshipId: 'r-02',
    sourceComponentId: 'platform.api.grpc',
    targetComponentId: 'platform.core.billing',
    kind: 'grpc',
    label: '',
    protocol: 'gRPC',
    operation: 'Billing/Charge',
    channel: '',
  },
  {
    relationshipId: 'r-03',
    sourceComponentId: 'platform.core.orders',
    targetComponentId: 'platform.db',
    kind: 'data',
    label: 'Bestellungen lesen und schreiben',
    protocol: 'SQL',
    operation: 'SELECT/INSERT',
  },
  {
    relationshipId: 'r-04',
    sourceComponentId: 'platform.core.billing',
    targetComponentId: 'platform.bus',
    kind: 'async',
    protocol: 'NATS',
    channel: 'billing.events',
  },
  {
    relationshipId: 'r-05',
    sourceComponentId: 'platform.core.orders',
    targetComponentId: 'platform.bus',
    kind: 'nats_topic',
    protocol: 'NATS',
    channel: 'orders.created',
    operation: 'publish',
  },
  {
    relationshipId: 'r-06',
    sourceComponentId: 'platform.core.orders',
    targetComponentId: 'platform.bus',
    kind: 'nats_topic',
    protocol: 'NATS',
    channel: 'orders.cancelled',
    operation: 'publish',
  },
  {
    relationshipId: 'r-07',
    sourceComponentId: 'platform.core.orders',
    targetComponentId: 'platform.bus',
    kind: 'nats_topic',
    protocol: 'NATS',
    channel: 'orders.shipped',
    operation: 'publish',
  },
  {
    relationshipId: 'r-08',
    sourceComponentId: 'platform.core.billing',
    targetComponentId: 'external.payments',
    kind: 'dependency',
    label: 'SDK',
  },
]

export const NESTED_RELATIONSHIPS: AppliedRelationship[] = REPORTED_RELATIONSHIPS.map(
  (relationship, index) =>
    appliedRelationship(relationship, { position: REPORTED_COMPONENTS.length + index + 1 }),
)

/** The three topics that share the `orders → bus` node pair. */
export const BUNDLED_TOPIC_CHANNELS = [
  'orders.cancelled',
  'orders.created',
  'orders.shipped',
] as const

export const ALL_RELATIONSHIP_KINDS: readonly RelationshipKind[] = [
  'http',
  'grpc',
  'data',
  'async',
  'nats_topic',
  'dependency',
]

export const nestedArchitectureResponse: ArchitectureResponse = {
  projectPosition: 42,
  components: NESTED_COMPONENTS,
  relationships: NESTED_RELATIONSHIPS,
  activeChanges: [],
}

/**
 * The same model with one additional leaf component — used to simulate a live
 * update that really changes the architecture.
 */
export const grownArchitectureResponse: ArchitectureResponse = {
  projectPosition: 43,
  components: [
    ...NESTED_COMPONENTS,
    appliedComponent(
      {
        componentId: 'platform.core.shipping',
        name: 'Shipping',
        kind: 'module',
        parentComponentId: 'platform.core',
        technology: { language: 'Go' },
        tags: ['domain'],
      },
      { position: 43 },
    ),
  ],
  relationships: [
    ...NESTED_RELATIONSHIPS,
    appliedRelationship(
      {
        relationshipId: 'r-09',
        sourceComponentId: 'platform.core.shipping',
        targetComponentId: 'platform.bus',
        kind: 'nats_topic',
        protocol: 'NATS',
        channel: 'shipping.dispatched',
      },
      { position: 43 },
    ),
  ],
  activeChanges: [],
}

// ---------------------------------------------------------------------------
// A model that does not fit on a screen
// ---------------------------------------------------------------------------

/**
 * A deliberately large snapshot: **32 components over four hierarchy levels**.
 *
 * The acceptance criterion of #34 asks for at least 30 nodes, because that is
 * the size at which fitting everything into the centre pane drops the zoom far
 * below anything readable. The shape is generated rather than written out so
 * the intent stays visible: one system, four services, two modules each, two
 * leaves per module, plus two shared stores and one external client.
 *
 * Generated deterministically — same ids, same order, same relationships on
 * every run — so it can be used in the determinism assertions too.
 */
function buildLargeModel(): { components: Component[]; relationships: Relationship[] } {
  const components: Component[] = [
    { componentId: 'mesh', name: 'Mesh Platform', kind: 'system', parentComponentId: null },
    { componentId: 'edge.client', name: 'Edge Client', kind: 'external', parentComponentId: null },
    { componentId: 'mesh.db', name: 'Mesh Store', kind: 'datastore', parentComponentId: 'mesh' },
    { componentId: 'mesh.queue', name: 'Mesh Queue', kind: 'queue', parentComponentId: 'mesh' },
  ]
  const relationships: Relationship[] = [
    {
      relationshipId: 'lr-000',
      sourceComponentId: 'edge.client',
      targetComponentId: 'mesh',
      kind: 'http',
      protocol: 'HTTP/2',
      operation: 'GET /',
    },
  ]

  for (let service = 1; service <= 4; service += 1) {
    const serviceId = `mesh.s${service}`
    components.push({
      componentId: serviceId,
      name: `Service ${service}`,
      kind: 'service',
      parentComponentId: 'mesh',
      technology: { language: 'Go' },
    })
    for (const module of ['a', 'b']) {
      const moduleId = `${serviceId}.${module}`
      components.push({
        componentId: moduleId,
        name: `Modul ${service}${module.toUpperCase()}`,
        kind: 'module',
        parentComponentId: serviceId,
      })
      for (let leaf = 1; leaf <= 2; leaf += 1) {
        const leafId = `${moduleId}.l${leaf}`
        components.push({
          componentId: leafId,
          name: `Baustein ${service}${module.toUpperCase()}${leaf}`,
          kind: 'module',
          parentComponentId: moduleId,
          technology: { language: 'Go' },
        })
        relationships.push({
          relationshipId: `lr-${service}${module}${leaf}`,
          sourceComponentId: leafId,
          targetComponentId: leaf === 1 ? 'mesh.db' : 'mesh.queue',
          kind: leaf === 1 ? 'data' : 'async',
          protocol: leaf === 1 ? 'SQL' : 'NATS',
          ...(leaf === 1 ? { operation: 'SELECT' } : { channel: `mesh.s${service}` }),
        })
      }
    }
  }

  return { components, relationships }
}

const LARGE_MODEL = buildLargeModel()

/** A component of the large model four levels down; used for deep-link tests. */
export const LARGE_DEEP_COMPONENT_ID = 'mesh.s1.a.l1'
/** Its ancestors, root first — the containers a deep link has to open. */
export const LARGE_DEEP_ANCESTORS = ['mesh', 'mesh.s1', 'mesh.s1.a'] as const

export const LARGE_COMPONENTS: AppliedComponent[] = LARGE_MODEL.components.map(
  (component, index) => appliedComponent(component, { position: index + 1 }),
)

export const LARGE_RELATIONSHIPS: AppliedRelationship[] = LARGE_MODEL.relationships.map(
  (relationship, index) =>
    appliedRelationship(relationship, {
      position: LARGE_MODEL.components.length + index + 1,
    }),
)

export const largeArchitectureResponse: ArchitectureResponse = {
  projectPosition: 90,
  components: LARGE_COMPONENTS,
  relationships: LARGE_RELATIONSHIPS,
  activeChanges: [],
}

/** The large model with one more leaf — a real structural live update. */
export const largeGrownArchitectureResponse: ArchitectureResponse = {
  projectPosition: 91,
  components: [
    ...LARGE_COMPONENTS,
    appliedComponent(
      {
        componentId: 'mesh.s1.a.l3',
        name: 'Baustein 1A3',
        kind: 'module',
        parentComponentId: 'mesh.s1.a',
      },
      { position: 200 },
    ),
  ],
  relationships: [
    ...LARGE_RELATIONSHIPS,
    appliedRelationship(
      {
        relationshipId: 'lr-1a3',
        sourceComponentId: 'mesh.s1.a.l3',
        targetComponentId: 'mesh.db',
        kind: 'data',
        protocol: 'SQL',
      },
      { position: 201 },
    ),
  ],
  activeChanges: [],
}

// ---------------------------------------------------------------------------
// Change proposals
// ---------------------------------------------------------------------------

/** The component the overlay tests propose adding. Not in the applied model. */
export const SHIPPING_COMPONENT: Component = {
  componentId: 'platform.core.shipping',
  name: 'Shipping',
  kind: 'module',
  parentComponentId: 'platform.core',
  description: 'Versandabwicklung.',
  technology: { language: 'Go' },
  tags: ['domain'],
}

/** The relationship the overlay tests propose adding, next to the applied ones. */
export const SHIPPING_BUS_RELATIONSHIP: Relationship = {
  relationshipId: 'r-09',
  sourceComponentId: 'platform.core.shipping',
  targetComponentId: 'platform.bus',
  kind: 'nats_topic',
  protocol: 'NATS',
  channel: 'shipping.dispatched',
  operation: 'publish',
  label: '',
}

/**
 * A pending proposal as the read API returns it.
 *
 * `snapshot` carries the reported descriptor verbatim, exactly as the contract
 * specifies — that is what lets the canvas draw a proposal for a component the
 * applied model does not contain, without a second lookup.
 */
export function activeChange(overrides: Partial<ActiveChange> = {}): ActiveChange {
  return {
    changeId: 'change-0001',
    targetKind: 'component',
    targetId: SHIPPING_COMPONENT.componentId,
    operation: 'add',
    state: 'planned',
    runId: 'run-2026-08-04-0001',
    agentId: 'subagent-architecture-mapper',
    plannedAt: '2026-08-04T09:10:00Z',
    appliedAt: null,
    retractedAt: null,
    snapshot: SHIPPING_COMPONENT as unknown as Record<string, unknown>,
    position: 50,
    ...overrides,
  }
}

/** The nested model with a list of pending proposals on top of it. */
export function architectureWithChanges(
  changes: readonly ActiveChange[],
  overrides: Partial<ArchitectureResponse> = {},
): ArchitectureResponse {
  return {
    projectPosition: 60,
    components: NESTED_COMPONENTS,
    relationships: NESTED_RELATIONSHIPS,
    activeChanges: [...changes],
    ...overrides,
  }
}

/** Shuffles deterministically, so a re-ordered input list is reproducible. */
export function reorder<T>(items: readonly T[]): T[] {
  const reversed = [...items].reverse()
  const front = reversed.filter((_, index) => index % 2 === 0)
  const back = reversed.filter((_, index) => index % 2 === 1)
  return [...back, ...front]
}
