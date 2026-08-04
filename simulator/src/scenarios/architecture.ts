/**
 * The architecture model the `full` scenario publishes.
 *
 * It is written to exercise every structural feature the cockpit has to render:
 *
 * * four hierarchy levels — `shop-platform` -> `orders` -> `domain` -> `pricing`
 *   — so nesting is more than a single fold,
 * * all six relationship kinds,
 * * two separate NATS topics, each with its own relationship per participant,
 *   and one of them (`orders.order.created`) fanned out to **two** consumers as
 *   two distinct relationships sharing a `channel`, which is what proves the
 *   backend never aggregates topic edges,
 * * one component and one relationship that exist only so a later `remove` has
 *   something real to take away.
 */

export interface Technology {
  language?: string
  framework?: string
  runtime?: string
  version?: string
}

export interface Component {
  componentId: string
  name: string
  kind:
    | 'system'
    | 'service'
    | 'module'
    | 'datastore'
    | 'queue'
    | 'topic'
    | 'ui'
    | 'external'
    | 'library'
  parentComponentId: string | null
  description?: string
  technology?: Technology
  tags?: string[]
}

export interface Relationship {
  relationshipId: string
  sourceComponentId: string
  targetComponentId: string
  kind: 'http' | 'grpc' | 'data' | 'async' | 'nats_topic' | 'dependency'
  label?: string
  protocol?: string
  operation?: string
  channel?: string
}

export const TOPIC_ORDER_CREATED = 'orders.order.created'
export const TOPIC_INVENTORY_RESERVED = 'inventory.item.reserved'

export const COMPONENT_IDS = {
  system: 'shop-platform',
  storefront: 'shop-platform.storefront',
  gateway: 'shop-platform.api-gateway',
  orders: 'shop-platform.orders',
  ordersApi: 'shop-platform.orders.api',
  ordersDomain: 'shop-platform.orders.domain',
  pricing: 'shop-platform.orders.domain.pricing',
  legacyTaxRates: 'shop-platform.orders.domain.legacy-tax-rates',
  tax: 'shop-platform.orders.domain.tax',
  rounding: 'shop-platform.orders.domain.rounding',
  ordersPersistence: 'shop-platform.orders.persistence',
  inventory: 'shop-platform.inventory',
  notifications: 'shop-platform.notifications',
  ordersDb: 'shop-platform.orders-db',
  events: 'shop-platform.events',
  topicOrderCreated: 'shop-platform.events.order-created',
  topicInventoryReserved: 'shop-platform.events.inventory-reserved',
  sharedMoney: 'shop-platform.shared-money',
  paymentProvider: 'payment-provider',
} as const

const C = COMPONENT_IDS

/** The components of the initial snapshot, ordered parent before child. */
export const SNAPSHOT_COMPONENTS: Component[] = [
  {
    componentId: C.system,
    name: 'Shop Platform',
    kind: 'system',
    parentComponentId: null,
    description: 'The observed application. Root of the component hierarchy.',
  },
  {
    componentId: C.storefront,
    name: 'Storefront',
    kind: 'ui',
    parentComponentId: C.system,
    description: 'Customer-facing single page application.',
    technology: { language: 'TypeScript', framework: 'React', runtime: 'Browser', version: '19' },
    tags: ['frontend', 'public'],
  },
  {
    componentId: C.gateway,
    name: 'API Gateway',
    kind: 'service',
    parentComponentId: C.system,
    description: 'Single external entry point, terminates TLS and fans out to the services.',
    technology: { language: 'Go', framework: 'chi', runtime: 'Go', version: '1.24' },
  },
  {
    componentId: C.orders,
    name: 'Orders Service',
    kind: 'service',
    parentComponentId: C.system,
    description: 'Owns the order lifecycle.',
    technology: { language: 'Go', runtime: 'Go', version: '1.24' },
    tags: ['core-domain'],
  },
  {
    componentId: C.ordersApi,
    name: 'Orders API Layer',
    kind: 'module',
    parentComponentId: C.orders,
    description: 'gRPC handlers and request mapping.',
  },
  {
    componentId: C.ordersDomain,
    name: 'Orders Domain Layer',
    kind: 'module',
    parentComponentId: C.orders,
    description: 'Order aggregate, invariants and state machine.',
  },
  {
    componentId: C.pricing,
    name: 'Pricing',
    kind: 'module',
    parentComponentId: C.ordersDomain,
    description: 'Fourth hierarchy level: discount and tax calculation inside the domain layer.',
    tags: ['pricing'],
  },
  {
    componentId: C.legacyTaxRates,
    name: 'Legacy Tax Rates',
    kind: 'module',
    parentComponentId: C.ordersDomain,
    description: 'Hard-coded VAT table kept alive for the German rate only.',
    tags: ['pricing', 'legacy'],
  },
  {
    componentId: C.ordersPersistence,
    name: 'Orders Persistence Layer',
    kind: 'module',
    parentComponentId: C.orders,
    description: 'Repository implementations and SQL migrations.',
  },
  {
    componentId: C.inventory,
    name: 'Inventory Service',
    kind: 'service',
    parentComponentId: C.system,
    description: 'Reserves and releases stock.',
    technology: { language: 'Go', runtime: 'Go', version: '1.24' },
  },
  {
    componentId: C.notifications,
    name: 'Notification Service',
    kind: 'service',
    parentComponentId: C.system,
    description: 'Sends order and shipment mails. Second consumer of the order topic.',
    technology: { language: 'Go', runtime: 'Go', version: '1.24' },
  },
  {
    componentId: C.ordersDb,
    name: 'Orders Database',
    kind: 'datastore',
    parentComponentId: C.system,
    description: 'Relational store owned exclusively by the orders service.',
    technology: { runtime: 'PostgreSQL', version: '17' },
  },
  {
    componentId: C.events,
    name: 'Event Bus',
    kind: 'queue',
    parentComponentId: C.system,
    description: 'NATS cluster. Each topic below is modelled as its own component.',
    technology: { runtime: 'NATS', version: '2.10' },
  },
  {
    componentId: C.topicOrderCreated,
    name: TOPIC_ORDER_CREATED,
    kind: 'topic',
    parentComponentId: C.events,
    description: 'Published once per accepted order, consumed by inventory and notifications.',
  },
  {
    componentId: C.topicInventoryReserved,
    name: TOPIC_INVENTORY_RESERVED,
    kind: 'topic',
    parentComponentId: C.events,
    description: 'Published once per successful stock reservation.',
  },
  {
    componentId: C.sharedMoney,
    name: 'Shared Money Library',
    kind: 'library',
    parentComponentId: C.system,
    description: 'Currency and amount value objects shared across services.',
    technology: { language: 'Go' },
  },
  {
    componentId: C.paymentProvider,
    name: 'Payment Provider',
    kind: 'external',
    parentComponentId: null,
    description: 'Third-party payment system outside the system boundary.',
  },
]

export const RELATIONSHIP_IDS = {
  storefrontGateway: 'rel-storefront-gateway-http',
  gatewayOrders: 'rel-gateway-orders-grpc',
  ordersDb: 'rel-orders-persistence-data',
  ordersPayment: 'rel-orders-payment-async',
  ordersPublishesOrderCreated: 'rel-orders-publishes-order-created',
  inventoryConsumesOrderCreated: 'rel-inventory-consumes-order-created',
  notificationsConsumesOrderCreated: 'rel-notifications-consumes-order-created',
  inventoryPublishesReserved: 'rel-inventory-publishes-inventory-reserved',
  notificationsConsumesReserved: 'rel-notifications-consumes-inventory-reserved',
  pricingSharedMoney: 'rel-pricing-shared-money-dependency',
  pricingLegacyTaxRates: 'rel-pricing-legacy-tax-rates-dependency',
  pricingTax: 'rel-pricing-tax-dependency',
  notificationsOrdersHttp: 'rel-notifications-orders-http',
  taxRounding: 'rel-tax-rounding-dependency',
} as const

const R = RELATIONSHIP_IDS

/** The relationships of the initial snapshot. */
export const SNAPSHOT_RELATIONSHIPS: Relationship[] = [
  {
    relationshipId: R.storefrontGateway,
    sourceComponentId: C.storefront,
    targetComponentId: C.gateway,
    kind: 'http',
    label: 'Browse and place orders',
    protocol: 'HTTPS',
    operation: 'GET /orders',
  },
  {
    relationshipId: R.gatewayOrders,
    sourceComponentId: C.gateway,
    targetComponentId: C.ordersApi,
    kind: 'grpc',
    label: 'Place order',
    protocol: 'gRPC/HTTP2',
    operation: 'orders.v1.OrderService/PlaceOrder',
  },
  {
    relationshipId: R.ordersDb,
    sourceComponentId: C.ordersPersistence,
    targetComponentId: C.ordersDb,
    kind: 'data',
    label: 'Order aggregate storage',
    protocol: 'postgresql',
    operation: 'SELECT/INSERT/UPDATE orders',
  },
  {
    relationshipId: R.ordersPayment,
    sourceComponentId: C.orders,
    targetComponentId: C.paymentProvider,
    kind: 'async',
    label: 'Payment settlement callbacks',
    protocol: 'webhook',
    operation: 'POST /callbacks/payment',
  },
  {
    relationshipId: R.ordersPublishesOrderCreated,
    sourceComponentId: C.orders,
    targetComponentId: C.topicOrderCreated,
    kind: 'nats_topic',
    label: 'publishes',
    protocol: 'NATS',
    channel: TOPIC_ORDER_CREATED,
  },
  {
    relationshipId: R.inventoryConsumesOrderCreated,
    sourceComponentId: C.topicOrderCreated,
    targetComponentId: C.inventory,
    kind: 'nats_topic',
    label: 'consumes',
    protocol: 'NATS',
    channel: TOPIC_ORDER_CREATED,
  },
  {
    // Second consumer of the same topic. Two relationships, one channel — the
    // cockpit must show both edges rather than one merged "messaging" edge.
    relationshipId: R.notificationsConsumesOrderCreated,
    sourceComponentId: C.topicOrderCreated,
    targetComponentId: C.notifications,
    kind: 'nats_topic',
    label: 'consumes',
    protocol: 'NATS',
    channel: TOPIC_ORDER_CREATED,
  },
  {
    relationshipId: R.inventoryPublishesReserved,
    sourceComponentId: C.inventory,
    targetComponentId: C.topicInventoryReserved,
    kind: 'nats_topic',
    label: 'publishes',
    protocol: 'NATS',
    channel: TOPIC_INVENTORY_RESERVED,
  },
  {
    relationshipId: R.notificationsConsumesReserved,
    sourceComponentId: C.topicInventoryReserved,
    targetComponentId: C.notifications,
    kind: 'nats_topic',
    label: 'consumes',
    protocol: 'NATS',
    channel: TOPIC_INVENTORY_RESERVED,
  },
  {
    relationshipId: R.pricingSharedMoney,
    sourceComponentId: C.pricing,
    targetComponentId: C.sharedMoney,
    kind: 'dependency',
    label: 'Money value objects',
  },
  {
    relationshipId: R.pricingLegacyTaxRates,
    sourceComponentId: C.pricing,
    targetComponentId: C.legacyTaxRates,
    kind: 'dependency',
    label: 'Hard-coded VAT table',
  },
]

/** The component the scenario adds through a planned and then applied change. */
export const TAX_COMPONENT: Component = {
  componentId: C.tax,
  name: 'Tax Calculation',
  kind: 'module',
  parentComponentId: C.ordersDomain,
  description: 'VAT rules per delivery country, extracted from the pricing module.',
  technology: { language: 'Go', runtime: 'Go', version: '1.24' },
  tags: ['pricing', 'tax'],
}

/** The relationship the scenario adds alongside {@link TAX_COMPONENT}. */
export const PRICING_TAX_RELATIONSHIP: Relationship = {
  relationshipId: R.pricingTax,
  sourceComponentId: C.pricing,
  targetComponentId: C.tax,
  kind: 'dependency',
  label: 'Delegates VAT calculation',
}

/**
 * The component the scenario proposes and deliberately leaves pending, so the
 * run ends with a change in state `planned` for the cockpit to render.
 */
export const ROUNDING_COMPONENT: Component = {
  componentId: C.rounding,
  name: 'Rounding',
  kind: 'module',
  parentComponentId: C.ordersDomain,
  description: 'Proposed: one place for the half-up rounding rule the tax module applies today.',
  technology: { language: 'Go' },
  tags: ['pricing', 'proposed'],
}

/** The relationship that would accompany {@link ROUNDING_COMPONENT}. Also pending. */
export const TAX_ROUNDING_RELATIONSHIP: Relationship = {
  relationshipId: R.taxRounding,
  sourceComponentId: C.tax,
  targetComponentId: C.rounding,
  kind: 'dependency',
  label: 'Delegates the rounding rule',
}

/**
 * The relationship the scenario plans and then withdraws again, so the cockpit
 * has a retracted proposal to render.
 */
export const NOTIFICATIONS_ORDERS_RELATIONSHIP: Relationship = {
  relationshipId: R.notificationsOrdersHttp,
  sourceComponentId: C.notifications,
  targetComponentId: C.ordersApi,
  kind: 'http',
  label: 'Read order details for the mail body',
  protocol: 'HTTPS',
  operation: 'GET /orders/{id}',
}
