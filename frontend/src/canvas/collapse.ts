import type { ComponentId, Identifier } from '@/api/types'

import { dominantOverlay, type ChangeOverlay } from './changeOverlays'
import { INITIAL_EXPANDED_DEPTH } from './detailLevel'
import {
  DEFAULT_GRAPH_ORIENTATION,
  type GraphOrientation,
} from './graphOrientation'
import {
  HANDLE_IDS,
  LEAF_NODE_SIZE,
  RELATIONSHIP_EDGE_TYPE,
  bundleEdgeId,
  nodeHandles,
  overlayEdgeId,
  type ArchitectureEdge,
  type ArchitectureNode,
} from './graphProjection'

/**
 * Expand and collapse: which part of the reported hierarchy is drawn.
 *
 * The architecture canvas fits its model into the viewport once, when a project
 * is opened. With a flat picture of every component that fit is the whole
 * problem this module exists for: 28 components over four levels lay out to
 * ~4700 × 1260, which fits a 1036 px wide surface at zoom 0.20 — a node is then
 * 46 × 20 px and its name renders at 2.6 px. The surface the product is *about*
 * is unreadable at the moment it opens.
 *
 * The answer is not a different camera, it is less picture: a project opens on
 * the top `INITIAL_EXPANDED_DEPTH + 1` levels and everything deeper waits
 * behind its container.
 *
 * This module is pure and free of React, like `graphProjection`, because three
 * properties have to be checkable without rendering anything:
 *
 * 1. **Nothing is dropped.** A relationship whose endpoint is hidden is not
 *    removed — it is *lifted* onto the nearest visible ancestor and bundled
 *    there, so the collapsed picture still says "the backend talks to
 *    PostgreSQL". `resolveEdgeBundle` still resolves the lifted edge into the
 *    individual reported relationships, which is what ADR 0008 requires of
 *    every bundle.
 * 2. **It is the identity when nothing is collapsed.** The same arrays come
 *    back, so an expanded canvas is byte-for-byte the graph of ADR 0008 and
 *    cannot have been changed by this module.
 * 3. **It is deterministic.** The collapsed set is normalised and every output
 *    array keeps the canonical order the projection produced — parents before
 *    children, siblings by id, edges by id. The ELK determinism argument of
 *    ADR 0008 therefore survives unchanged: the solver still sees canonically
 *    ordered input with declared sizes.
 */

/** The graph as it is drawn, after hiding everything inside collapsed containers. */
export interface VisibleGraph {
  /** Visible nodes, in the projection's canonical order. */
  nodes: ArchitectureNode[]
  /** Visible edges, endpoints lifted onto visible ancestors, sorted by id. */
  edges: ArchitectureEdge[]
  /** Components that are inside a collapsed container and therefore not drawn. */
  hiddenComponentIds: Set<ComponentId>
  /** Containers that are collapsed and really had something to hide. */
  collapsedComponentIds: Set<ComponentId>
}

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Parent of every node, `null` for a root. */
function parentIndex(
  nodes: readonly ArchitectureNode[],
): Map<ComponentId, ComponentId | null> {
  return new Map(nodes.map((node) => [node.id, node.parentId ?? null]))
}

/**
 * Every container of the graph, in canonical order.
 *
 * "Container" is the projection's own notion — a component that has at least
 * one child in *this* snapshot — so a component whose children were all removed
 * stops being expandable without any extra bookkeeping.
 */
export function containerIds(nodes: readonly ArchitectureNode[]): ComponentId[] {
  return nodes.filter((node) => node.data.isCompound).map((node) => node.id)
}

/**
 * The containers a project opens with collapsed.
 *
 * Every container deeper than `INITIAL_EXPANDED_DEPTH`. A container *at* that
 * depth stays open, because collapsing it would hide the level the rule is
 * meant to show.
 */
export function initialCollapsedIds(nodes: readonly ArchitectureNode[]): ComponentId[] {
  return nodes
    .filter((node) => node.data.isCompound && node.data.depth >= INITIAL_EXPANDED_DEPTH)
    .map((node) => node.id)
    .sort(compareIds)
}

/**
 * The ancestors of a component, root first.
 *
 * This is the path that has to be open for the component to be on screen — the
 * answer to "a deep link points at a component four levels down; what has to
 * happen for the user to see it".
 */
export function ancestorIds(
  nodes: readonly ArchitectureNode[],
  componentId: ComponentId,
): ComponentId[] {
  const parentOf = parentIndex(nodes)
  if (!parentOf.has(componentId)) return []

  const path: ComponentId[] = []
  const guard = new Set<ComponentId>([componentId])
  let current = parentOf.get(componentId) ?? null
  while (current !== null && !guard.has(current)) {
    guard.add(current)
    path.push(current)
    current = parentOf.get(current) ?? null
  }
  return path.reverse()
}

/**
 * Reduces the projected graph to what a given collapsed set leaves visible.
 *
 * Returns the input arrays unchanged when nothing is hidden, so the expanded
 * canvas is provably the graph `projectArchitecture` produced.
 */
export function collapseGraph(
  nodes: readonly ArchitectureNode[],
  edges: readonly ArchitectureEdge[],
  collapsed: readonly ComponentId[],
  orientation: GraphOrientation = DEFAULT_GRAPH_ORIENTATION,
): VisibleGraph {
  const requested = new Set(collapsed)
  const parentOf = parentIndex(nodes)

  // ---- 1. which nodes are hidden, and which containers really collapse -----
  // The pre-order of the projection guarantees a parent is classified before
  // its children, so a single pass is enough to propagate "hidden".
  const hidden = new Set<ComponentId>()
  const collapsedContainers = new Set<ComponentId>()
  const hiddenBelow = new Map<ComponentId, number>()

  for (const node of nodes) {
    const parentId = parentOf.get(node.id) ?? null
    if (parentId !== null && (hidden.has(parentId) || collapsedContainers.has(parentId))) {
      hidden.add(node.id)
    }
    if (node.data.isCompound && requested.has(node.id) && !hidden.has(node.id)) {
      collapsedContainers.add(node.id)
    }
  }

  if (hidden.size === 0) {
    return {
      nodes: nodes as ArchitectureNode[],
      edges: edges as ArchitectureEdge[],
      hiddenComponentIds: hidden,
      collapsedComponentIds: collapsedContainers,
    }
  }

  // How much each collapsed container is holding back, and what is happening in
  // there. Counted on the full hierarchy so a nested collapse still reports
  // everything below it.
  const overlaysBelow = new Map<ComponentId, ChangeOverlay[]>()
  for (const node of nodes) {
    if (!hidden.has(node.id)) continue
    for (const ancestor of ancestorChain(parentOf, node.id)) {
      if (!collapsedContainers.has(ancestor)) continue
      hiddenBelow.set(ancestor, (hiddenBelow.get(ancestor) ?? 0) + 1)
      const overlay = node.data.overlay
      if (!overlay) continue
      const collected = overlaysBelow.get(ancestor)
      if (collected) collected.push(overlay)
      else overlaysBelow.set(ancestor, [overlay])
    }
  }

  // ---- 2. visible nodes; a collapsed container shrinks to a leaf box -------
  // Its size drops to `LEAF_NODE_SIZE` because ELK derives "is a container"
  // from having children, and it no longer has any. The size stays a declared
  // constant either way, which is what keeps the layout independent of the DOM.
  //
  // The node **type** deliberately does not change. React Flow remounts a node
  // whose type changed, and a remounted node is measured from the DOM again —
  // which would put a rendered box back into the layout path the whole canvas
  // is built to keep out of it. A collapsed container stays a container and
  // renders its closed state itself.
  const visibleNodes = nodes
    .filter((node) => !hidden.has(node.id))
    .map((node) => {
      if (!collapsedContainers.has(node.id)) return node
      const below = overlaysBelow.get(node.id) ?? []
      const rolledUp = rollUpOverlay(node.id, node.data.overlay, below)
      return {
        ...node,
        width: LEAF_NODE_SIZE.width,
        height: LEAF_NODE_SIZE.height,
        measured: { width: LEAF_NODE_SIZE.width, height: LEAF_NODE_SIZE.height },
        handles: nodeHandles(LEAF_NODE_SIZE.width, LEAF_NODE_SIZE.height, orientation),
        data: {
          ...node.data,
          collapsed: true,
          hiddenDescendantCount: hiddenBelow.get(node.id) ?? 0,
          overlay: rolledUp.overlay,
          overlayRolledUp: rolledUp.rolledUp,
        },
      } satisfies ArchitectureNode
    })

  // ---- 3. edges, lifted onto the nearest visible ancestor ------------------
  const liftCache = new Map<ComponentId, ComponentId | null>()
  const lift = (componentId: ComponentId): ComponentId | null => {
    const cached = liftCache.get(componentId)
    if (cached !== undefined) return cached
    let current: ComponentId | null = componentId
    const guard = new Set<ComponentId>()
    while (current !== null && hidden.has(current) && !guard.has(current)) {
      guard.add(current)
      current = parentOf.get(current) ?? null
    }
    const resolved = current !== null && !hidden.has(current) ? current : null
    liftCache.set(componentId, resolved)
    return resolved
  }

  interface Bundle {
    id: string
    source: ComponentId
    target: ComponentId
    applied: boolean
    relationships: NonNullable<ArchitectureEdge['data']>['relationships']
    overlays: Record<Identifier, ChangeOverlay>
    /** Direction retained when this bundle was lifted onto visible ancestors. */
    fallbackOrientation: GraphOrientation
    /** The untouched edge, when this bundle is exactly one unlifted edge. */
    original: ArchitectureEdge | null
  }

  const bundles = new Map<string, Bundle>()
  for (const edge of edges) {
    const data = edge.data
    if (!data) continue
    const source = lift(data.sourceComponentId)
    const target = lift(data.targetComponentId)
    // A relationship whose two endpoints collapsed into the same box is
    // internal to that box. It is not drawn — a self loop on a container says
    // nothing — and it comes back the moment the container is expanded.
    if (source === null || target === null || source === target) continue

    const untouched = source === data.sourceComponentId && target === data.targetComponentId
    const id = data.applied ? bundleEdgeId(source, target) : overlayEdgeId(source, target)
    const existing = bundles.get(id)
    if (existing) {
      existing.relationships = [...existing.relationships, ...data.relationships]
      existing.overlays = { ...existing.overlays, ...data.overlays }
      existing.original = null
      continue
    }
    bundles.set(id, {
      id,
      source,
      target,
      applied: data.applied,
      relationships: data.relationships,
      overlays: data.overlays,
      fallbackOrientation: data.fallbackOrientation ?? orientation,
      original: untouched ? edge : null,
    })
  }

  const visibleEdges = [...bundles.values()]
    .sort((a, b) => compareIds(a.id, b.id))
    .map((bundle) => {
      if (bundle.original) return bundle.original
      const relationships = [...bundle.relationships].sort((a, b) =>
        compareIds(a.relationshipId, b.relationshipId),
      )
      return {
        id: bundle.id,
        type: RELATIONSHIP_EDGE_TYPE,
        source: bundle.source,
        target: bundle.target,
        sourceHandle: HANDLE_IDS.source,
        targetHandle: HANDLE_IDS.target,
        data: {
          sourceComponentId: bundle.source,
          targetComponentId: bundle.target,
          relationships,
          applied: bundle.applied,
          overlays: bundle.overlays,
          bundled: relationships.length > 1,
          fallbackOrientation: bundle.fallbackOrientation,
        },
      } as ArchitectureEdge
    })

  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    hiddenComponentIds: hidden,
    collapsedComponentIds: collapsedContainers,
  }
}

/**
 * The work state a collapsed container shows.
 *
 * Hiding a component must not hide what an agent is *doing* to it — that is the
 * one thing this cockpit exists to show. A closed container therefore carries
 * the dominant state of everything behind it, resolved with the same precedence
 * as everywhere else (`dominantOverlay`, ADR 0010), with every contribution of
 * every hidden element kept so the mark's `title` still lists them one by one.
 *
 * Two things are deliberately *not* rolled up:
 *
 * * the **operation**. `geplant · entfernen` on a container would read as "this
 *   container is being removed", which is a claim about the wrong element. A
 *   rolled-up mark says the phase and no more; the operation is one expansion
 *   away, on the element that actually reported it.
 * * the **presence**. A proposal or a ghost inside an applied container does not
 *   make the container itself a proposal, so it is never dimmed for one.
 */
function rollUpOverlay(
  componentId: ComponentId,
  own: ChangeOverlay | null,
  below: readonly ChangeOverlay[],
): { overlay: ChangeOverlay | null; rolledUp: boolean } {
  if (below.length === 0) return { overlay: own, rolledUp: false }

  const dominant = dominantOverlay(own ? [own, ...below] : below)
  if (dominant === null) return { overlay: own, rolledUp: false }
  if (dominant === own) return { overlay: own, rolledUp: false }

  const all = own ? [own, ...below] : [...below]
  return {
    overlay: {
      ...dominant,
      targetKind: 'component',
      targetId: componentId,
      presence: own?.presence ?? 'applied',
      operation: null,
      contributions: all.flatMap((overlay) => overlay.contributions),
      agentIds: [...new Set(all.flatMap((overlay) => overlay.agentIds))],
      descriptor: null,
    },
    rolledUp: true,
  }
}

/** Ancestors of a node, nearest first. */
function ancestorChain(
  parentOf: ReadonlyMap<ComponentId, ComponentId | null>,
  componentId: ComponentId,
): ComponentId[] {
  const chain: ComponentId[] = []
  const guard = new Set<ComponentId>([componentId])
  let current = parentOf.get(componentId) ?? null
  while (current !== null && !guard.has(current)) {
    guard.add(current)
    chain.push(current)
    current = parentOf.get(current) ?? null
  }
  return chain
}
