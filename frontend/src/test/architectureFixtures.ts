import type {
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
 * It is test data only and never reaches application code.
 */

export const NESTED_COMPONENTS: Component[] = [
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

export const NESTED_RELATIONSHIPS: Relationship[] = [
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
    {
      componentId: 'platform.core.shipping',
      name: 'Shipping',
      kind: 'module',
      parentComponentId: 'platform.core',
      technology: { language: 'Go' },
      tags: ['domain'],
    },
  ],
  relationships: [
    ...NESTED_RELATIONSHIPS,
    {
      relationshipId: 'r-09',
      sourceComponentId: 'platform.core.shipping',
      targetComponentId: 'platform.bus',
      kind: 'nats_topic',
      protocol: 'NATS',
      channel: 'shipping.dispatched',
    },
  ],
  activeChanges: [],
}

/** Shuffles deterministically, so a re-ordered input list is reproducible. */
export function reorder<T>(items: readonly T[]): T[] {
  const reversed = [...items].reverse()
  const front = reversed.filter((_, index) => index % 2 === 0)
  const back = reversed.filter((_, index) => index % 2 === 1)
  return [...back, ...front]
}
