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

test('2 · top-down is the default and both orientations are shareable at accepted widths', async ({
  page,
}) => {
  const selectedComponent = 'shop-platform.orders'
  const viewports = [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ] as const

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await openWorkspace(page)

    const canvas = page.getByTestId('architecture-canvas')
    const node = page.locator(`.react-flow__node[data-id="shop-platform"]`)
    await expect(canvas).toHaveAttribute('data-layout-orientation', 'top-down')
    await expect(node.locator('.react-flow__handle-top')).toHaveCount(1)
    await expect(node.locator('.react-flow__handle-bottom')).toHaveCount(1)

    // A selected, collapsed component is deliberately kept in place while the
    // user changes orientation. Check the URL, canvas and inspector together.
    if (viewport.width === 1920) {
      await page.getByTestId(`canvas-node-${selectedComponent}`).click()
      await expect(page).toHaveURL(
        new RegExp(`component=${encodeURIComponent(selectedComponent)}`),
      )
      await expect(page.getByTestId('inspector-context')).toHaveAttribute(
        'data-component-id',
        selectedComponent,
      )

      const disclosure = page.getByTestId(`node-disclosure-${selectedComponent}`)
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
      await disclosure.click()
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    }

    await page.getByTestId('canvas-layout-left-right').click()
    await expect(canvas).toHaveAttribute('data-layout-orientation', 'left-right')
    await expect(canvas).toHaveAttribute('data-layouting', 'false')
    await expect(page).toHaveURL(/layout=left-right/)
    await expect(node.locator('.react-flow__handle-left')).toHaveCount(1)
    await expect(node.locator('.react-flow__handle-right')).toHaveCount(1)

    if (viewport.width === 1920) {
      await expect(page).toHaveURL(
        new RegExp(`component=${encodeURIComponent(selectedComponent)}`),
      )
      await expect(page.getByTestId(`canvas-node-${selectedComponent}`)).toHaveAttribute(
        'data-selected',
        'true',
      )
      await expect(page.getByTestId(`node-disclosure-${selectedComponent}`)).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      await expect(page.getByTestId('inspector-context')).toHaveAttribute(
        'data-component-id',
        selectedComponent,
      )
    }

    await page.getByTestId('canvas-layout-top-down').click()
    await expect(canvas).toHaveAttribute('data-layout-orientation', 'top-down')
    await expect(canvas).toHaveAttribute('data-layouting', 'false')
    await expect(page).toHaveURL(/layout=top-down/)
    await expect(node.locator('.react-flow__handle-top')).toHaveCount(1)
    await expect(node.locator('.react-flow__handle-bottom')).toHaveCount(1)

    if (viewport.width === 1920) {
      await expect(page.getByTestId(`canvas-node-${selectedComponent}`)).toHaveAttribute(
        'data-selected',
        'true',
      )
      await expect(page.getByTestId(`node-disclosure-${selectedComponent}`)).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      await expect(page.getByTestId('inspector-context')).toHaveAttribute(
        'data-component-id',
        selectedComponent,
      )
    }
  }
})

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

test('2 · selecting one relationship is a reproducible URL and inspector context', async ({
  page,
}) => {
  await openWorkspace(page)
  await showWholeModel(page)
  await zoomToFullDetail(page)

  const label = page.getByTestId('edge-label-rel-orders-publishes-order-created')
  await expect(label).toBeVisible()
  await label.click()

  await expect(page).toHaveURL(/relationship=rel-orders-publishes-order-created/)
  const inspector = page.getByTestId('inspector-relationship-context')
  await expect(inspector).toBeVisible()
  await expect(inspector).toContainText('rel-orders-publishes-order-created')
  // This is the single publisher -> topic relationship. The other two
  // `orders.order.created` relationships terminate at different consumers, so
  // the ordered-endpoint bundling rule does not make them inspector siblings.
  await expect(inspector).toContainText('NATS · orders.order.created')
  await expect(inspector).toContainText('Orders Service')
  await expect(inspector).toContainText('publishes')
  await expect(inspector).toContainText('NATS')
  await expect(page.getByTestId('inspector-relationship-bundle')).not.toBeAttached()

  // Escape clears the typed selection while the canvas remains the focused
  // interaction surface, so the next keyboard action has a stable target.
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/relationship=/)
})

test('2 · component search exposes an accessible result, opens its ancestors and syncs selection', async ({
  page,
}) => {
  await openWorkspace(page)

  await page.getByTestId('canvas-component-search').click()
  const input = page.getByTestId('canvas-component-search-input')
  await input.fill('pricing')

  const result = page.getByTestId('canvas-component-search-result').first()
  const resultId = await result.getAttribute('id')
  expect(resultId).not.toBeNull()
  await expect(result).toContainText('Pricing')
  await expect(result).toContainText('Modul')
  await expect(result).toContainText('Shop Platform / Orders Service / Orders Domain Layer')
  await expect(input).toHaveAttribute('role', 'combobox')
  await expect(input).toHaveAttribute('aria-expanded', 'true')
  await expect(input).toHaveAttribute('aria-activedescendant', resultId!)

  await result.click()
  await expect(page).toHaveURL(/component=shop-platform.orders.domain.pricing/)
  await expect(page.getByTestId('inspector-context')).toHaveAttribute(
    'data-component-id',
    'shop-platform.orders.domain.pricing',
  )
  await expect(page.getByTestId('canvas-node-shop-platform.orders.domain.pricing')).toBeVisible()
  await expect(page.getByTestId('node-disclosure-shop-platform.orders.domain')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  // Opening a search path is a disclosure change plus an explicit pan, never a
  // second automatic fit.
  await expect(page.getByTestId('architecture-canvas')).toHaveAttribute(
    'data-fit-view-count',
    '1',
  )
})

test('2 · arrow navigation exposes the active result and deep links keep jump explicit', async ({
  page,
}) => {
  await openWorkspace(page)

  await page.getByTestId('canvas-component-search').click()
  const input = page.getByTestId('canvas-component-search-input')
  await input.fill('service')
  const results = page.getByTestId('canvas-component-search-result')
  await expect.poll(() => results.count()).toBeGreaterThanOrEqual(2)
  const firstResultId = await results.nth(0).getAttribute('id')
  const secondResultId = await results.nth(1).getAttribute('id')
  expect(firstResultId).not.toBeNull()
  expect(secondResultId).not.toBeNull()
  await expect(input).toHaveAttribute('aria-activedescendant', firstResultId!)

  await input.press('ArrowDown')
  await expect(input).toHaveAttribute('aria-activedescendant', secondResultId!)
  await expect(results.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(results.nth(0)).toHaveAttribute('aria-selected', 'false')

  // A deep link restores selection and disclosure but leaves camera movement to
  // the explicit jump control when the selected node is offscreen.
  await page.goto(
    `/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}?component=${encodeURIComponent(
      'shop-platform.orders.domain.pricing',
    )}`,
  )
  const canvas = page.getByTestId('architecture-canvas')
  await expect(canvas).toHaveAttribute('data-layouting', 'false')
  await expect(page.getByTestId('inspector-context')).toHaveAttribute(
    'data-component-id',
    'shop-platform.orders.domain.pricing',
  )
  const fitCount = await canvas.getAttribute('data-fit-view-count')
  const pane = page.locator('.react-flow__pane')
  const paneBox = await pane.boundingBox()
  expect(paneBox).not.toBeNull()

  // The deep link may already be visible in the initial camera. Start on an
  // actually empty part of the React Flow pane so this is a canvas pan, not a
  // drag of whichever node happens to be under its centre at this layout.
  const pan = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.react-flow__pane')
    const selected = document.querySelector<HTMLElement>(
      '[data-testid="canvas-node-shop-platform.orders.domain.pricing"]',
    )
    if (pane === null || selected === null) return null

    const paneRect = pane.getBoundingClientRect()
    const selectedRect = selected.getBoundingClientRect()
    const moveRight =
      selectedRect.left + selectedRect.width / 2 >= paneRect.left + paneRect.width / 2
    const startColumns = moveRight
      ? [paneRect.left + 32, paneRect.left + 64, paneRect.left + paneRect.width * 0.25]
      : [paneRect.right - 32, paneRect.right - 64, paneRect.left + paneRect.width * 0.75]
    const rows = [
      paneRect.top + 32,
      paneRect.top + paneRect.height * 0.25,
      paneRect.top + paneRect.height * 0.5,
      paneRect.top + paneRect.height * 0.75,
      paneRect.bottom - 32,
    ]
    const start = startColumns
      .flatMap((x) => rows.map((y) => ({ x, y })))
      .find(({ x, y }) => {
        const target = document.elementFromPoint(x, y)
        return (
          target?.closest('.react-flow__pane') === pane &&
          target.closest(
            '.react-flow__node, .react-flow__panel, .react-flow__controls, .react-flow__minimap, .react-flow__attribution',
          ) === null
        )
      })
    if (start === undefined) return null

    return {
      start,
      end: {
        x: moveRight ? paneRect.right - 16 : paneRect.left + 16,
        y: start.y,
      },
    }
  })
  expect(pan).not.toBeNull()
  const viewportBeforePan = await page.locator('.react-flow__viewport').getAttribute('style')
  await page.mouse.move(pan!.start.x, pan!.start.y)
  await page.mouse.down()
  await page.mouse.move(pan!.end.x, pan!.end.y, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(() => page.locator('.react-flow__viewport').getAttribute('style'))
    .not.toBe(viewportBeforePan)

  const jump = page.getByTestId('canvas-jump-to-selection')
  await expect(jump).toBeVisible()
  const before = await page.locator('.react-flow__viewport').getAttribute('style')
  await jump.click()
  await expect(canvas).toHaveAttribute('data-fit-view-count', fitCount ?? '1')
  await expect
    .poll(() => page.locator('.react-flow__viewport').getAttribute('style'))
    .not.toBe(before)
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
  // The overlay count is deliberately not used as the proposal count: the
  // self run also keeps one removed component as evidence (a ghost).
  await expect(canvas).toHaveAttribute('data-overlay-node-count', '2')
  await expect(canvas).toHaveAttribute('data-total-element-count', '30')
  await expect(canvas).toHaveAttribute('data-reported-relationship-count', '37')
  await expect(page.getByTestId('architecture-model-count')).toContainText(
    '28 Modellkomponenten',
  )
  await expect(page.getByTestId('architecture-proposal-count')).toContainText(
    '+ 1 Vorschlag',
  )
  await expect(page.getByTestId('architecture-evidence-count')).toContainText(
    '+ 1 Komponente nur als Beleg',
  )
  await expect(
    page.locator('[data-testid^="canvas-node-"][data-presence="proposal"]'),
  ).toHaveCount(1)
  await expect(page.getByTestId('canvas-node-visualise-ai.repository-provider')).toHaveAttribute(
    'data-presence',
    'proposal',
  )

  // The initial depth shows ten of the 30 total elements. The proposal and the
  // evidence ghost remain outside the 28-model component count above; ten
  // connections are visible at this depth.
  await expect(canvas).toHaveAttribute('data-collapsed-count', '2')
  await expect(canvas).toHaveAttribute('data-visible-node-count', '10')
  await expect(canvas).toHaveAttribute('data-visible-connection-count', '10')
  await expect(page.getByTestId('architecture-relationship-count')).toContainText(
    '37 gemeldete Beziehungen · 10 Verbindungen dargestellt',
  )
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
