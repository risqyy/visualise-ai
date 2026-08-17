import { expect, test, type Page } from '@playwright/test'

import { asAccepted, bootstrapEvent, getJson, postEvent } from '../src/api.js'
import { showWholeModel } from '../src/canvas.js'
import {
  MAIN_PROJECT,
  MAIN_RUN,
  SELF_BOOTSTRAP_AGENT,
  SELF_BOOTSTRAP_RUN,
  SELF_PROJECT,
  SELF_RUN,
} from '../src/config.js'
import { startSimulator } from '../src/simulator.js'

/**
 * Mandatory check 2 — the full architecture canvas: hierarchy and typed
 * relationships, with every reported NATS topic individually identifiable.
 *
 * The bundling rule of ADR 0008 is *bundling by ordered node pair*: several
 * relationships between the **same** two components share one rendered line and
 * the line keeps the complete, addressable list. The acceptance property behind
 * it is the one asserted here — **no reported relationship may become
 * unreachable**. It is checked from both ends: the read API must return every
 * topic relationship separately (the server never aggregates, ADR 0005), and the
 * canvas must expose each of them with its own label and its own `channel`.
 */

interface ArchitectureResponse {
  components: { componentId: string; parentComponentId: string | null; kind: string }[]
  relationships: {
    relationshipId: string
    sourceComponentId: string
    targetComponentId: string
    kind: string
    channel?: string
    operation?: string
  }[]
}

const TOPIC_ORDER_CREATED = 'orders.order.created'
const TOPIC_INVENTORY_RESERVED = 'inventory.item.reserved'

/** The four-level chain the snapshot is built around. */
const HIERARCHY_CHAIN = [
  'shop-platform',
  'shop-platform.orders',
  'shop-platform.orders.domain',
  'shop-platform.orders.domain.pricing',
] as const

const RELATIONSHIP_KINDS = [
  'http',
  'grpc',
  'data',
  'async',
  'nats_topic',
  'dependency',
] as const

const SELF_BOOTSTRAP_EVENT_ID = '22222222-0000-4000-8000-000000000002'

async function openWorkspace(page: Page): Promise<void> {
  await page.goto(`/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}`)
  await expect(page.getByTestId('architecture-canvas')).toBeVisible()
  await expect(page.getByTestId('canvas-node-shop-platform')).toBeVisible()
  await expect(page.getByTestId('architecture-canvas')).toHaveAttribute(
    'data-layouting',
    'false',
  )
}

/** Zooms in until the canvas reports the `full` detail level. */
async function zoomToFullDetail(page: Page): Promise<void> {
  const canvas = page.getByTestId('architecture-canvas')
  const zoomIn = page.locator('.react-flow__controls-zoomin')
  await expect(zoomIn).toBeVisible()

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const level = await canvas.getAttribute('data-detail-level')
    if (level === 'full') return
    await zoomIn.click()
  }
  await expect(canvas).toHaveAttribute('data-detail-level', 'full')
}

test.describe.configure({ mode: 'serial' })

test('2 · the canvas draws the reported hierarchy across four nesting levels', async ({
  page,
}) => {
  await openWorkspace(page)
  // The canvas opens on its top levels (#34); the hierarchy and the individual
  // topic edges below them are what this check is about, so it opens the whole
  // model first — through the button a user would press.
  await showWholeModel(page)

  const canvas = page.getByTestId('architecture-canvas')
  await expect(canvas).toHaveAttribute('data-node-count', '17')
  await expect(canvas).toHaveAttribute('data-edge-count', '11')

  // Compound containers really contain their children: the box of each level of
  // the chain lies inside the box of the level above it. That is the rendered
  // hierarchy, not a claim about an attribute.
  const boxes = []
  for (const componentId of HIERARCHY_CHAIN) {
    const node = page.getByTestId(`canvas-node-${componentId}`)
    await expect(node).toBeVisible()
    const box = await node.boundingBox()
    expect(box, `no bounding box for ${componentId}`).not.toBeNull()
    boxes.push({ componentId, box: box as NonNullable<typeof box> })
  }

  for (let level = 1; level < boxes.length; level += 1) {
    const parent = boxes[level - 1]
    const child = boxes[level]
    if (!parent || !child) throw new Error('unreachable')
    expect(
      child.box.x >= parent.box.x &&
        child.box.y >= parent.box.y &&
        child.box.x + child.box.width <= parent.box.x + parent.box.width &&
        child.box.y + child.box.height <= parent.box.y + parent.box.height,
      `${child.componentId} is not drawn inside ${parent.componentId}: ` +
        `${JSON.stringify(child.box)} vs ${JSON.stringify(parent.box)}`,
    ).toBe(true)
  }

  // The three ancestors are compound containers, the leaf is not.
  for (const componentId of HIERARCHY_CHAIN.slice(0, 3)) {
    await expect(page.getByTestId(`canvas-node-${componentId}`)).toHaveAttribute(
      'data-compound',
      'true',
    )
  }
  await expect(
    page.getByTestId('canvas-node-shop-platform.orders.domain.pricing'),
  ).not.toHaveAttribute('data-compound', 'true')

  // The applied model is exactly what the run left behind: the extracted tax
  // module is in it, the legacy module is not.
  await expect(page.getByTestId('canvas-node-shop-platform.orders.domain.tax')).toBeVisible()
  await expect(
    page.getByTestId('canvas-node-shop-platform.orders.domain.legacy-tax-rates'),
  ).toHaveCount(0)
})

test('2 · every relationship kind is drawn, and every reported NATS topic stays individually identifiable', async ({
  page,
}) => {
  // ---- what the server reports --------------------------------------------
  const response = await getJson(`/api/v1/projects/${MAIN_PROJECT}/architecture`)
  expect(response.status).toBe(200)
  const architecture = response.body as ArchitectureResponse
  expect(architecture.components).toHaveLength(17)
  expect(architecture.relationships).toHaveLength(11)

  const orderCreated = architecture.relationships.filter(
    (relationship) => relationship.channel === TOPIC_ORDER_CREATED,
  )
  const inventoryReserved = architecture.relationships.filter(
    (relationship) => relationship.channel === TOPIC_INVENTORY_RESERVED,
  )
  expect(
    orderCreated.map((relationship) => relationship.relationshipId).sort(),
    'the server must never aggregate the topic into one edge',
  ).toEqual([
    'rel-inventory-consumes-order-created',
    'rel-notifications-consumes-order-created',
    'rel-orders-publishes-order-created',
  ])
  expect(inventoryReserved.map((relationship) => relationship.relationshipId).sort()).toEqual([
    'rel-inventory-publishes-inventory-reserved',
    'rel-notifications-consumes-inventory-reserved',
  ])

  // ---- what the canvas draws ----------------------------------------------
  await openWorkspace(page)
  // The canvas opens on its top levels (#34); the hierarchy and the individual
  // topic edges below them are what this check is about, so it opens the whole
  // model first — through the button a user would press.
  await showWholeModel(page)

  // All six typed kinds are on screen, each with its own stroke pattern.
  for (const kind of RELATIONSHIP_KINDS) {
    await expect(
      page.locator(`[data-relationship-kind="${kind}"]`).first(),
      `no edge of kind ${kind} was drawn`,
    ).toBeAttached()
  }

  // Distinct dash patterns: the kind survives greyscale (ADR 0008).
  const dashPatterns = await page.evaluate(() => {
    const seen: Record<string, string> = {}
    for (const path of Array.from(document.querySelectorAll('[data-relationship-kind]'))) {
      const kind = path.getAttribute('data-relationship-kind') ?? ''
      seen[kind] = path.getAttribute('data-dasharray') ?? ''
    }
    return seen
  })
  expect(new Set(Object.values(dashPatterns)).size).toBe(RELATIONSHIP_KINDS.length)

  // ---- the bundle is a rendering, never a merge ---------------------------
  await zoomToFullDetail(page)

  // One label per reported relationship. If the canvas had merged the parallel
  // topic edges into one "messaging" line there would be fewer than eleven.
  const appliedIds = architecture.relationships.map((relationship) => relationship.relationshipId)
  const labelledApplied = await page.evaluate(
    (ids) =>
      ids.filter(
        (id) => document.querySelector(`[data-testid="edge-label-${id}"]`) !== null,
      ),
    appliedIds,
  )
  expect(labelledApplied.sort()).toEqual([...appliedIds].sort())

  // Every single topic is addressable by its own relationship id, and its label
  // carries the `channel` that identifies it among its siblings.
  for (const relationship of [...orderCreated, ...inventoryReserved]) {
    const label = page.getByTestId(`edge-label-${relationship.relationshipId}`)
    await expect(label, `no individual label for ${relationship.relationshipId}`).toBeAttached()
    await expect(label).toContainText(relationship.channel ?? '<no channel>')
    await expect(label).toHaveAttribute(
      'title',
      new RegExp(`Kanal: ${escapeRegExp(relationship.channel ?? '')}`),
    )
  }

  // The three `orders.order.created` relationships stay three, and the two
  // `inventory.item.reserved` ones stay two.
  const channelsInDom = await page.evaluate(() => {
    const channels: string[] = []
    for (const badge of Array.from(document.querySelectorAll('[data-testid^="edge-label-"]'))) {
      const match = /Kanal: (.+)$/m.exec(badge.getAttribute('title') ?? '')
      if (match?.[1]) channels.push(match[1].trim())
    }
    return channels
  })
  expect(channelsInDom.filter((channel) => channel === TOPIC_ORDER_CREATED)).toHaveLength(3)
  expect(channelsInDom.filter((channel) => channel === TOPIC_INVENTORY_RESERVED)).toHaveLength(2)

  // The reversibility guarantee stated as an invariant: the number of drawn
  // edges plus the number of relationships they carry must agree, so a folded
  // bundle — if the reported model ever contains one — can only ever be a
  // rendering of relationships that are all still individually labelled.
  const edgeInventory = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="architecture-canvas"]')
    return {
      folded: document.querySelectorAll('[data-testid^="edge-bundle-"]').length,
      labels: document.querySelectorAll('[data-testid^="edge-label-"]').length,
      appliedEdges: Number(canvas?.getAttribute('data-edge-count') ?? '-1'),
      overlayEdges: Number(canvas?.getAttribute('data-overlay-edge-count') ?? '-1'),
    }
  })
  expect(
    edgeInventory.folded,
    'a folded bundle at the full detail level would hide individual relationships',
  ).toBe(0)
  // Applied and proposed edges each carry exactly one labelled relationship, so
  // no reported relationship can have been folded away.
  expect(edgeInventory.appliedEdges).toBe(architecture.relationships.length)
  expect(edgeInventory.labels).toBe(
    edgeInventory.appliedEdges + edgeInventory.overlayEdges,
  )
})

test('2 · the self run keeps 28 model components apart from its open proposal at initial depth', async ({
  page,
}) => {
  const opened = await postEvent(
    bootstrapEvent({
      clientEventId: SELF_BOOTSTRAP_EVENT_ID,
      projectId: SELF_PROJECT,
      runId: SELF_BOOTSTRAP_RUN,
      agentId: SELF_BOOTSTRAP_AGENT,
      displayName: 'Self-run acceptance bootstrap',
    }),
  )
  expect(opened.status, JSON.stringify(opened.body)).toBe(201)
  expect(asAccepted(opened).position).toBe(1)

  await page.goto(`/projects/${SELF_PROJECT}/runs/${SELF_RUN}`)
  await expect(page.getByTestId('live-connection-state')).toHaveAttribute(
    'data-state',
    'live',
  )

  // The browser is subscribed before the self scenario publishes its snapshot;
  // speed 0 keeps this structural check short without sampling transient work states.
  const simulator = startSimulator({ scenario: 'self', speed: 0 })
  await expect(page.getByTestId('architecture-canvas')).toBeVisible({ timeout: 120_000 })

  const summary = await simulator.done
  expect(summary.scenario).toBe('self')
  expect(summary.projectId).toBe(SELF_PROJECT)
  expect(summary.runId).toBe(SELF_RUN)
  expect(summary.conflicts).toBe(0)
  expect(summary.duplicates).toBe(0)
  expect(summary.created).toBe(summary.eventsSent)
  expect(summary.endPosition).toBe(summary.eventsSent + 1)

  const canvas = page.getByTestId('architecture-canvas')
  await expect(canvas).toHaveAttribute('data-node-count', '28')
  await expect(canvas).toHaveAttribute('data-overlay-node-count', '1')
  await expect(canvas).toHaveAttribute('data-total-element-count', '29')
  await expect(canvas).toHaveAttribute('data-reported-relationship-count', '35')
  await expect(page.getByTestId('architecture-model-count')).toContainText(
    '28 Modellkomponenten',
  )
  await expect(page.getByTestId('architecture-proposal-count')).toContainText(
    '+ 1 Vorschlag',
  )
  await expect(page.getByTestId('canvas-node-visualise-ai.repository-provider')).toHaveAttribute(
    'data-presence',
    'proposal',
  )

  // The initial depth shows ten of the 29 total elements. The open proposal is
  // included in that visible-element count but remains outside the 28-model
  // component count above; nine connections are visible at this depth.
  await expect(canvas).toHaveAttribute('data-visible-node-count', '10')
  await expect(canvas).toHaveAttribute('data-visible-connection-count', '9')
  await expect(page.getByTestId('architecture-relationship-count')).toContainText(
    '35 gemeldete Beziehungen · 9 Verbindungen dargestellt',
  )
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
