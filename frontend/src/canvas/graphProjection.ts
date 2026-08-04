import type { Edge, Node, NodeHandle, Position } from '@xyflow/react'

import type { Component, ComponentId, Identifier, Relationship } from '@/api/types'

import { relationshipDiscriminator, relationshipDisplayName } from './relationshipKinds'

/**
 * The graph projection adapter: domain model → React Flow graph.
 *
 * This module is deliberately free of React and of React Flow *runtime* code —
 * the only import from `@xyflow/react` is a type import, which the compiler
 * erases. It can therefore be exercised in isolation, which matters because it
 * is the one place where the hierarchy, the edge bundling and the robustness
 * rules live.
 *
 * Three properties it guarantees:
 *
 * 1. **Nothing is invented and nothing is dropped silently.** Every component
 *    and every relationship of the snapshot ends up either in the graph or in
 *    `diagnostics`, never nowhere.
 * 2. **Separate relationships stay separate.** Parallel relationships between
 *    the same pair of components share one *rendered* edge, but the edge keeps
 *    the full, individually addressable list. NATS topics are the reason this
 *    rule exists: the server never merges them, and neither does this adapter.
 * 3. **It is total.** A `parentComponentId` pointing at a component that is not
 *    in the snapshot, or a cycle in the hierarchy, produces a defined graph and
 *    a diagnostic — never an endless loop and never a throw.
 *
 * The output order is canonical (sorted by id, parents before children), which
 * is what makes the downstream ELK layout independent of the order the read API
 * happened to serialise its rows in.
 */

// ---------------------------------------------------------------------------
// Node and edge types
// ---------------------------------------------------------------------------

/** React Flow node type of a component without children. */
export const COMPONENT_NODE_TYPE = 'architectureComponent'
/** React Flow node type of a component that contains other components. */
export const COMPOUND_NODE_TYPE = 'architectureGroup'
/** React Flow edge type of one (possibly bundled) relationship edge. */
export const RELATIONSHIP_EDGE_TYPE = 'architectureRelationship'

export type ArchitectureNodeType = typeof COMPONENT_NODE_TYPE | typeof COMPOUND_NODE_TYPE

/** Handle ids. Fixed so the ELK ports and the React Flow handles agree. */
export const HANDLE_IDS = { source: 'out', target: 'in' } as const

/**
 * Declares the two handles of a node on the node itself.
 *
 * React Flow can measure handles from the DOM, but then edge geometry depends
 * on a rendered layout — which makes it different in a browser and in a test,
 * and different again before and after the first measurement. Declaring the
 * handles explicitly makes the geometry a pure function of the layout: incoming
 * on the left edge, outgoing on the right edge, both vertically centred, which
 * is exactly where the ELK ports sit.
 */
export function nodeHandles(width: number, height: number): NodeHandle[] {
  return [
    {
      id: HANDLE_IDS.target,
      type: 'target',
      position: 'left' as Position,
      x: 0,
      y: height / 2,
      width: 1,
      height: 1,
    },
    {
      id: HANDLE_IDS.source,
      type: 'source',
      position: 'right' as Position,
      x: width,
      y: height / 2,
      width: 1,
      height: 1,
    },
  ]
}

export interface ComponentNodeData extends Record<string, unknown> {
  component: Component
  /** 0 for a root component, 1 for its children, and so on. */
  depth: number
  /** Number of direct children rendered inside this node. */
  childCount: number
  /** `true` when this node is a compound container. */
  isCompound: boolean
}

export type ArchitectureNode = Node<ComponentNodeData, ArchitectureNodeType>

export interface RelationshipEdgeData extends Record<string, unknown> {
  sourceComponentId: ComponentId
  targetComponentId: ComponentId
  /**
   * Every relationship the agent reported for this ordered node pair, sorted by
   * `relationshipId`. Always at least one entry — this is the list the UI
   * resolves a bundle back into.
   */
  relationships: Relationship[]
  /** `true` when more than one relationship shares this pair of components. */
  bundled: boolean
  /**
   * Absolute polyline computed by ELK, attached by the canvas after the layout.
   * Absent while no layout exists or after one of the endpoints was dragged;
   * the edge then falls back to a plain orthogonal connection.
   */
  route?: { x: number; y: number }[]
}

export type ArchitectureEdge = Edge<RelationshipEdgeData, typeof RELATIONSHIP_EDGE_TYPE>

// ---------------------------------------------------------------------------
// Geometry defaults
// ---------------------------------------------------------------------------

/**
 * Fixed size of a leaf node.
 *
 * The size must not depend on the zoom-driven detail level: if it did, zooming
 * would change the layout and therefore move the camera relative to the model —
 * exactly the kind of unexpected motion the cockpit must not produce. The
 * progressive detail levels only change what is rendered *inside* this box.
 */
export const LEAF_NODE_SIZE = { width: 228, height: 96 } as const

/** Minimum size of a compound container; ELK grows it around its children. */
export const COMPOUND_MIN_SIZE = { width: 260, height: 120 } as const

/** Room ELK must leave at the top of a container for its header row. */
export const COMPOUND_HEADER_HEIGHT = 40

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface OrphanedParentDiagnostic {
  componentId: ComponentId
  /** The `parentComponentId` that is not part of this snapshot. */
  missingParentComponentId: ComponentId
}

export interface DanglingRelationshipDiagnostic {
  relationshipId: Identifier
  /** The endpoint that is not part of this snapshot. */
  missingComponentId: ComponentId
  endpoint: 'source' | 'target'
}

/**
 * Everything the adapter had to repair. The canvas surfaces the counts so a
 * broken snapshot is visible instead of silently half-rendered.
 */
export interface ProjectionDiagnostics {
  /** Components whose parent is not in the snapshot; rendered as roots. */
  orphanedParents: OrphanedParentDiagnostic[]
  /**
   * Cycles found while walking the hierarchy, each as the sorted list of its
   * members. The alphabetically first member of a cycle is cut loose and
   * rendered as a root, which breaks the cycle deterministically.
   */
  hierarchyCycles: ComponentId[][]
  /** Relationships with an endpoint that is not in the snapshot; not rendered. */
  danglingRelationships: DanglingRelationshipDiagnostic[]
  /** Component ids that appeared more than once; the first occurrence wins. */
  duplicateComponentIds: ComponentId[]
  /** Relationship ids that appeared more than once; the first occurrence wins. */
  duplicateRelationshipIds: Identifier[]
  /** Relationships whose source and target are the same component. */
  selfReferences: Identifier[]
}

export function isProjectionClean(diagnostics: ProjectionDiagnostics): boolean {
  return (
    diagnostics.orphanedParents.length === 0 &&
    diagnostics.hierarchyCycles.length === 0 &&
    diagnostics.danglingRelationships.length === 0 &&
    diagnostics.duplicateComponentIds.length === 0 &&
    diagnostics.duplicateRelationshipIds.length === 0
  )
}

/** Number of problems the adapter had to repair. */
export function diagnosticsCount(diagnostics: ProjectionDiagnostics): number {
  return (
    diagnostics.orphanedParents.length +
    diagnostics.hierarchyCycles.length +
    diagnostics.danglingRelationships.length +
    diagnostics.duplicateComponentIds.length +
    diagnostics.duplicateRelationshipIds.length
  )
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface ArchitectureModel {
  components: readonly Component[]
  relationships: readonly Relationship[]
}

export interface ArchitectureProjection {
  /** Canonically ordered: parents before their children, siblings by id. */
  nodes: ArchitectureNode[]
  /** One edge per ordered node pair, sorted by edge id. */
  edges: ArchitectureEdge[]
  diagnostics: ProjectionDiagnostics
  /** Components by id, for lookups that would otherwise re-scan the list. */
  componentsById: Map<ComponentId, Component>
}

export const EMPTY_DIAGNOSTICS: ProjectionDiagnostics = {
  orphanedParents: [],
  hierarchyCycles: [],
  danglingRelationships: [],
  duplicateComponentIds: [],
  duplicateRelationshipIds: [],
  selfReferences: [],
}

/** Builds the id of the edge that carries the relationships of one node pair. */
export function bundleEdgeId(source: ComponentId, target: ComponentId): string {
  return `rel:${source}~>${target}`
}

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Projects one architecture snapshot into a React Flow graph.
 *
 * Pure: the same input always produces the same output, including the order of
 * every array.
 */
export function projectArchitecture(model: ArchitectureModel): ArchitectureProjection {
  const diagnostics: ProjectionDiagnostics = {
    orphanedParents: [],
    hierarchyCycles: [],
    danglingRelationships: [],
    duplicateComponentIds: [],
    duplicateRelationshipIds: [],
    selfReferences: [],
  }

  // ---- 1. canonical component index ---------------------------------------
  const componentsById = new Map<ComponentId, Component>()
  const sortedComponents = [...model.components].sort((a, b) =>
    compareIds(a.componentId, b.componentId),
  )
  for (const component of sortedComponents) {
    if (componentsById.has(component.componentId)) {
      if (!diagnostics.duplicateComponentIds.includes(component.componentId)) {
        diagnostics.duplicateComponentIds.push(component.componentId)
      }
      continue
    }
    componentsById.set(component.componentId, component)
  }

  // ---- 2. resolve parents, cutting links that point nowhere ---------------
  const parentOf = new Map<ComponentId, ComponentId | null>()
  for (const [componentId, component] of componentsById) {
    const parentId = component.parentComponentId
    if (parentId === null || parentId === undefined || parentId === '') {
      parentOf.set(componentId, null)
      continue
    }
    if (!componentsById.has(parentId)) {
      diagnostics.orphanedParents.push({
        componentId,
        missingParentComponentId: parentId,
      })
      parentOf.set(componentId, null)
      continue
    }
    parentOf.set(componentId, parentId)
  }

  // ---- 3. break hierarchy cycles ------------------------------------------
  // Walking up from every component in id order. The walk is bounded by the
  // set of already visited ancestors, so it terminates even for a component
  // that is its own parent. When a cycle is found, the alphabetically first of
  // its members is cut loose; that choice does not depend on the input order,
  // so the repaired hierarchy is deterministic.
  for (const componentId of [...parentOf.keys()]) {
    const path: ComponentId[] = [componentId]
    const seen = new Set<ComponentId>([componentId])
    let current = parentOf.get(componentId) ?? null

    while (current !== null) {
      if (seen.has(current)) {
        const cycleStart = path.indexOf(current)
        const members = path.slice(cycleStart === -1 ? 0 : cycleStart).sort(compareIds)
        diagnostics.hierarchyCycles.push(members)
        const cutLoose = members[0]
        if (cutLoose !== undefined) parentOf.set(cutLoose, null)
        break
      }
      seen.add(current)
      path.push(current)
      current = parentOf.get(current) ?? null
    }
  }

  // ---- 4. children index (already in id order) ----------------------------
  const childrenOf = new Map<ComponentId, ComponentId[]>()
  const roots: ComponentId[] = []
  for (const [componentId, parentId] of parentOf) {
    if (parentId === null) {
      roots.push(componentId)
      continue
    }
    const siblings = childrenOf.get(parentId)
    if (siblings) siblings.push(componentId)
    else childrenOf.set(parentId, [componentId])
  }

  // ---- 5. nodes in pre-order (React Flow needs parents first) -------------
  const nodes: ArchitectureNode[] = []
  const stack: { componentId: ComponentId; depth: number }[] = roots
    .map((componentId) => ({ componentId, depth: 0 }))
    .reverse()

  while (stack.length > 0) {
    const entry = stack.pop()
    if (!entry) break
    const component = componentsById.get(entry.componentId)
    if (!component) continue

    const children = childrenOf.get(entry.componentId) ?? []
    const isCompound = children.length > 0
    const parentId = parentOf.get(entry.componentId) ?? null

    const size = isCompound ? COMPOUND_MIN_SIZE : LEAF_NODE_SIZE
    const node: ArchitectureNode = {
      id: entry.componentId,
      type: isCompound ? COMPOUND_NODE_TYPE : COMPONENT_NODE_TYPE,
      position: { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      // `measured` is what React Flow fits the view to and what it uses to
      // decide a node is ready. The layout is the authority on the size — the
      // DOM box is rendered *from* it — so reporting it here rather than
      // waiting for a `ResizeObserver` is the honest answer, and it makes the
      // canvas behave identically before and after the first paint.
      measured: { width: size.width, height: size.height },
      handles: nodeHandles(size.width, size.height),
      data: {
        component,
        depth: entry.depth,
        childCount: children.length,
        isCompound,
      },
      ...(parentId !== null ? { parentId, extent: 'parent' as const } : {}),
    }
    nodes.push(node)

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const childId = children[index]
      if (childId !== undefined) stack.push({ componentId: childId, depth: entry.depth + 1 })
    }
  }

  // ---- 6. relationships -> bundled edges ----------------------------------
  const relationshipsById = new Map<Identifier, Relationship>()
  const sortedRelationships = [...model.relationships].sort((a, b) =>
    compareIds(a.relationshipId, b.relationshipId),
  )
  for (const relationship of sortedRelationships) {
    if (relationshipsById.has(relationship.relationshipId)) {
      if (!diagnostics.duplicateRelationshipIds.includes(relationship.relationshipId)) {
        diagnostics.duplicateRelationshipIds.push(relationship.relationshipId)
      }
      continue
    }
    relationshipsById.set(relationship.relationshipId, relationship)
  }

  const bundles = new Map<string, Relationship[]>()
  for (const relationship of relationshipsById.values()) {
    const { sourceComponentId, targetComponentId, relationshipId } = relationship

    if (!componentsById.has(sourceComponentId)) {
      diagnostics.danglingRelationships.push({
        relationshipId,
        missingComponentId: sourceComponentId,
        endpoint: 'source',
      })
      continue
    }
    if (!componentsById.has(targetComponentId)) {
      diagnostics.danglingRelationships.push({
        relationshipId,
        missingComponentId: targetComponentId,
        endpoint: 'target',
      })
      continue
    }
    if (sourceComponentId === targetComponentId) {
      diagnostics.selfReferences.push(relationshipId)
    }

    const key = bundleEdgeId(sourceComponentId, targetComponentId)
    const existing = bundles.get(key)
    if (existing) existing.push(relationship)
    else bundles.set(key, [relationship])
  }

  const edges: ArchitectureEdge[] = [...bundles.keys()]
    .sort(compareIds)
    .map((edgeId) => {
      // Non-null: the key came from this very map.
      const relationships = bundles.get(edgeId) as Relationship[]
      const first = relationships[0] as Relationship
      return {
        id: edgeId,
        type: RELATIONSHIP_EDGE_TYPE,
        source: first.sourceComponentId,
        target: first.targetComponentId,
        sourceHandle: HANDLE_IDS.source,
        targetHandle: HANDLE_IDS.target,
        data: {
          sourceComponentId: first.sourceComponentId,
          targetComponentId: first.targetComponentId,
          relationships,
          bundled: relationships.length > 1,
        },
      }
    })

  return { nodes, edges, diagnostics, componentsById }
}

// ---------------------------------------------------------------------------
// Resolving a bundle back into its individual relationships
// ---------------------------------------------------------------------------

export interface ResolvedRelationship {
  relationship: Relationship
  /** Index within the bundle, used for the fan-out offset. */
  index: number
  /** Number of relationships in the bundle this one belongs to. */
  total: number
  /**
   * What identifies this relationship among its siblings — the topic name for
   * `nats_topic`, otherwise the operation or the label. `null` when the agent
   * reported none of them.
   */
  discriminator: string | null
  /** Abbreviation plus discriminator, e.g. `NATS · orders.created`. */
  displayName: string
}

/**
 * Resolves a rendered edge back into the individual relationships it carries.
 *
 * This is the counterpart of the bundling in `projectArchitecture` and the
 * reason bundling is allowed at all: a bundle is a *rendering* of several
 * relationships, never a merge of them. Every single NATS topic stays reachable
 * and identifiable through this function, at any zoom level.
 */
export function resolveEdgeBundle(edge: ArchitectureEdge): ResolvedRelationship[] {
  return resolveRelationships(edge.data?.relationships ?? [])
}

/** Same as `resolveEdgeBundle`, for callers that already hold the list. */
export function resolveRelationships(
  relationships: readonly Relationship[],
): ResolvedRelationship[] {
  return relationships.map((relationship, index) => ({
    relationship,
    index,
    total: relationships.length,
    discriminator: relationshipDiscriminator(relationship),
    displayName: relationshipDisplayName(relationship),
  }))
}

/** Total number of relationships carried by a set of edges. */
export function countRelationships(edges: readonly ArchitectureEdge[]): number {
  return edges.reduce((total, edge) => total + (edge.data?.relationships.length ?? 0), 0)
}

/**
 * A structural fingerprint of the projection.
 *
 * The ELK layout depends on exactly this information — node ids, their nesting,
 * their fixed sizes and the edges between them. Two projections with the same
 * signature therefore have the same layout, which is what lets the canvas skip
 * a re-layout after a refetch that changed nothing structural.
 */
export function projectionSignature(projection: ArchitectureProjection): string {
  const nodes = projection.nodes
    .map((node) => `${node.id}<${node.parentId ?? ''}>${node.width}x${node.height}`)
    .join('|')
  const edges = projection.edges
    .map((edge) => `${edge.id}#${edge.data?.relationships.length ?? 0}`)
    .join('|')
  return `${nodes}||${edges}`
}
