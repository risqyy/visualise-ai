import type { ELK, ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api'

import {
  COMPOUND_HEADER_HEIGHT,
  COMPOUND_MIN_SIZE,
  HANDLE_IDS,
  LEAF_NODE_SIZE,
  nodeHandles,
  type ArchitectureEdge,
  type ArchitectureNode,
} from './graphProjection'

/**
 * Automatic layout with ELK's `layered` algorithm.
 *
 * `layered` (a Sugiyama-style algorithm) is the right fit because an
 * architecture model *is* a directed, mostly acyclic graph: callers on the
 * left, callees on the right, with a readable layer per hop. Force-directed
 * alternatives give a pretty but arbitrary picture that changes every time, and
 * a tree layout cannot express the cross-links an architecture is full of.
 *
 * **Determinism is a hard requirement here**, because the cockpit re-lays out
 * whenever an agent reports a structural change, and a model that reshuffles
 * itself is unreadable. Three things secure it:
 *
 * 1. The projection already delivers nodes and edges in canonical id order, and
 *    this module sorts again defensively before handing them to ELK. The order
 *    of the rows the read API happened to return therefore cannot leak into the
 *    picture.
 * 2. `elk.randomSeed` is pinned, so the heuristics inside `layered` start from
 *    the same state on every run.
 * 3. Node sizes are fixed constants, never measured from the DOM, and never
 *    dependent on the zoom-driven detail level.
 *
 * Edges are declared on the root graph and `elk.hierarchyHandling:
 * INCLUDE_CHILDREN` lets ELK route them across container boundaries; their
 * coordinates then come back relative to the root, i.e. absolute.
 */

export interface LayoutPoint {
  x: number
  y: number
}

/** Absolute polyline of one edge, from the source handle to the target handle. */
export type EdgeRoutes = Record<string, LayoutPoint[]>

export interface ArchitectureLayout {
  /** Same nodes, in the same order, with positions and container sizes. */
  nodes: ArchitectureNode[]
  routes: EdgeRoutes
  /** Bounding box of the laid-out graph, in flow coordinates. */
  bounds: { width: number; height: number }
}

export interface LayoutOptionsInput {
  /** Layout direction. `RIGHT` reads as "calls flow to the right". */
  direction?: 'RIGHT' | 'DOWN'
}

/**
 * Base options of the root graph.
 *
 * `elk.edgeRouting: ORTHOGONAL` is not cosmetic: the layered algorithm reserves
 * the space between two layers according to the routing style, so switching it
 * off would change the node placement too.
 */
export const ROOT_LAYOUT_OPTIONS: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  // Pinned seed: `layered` uses randomised tie-breaking in its heuristics.
  'elk.randomSeed': '1',
  // Deterministic, order-driven heuristics rather than randomised ones.
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.thoroughness': '10',
  // Never collapse parallel edges: they carry separate reported relationships.
  'elk.layered.mergeEdges': 'false',
  'elk.layered.mergeHierarchyEdges': 'false',
  'elk.spacing.nodeNode': '44',
  'elk.spacing.edgeNode': '28',
  'elk.spacing.edgeEdge': '14',
  'elk.layered.spacing.nodeNodeBetweenLayers': '110',
  'elk.layered.spacing.edgeNodeBetweenLayers': '32',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
  'elk.padding': '[top=24,left=24,bottom=24,right=24]',
}

/** Options of a compound node: same algorithm, plus room for its header. */
export const COMPOUND_LAYOUT_OPTIONS: LayoutOptions = {
  'elk.padding': `[top=${COMPOUND_HEADER_HEIGHT + 12},left=20,bottom=20,right=20]`,
  'elk.spacing.nodeNode': '36',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.nodeSize.constraints': 'NODE_LABELS MINIMUM_SIZE',
  'elk.nodeSize.minimum': `(${COMPOUND_MIN_SIZE.width},${COMPOUND_MIN_SIZE.height})`,
}

// ---------------------------------------------------------------------------
// ELK instance
// ---------------------------------------------------------------------------

let elkPromise: Promise<ELK> | null = null

/**
 * Loads ELK lazily.
 *
 * The bundled build carries the whole GWT-compiled algorithm (~1.4 MB), which
 * has no business in the entry chunk of a cockpit that may never open a
 * project. The dynamic import turns it into its own chunk, fetched the first
 * time an architecture is laid out.
 */
async function getElk(): Promise<ELK> {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then(
    (module) => new module.default(),
  )
  return elkPromise
}

/** Test seam: drops the cached instance. */
export function resetElkForTests(): void {
  elkPromise = null
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const sourcePortId = (nodeId: string): string => `${nodeId}:${HANDLE_IDS.source}`
const targetPortId = (nodeId: string): string => `${nodeId}:${HANDLE_IDS.target}`

/**
 * Builds the ELK graph.
 *
 * Every node gets exactly two fixed ports at the positions where React Flow
 * draws its handles — right-centre for outgoing, left-centre for incoming. With
 * `elk.portConstraints: FIXED_POS` ELK routes from and to those exact points,
 * so the polyline it returns is attached to the handle instead of merely
 * ending near it.
 */
export function buildElkGraph(
  nodes: readonly ArchitectureNode[],
  edges: readonly ArchitectureEdge[],
  options: LayoutOptionsInput = {},
): ElkNode {
  const sorted = [...nodes].sort((a, b) => compareIds(a.id, b.id))
  const childrenOf = new Map<string, ArchitectureNode[]>()
  const roots: ArchitectureNode[] = []

  for (const node of sorted) {
    const parentId = node.parentId
    if (parentId === undefined || parentId === null) {
      roots.push(node)
      continue
    }
    const siblings = childrenOf.get(parentId)
    if (siblings) siblings.push(node)
    else childrenOf.set(parentId, [node])
  }

  const toElkNode = (node: ArchitectureNode): ElkNode => {
    const children = childrenOf.get(node.id) ?? []
    const width = node.width ?? LEAF_NODE_SIZE.width
    const height = node.height ?? LEAF_NODE_SIZE.height

    const elkNode: ElkNode = {
      id: node.id,
      width,
      height,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_POS',
        ...(children.length > 0 ? COMPOUND_LAYOUT_OPTIONS : {}),
      },
      ports: [
        {
          id: targetPortId(node.id),
          x: 0,
          y: height / 2,
          width: 1,
          height: 1,
          layoutOptions: { 'elk.port.side': 'WEST', 'elk.port.index': '0' },
        },
        {
          id: sourcePortId(node.id),
          x: width,
          y: height / 2,
          width: 1,
          height: 1,
          layoutOptions: { 'elk.port.side': 'EAST', 'elk.port.index': '1' },
        },
      ],
    }

    if (children.length > 0) elkNode.children = children.map(toElkNode)
    return elkNode
  }

  // Self references are excluded from the layout: they cannot influence the
  // placement of anything and only confuse the layered algorithm. They are
  // still projected and rendered.
  const elkEdges: ElkExtendedEdge[] = [...edges]
    .filter((edge) => edge.source !== edge.target)
    .sort((a, b) => compareIds(a.id, b.id))
    .map((edge) => ({
      id: edge.id,
      sources: [sourcePortId(edge.source)],
      targets: [targetPortId(edge.target)],
    }))

  return {
    id: 'root',
    layoutOptions: {
      ...ROOT_LAYOUT_OPTIONS,
      ...(options.direction ? { 'elk.direction': options.direction } : {}),
    },
    children: roots.map(toElkNode),
    edges: elkEdges,
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Lays out a projected architecture graph.
 *
 * Returns nodes in exactly the order they came in — React Flow needs parents
 * before children, and the projection already guarantees that.
 */
export async function layoutArchitecture(
  nodes: readonly ArchitectureNode[],
  edges: readonly ArchitectureEdge[],
  options: LayoutOptionsInput = {},
): Promise<ArchitectureLayout> {
  if (nodes.length === 0) {
    return { nodes: [], routes: {}, bounds: { width: 0, height: 0 } }
  }

  const elk = await getElk()
  const graph = buildElkGraph(nodes, edges, options)
  const laidOut = await elk.layout(graph)

  const positions = new Map<string, { x: number; y: number; width: number; height: number }>()
  const absolute = new Map<string, { x: number; y: number }>()
  const elkEdgesById = new Map<string, ElkExtendedEdge>()

  // ELK reports a child's coordinates relative to its container. Walking the
  // tree with an accumulated offset keeps the node positions relative — which
  // is what React Flow wants for a node inside a parent — while recording the
  // absolute position of every node for the edge conversion below.
  const walk = (elkNode: ElkNode, offsetX: number, offsetY: number): void => {
    const absoluteX = offsetX + (elkNode.x ?? 0)
    const absoluteY = offsetY + (elkNode.y ?? 0)
    absolute.set(elkNode.id, { x: absoluteX, y: absoluteY })

    for (const child of elkNode.children ?? []) {
      positions.set(child.id, {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? LEAF_NODE_SIZE.width,
        height: child.height ?? LEAF_NODE_SIZE.height,
      })
      walk(child, absoluteX, absoluteY)
    }

    for (const edge of elkNode.edges ?? []) {
      elkEdgesById.set(edge.id, edge as ElkExtendedEdge)
    }
  }

  walk(laidOut, 0, 0)

  // Edge sections are **not** relative to the container the edge was declared
  // in: with `hierarchyHandling: INCLUDE_CHILDREN`, ELK reports them relative to
  // the lowest common ancestor of the two endpoints. Declaring all edges on the
  // root graph therefore does not make their coordinates absolute — each one has
  // to be shifted by the absolute position of that ancestor. Getting this wrong
  // detaches every edge between two nested components from its handles by the
  // offset of the container they share.
  const parentOf = new Map<string, string | undefined>(
    nodes.map((node) => [node.id, node.parentId]),
  )
  const routes: EdgeRoutes = {}

  for (const edge of edges) {
    const elkEdge = elkEdgesById.get(edge.id)
    if (!elkEdge) continue

    const container = lowestCommonAncestor(parentOf, edge.source, edge.target)
    const origin = (container ? absolute.get(container) : undefined) ?? { x: 0, y: 0 }

    const points: LayoutPoint[] = []
    for (const section of elkEdge.sections ?? []) {
      points.push({
        x: origin.x + section.startPoint.x,
        y: origin.y + section.startPoint.y,
      })
      for (const bend of section.bendPoints ?? []) {
        points.push({ x: origin.x + bend.x, y: origin.y + bend.y })
      }
      points.push({
        x: origin.x + section.endPoint.x,
        y: origin.y + section.endPoint.y,
      })
    }
    if (points.length >= 2) routes[edge.id] = dedupePoints(points)
  }

  const positioned = nodes.map((node) => {
    const layout = positions.get(node.id)
    if (!layout) return node
    const width = round(layout.width)
    const height = round(layout.height)
    return {
      ...node,
      position: { x: round(layout.x), y: round(layout.y) },
      width,
      height,
      measured: { width, height },
      // Re-declared for the size ELK settled on — a container grows around its
      // children, and its handles have to follow.
      handles: nodeHandles(width, height),
      style: { ...node.style, width, height },
    }
  })

  return {
    nodes: positioned,
    routes,
    bounds: {
      width: round(laidOut.width ?? 0),
      height: round(laidOut.height ?? 0),
    },
  }
}

/**
 * Rounds to whole pixels.
 *
 * ELK works in floating point, and comparing two runs bit for bit is only
 * meaningful once the result is quantised the same way the renderer quantises
 * it. Rounding here is what makes "the same model lays out identically" a
 * checkable statement rather than an approximate one.
 */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * The deepest node that contains both endpoints, or `undefined` when they only
 * share the root graph. A node counts as containing itself, so an edge from a
 * container to one of its own children resolves to that container.
 */
function lowestCommonAncestor(
  parentOf: ReadonlyMap<string, string | undefined>,
  source: string,
  target: string,
): string | undefined {
  const ancestorsOf = (id: string): string[] => {
    const chain: string[] = []
    let current: string | undefined = id
    const guard = new Set<string>()
    while (current !== undefined && !guard.has(current)) {
      guard.add(current)
      chain.push(current)
      current = parentOf.get(current)
    }
    return chain
  }

  const sourceChain = new Set(ancestorsOf(source))
  for (const candidate of ancestorsOf(target)) {
    if (sourceChain.has(candidate)) return candidate
  }
  return undefined
}

/** Drops consecutive duplicates that ELK emits at section boundaries. */
function dedupePoints(points: LayoutPoint[]): LayoutPoint[] {
  const result: LayoutPoint[] = []
  for (const point of points) {
    const previous = result[result.length - 1]
    const rounded = { x: round(point.x), y: round(point.y) }
    if (previous && previous.x === rounded.x && previous.y === rounded.y) continue
    result.push(rounded)
  }
  return result
}

/** Compact, comparable description of a layout. Used by the determinism tests. */
export function describeLayout(layout: ArchitectureLayout): string {
  return layout.nodes
    .map(
      (node) =>
        `${node.id}@${node.position.x},${node.position.y} ${node.width}x${node.height}`,
    )
    .join('\n')
}
