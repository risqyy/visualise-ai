import { useEffect, useMemo, useRef, useState } from 'react'

import type { ComponentId } from '@/api/types'

import { ancestorIds, collapseGraph, initialCollapsedIds } from './collapse'
import { layoutArchitecture, type EdgeRoutes } from './elkLayout'
import {
  DEFAULT_GRAPH_ORIENTATION,
  elkDirectionForOrientation,
  type GraphOrientation,
} from './graphOrientation'
import {
  EMPTY_DIAGNOSTICS,
  projectArchitecture,
  projectionSignature,
  type ArchitectureEdge,
  type ArchitectureModel,
  type ArchitectureNode,
  type ProjectionDiagnostics,
} from './graphProjection'

/** Positions the user dragged nodes to. Local, temporary, never persisted. */
export type TemporaryPositions = Record<ComponentId, { x: number; y: number }>

export interface ArchitectureGraph {
  nodes: ArchitectureNode[]
  edges: ArchitectureEdge[]
  routes: EdgeRoutes
  diagnostics: ProjectionDiagnostics
  /** `true` while no layout exists yet — the canvas shows its loading state. */
  isInitialLayout: boolean
  /** `true` while a re-layout is running over an already visible graph. */
  isRelayouting: boolean
  /** Non-null when ELK failed; the last good graph stays on screen. */
  error: unknown
  /** Structural fingerprint of the model currently laid out. */
  signature: string
  /** Nodes that belong to the applied architecture model. */
  appliedNodeCount: number
  /** Nodes drawn only because a change was reported (proposals and ghosts). */
  overlayNodeCount: number
  /** Edges of the applied model. */
  appliedEdgeCount: number
  /** Edges drawn only because a change was reported. */
  overlayEdgeCount: number
  /** Containers that are currently collapsed, in canonical order. */
  collapsedIds: ComponentId[]
  /**
   * The complete collapse state requested by the user, including containers
   * below a currently collapsed parent. `collapsedIds` cannot carry those IDs
   * because they are not visible until that parent is opened.
   */
  requestedCollapsedIds: ComponentId[]
  /**
   * The collapsed set this model opens with. Kept here rather than recomputed
   * by the canvas because it needs the *full* hierarchy, which only the
   * projection still has once containers are closed.
   */
  initialCollapsedIds: ComponentId[]
  /** Components hidden inside a collapsed container. */
  hiddenComponentIds: Set<ComponentId>
  /** Applied-model and overlay elements drawn right now. */
  visibleNodeCount: number
  /** Rendered connections after collapse and relationship bundling. */
  visibleEdgeCount: number
  /** Relationships the applied model reported, before rendering decisions. */
  reportedRelationshipCount: number
  /** The containers that have to be opened for a component to be on screen. */
  ancestorsOf: (componentId: ComponentId) => ComponentId[]
}

const EMPTY_MODEL: ArchitectureModel = { components: [], relationships: [] }

/** Not a legal character in a `ComponentId`, so it cannot collide. */
const KEY_SEPARATOR = '\u0000'

export interface ArchitectureGraphOptions {
  /**
   * Containers the user has collapsed, or `null` while the project is still on
   * its initial disclosure — the canvas then uses `initialCollapsedIds`.
   */
  collapsedComponentIds: readonly ComponentId[] | null
  /**
   * A component that must be on screen. Its ancestors are opened regardless of
   * the collapsed set, which is what makes a deep link into a component four
   * levels down actually arrive.
   */
  revealComponentId?: ComponentId | null
  /** Direction used for handles, ports and the ELK layered layout. */
  orientation?: GraphOrientation
  /** Components at both ends of a relationship deep link that must be visible. */
  revealComponentIds?: readonly ComponentId[]
}

/**
 * Projects an architecture snapshot and lays it out with ELK.
 *
 * Two things this hook is careful about:
 *
 * * **It does not re-layout when nothing structural changed.** TanStack Query's
 *   structural sharing keeps the same object identity for a refetch that
 *   returned equal data, and the projection signature catches the rest. A
 *   refetch therefore does not make the graph flicker.
 * * **It never blanks the canvas.** While a re-layout runs, the previous graph
 *   stays on screen and only a quiet indicator changes. A layout that fails
 *   leaves the last good graph visible and reports the error.
 */
export function useArchitectureGraph(
  model: ArchitectureModel | undefined,
  options: ArchitectureGraphOptions = {
    collapsedComponentIds: [],
    orientation: DEFAULT_GRAPH_ORIENTATION,
  },
): ArchitectureGraph {
  const {
    collapsedComponentIds,
    revealComponentId,
    orientation = DEFAULT_GRAPH_ORIENTATION,
  } = options
  const { revealComponentIds = [] } = options
  const reportedRelationshipCount = model?.relationships.length ?? 0

  const projection = useMemo(
    () => projectArchitecture(model ?? EMPTY_MODEL, orientation),
    [model, orientation],
  )

  /**
   * The collapsed set as a stable string.
   *
   * Keying the reduction on the content rather than on the array identity is
   * what keeps a re-render that produced an equal set from re-running ELK — the
   * same reason `projectionSignature` exists.
   */
  const requestedCollapsedIds = useMemo(
    () =>
      [...(collapsedComponentIds ?? initialCollapsedIds(projection.nodes))].sort(),
    [collapsedComponentIds, projection.nodes],
  )

  const collapsedKey = useMemo(() => {
    const base = requestedCollapsedIds
    const revealIds = [
      ...(revealComponentId ? [revealComponentId] : []),
      ...revealComponentIds,
    ]
    if (revealIds.length === 0) return [...base].sort().join(KEY_SEPARATOR)
    const revealed = new Set(
      revealIds.flatMap((componentId) => ancestorIds(projection.nodes, componentId)),
    )
    return base
      .filter((componentId) => !revealed.has(componentId))
      .sort()
      .join(KEY_SEPARATOR)
  }, [requestedCollapsedIds, revealComponentId, revealComponentIds, projection.nodes])

  const visible = useMemo(
    () =>
      collapseGraph(
        projection.nodes,
        projection.edges,
        collapsedKey === '' ? [] : collapsedKey.split(KEY_SEPARATOR),
        orientation,
      ),
    [projection, collapsedKey, orientation],
  )

  const signature = useMemo(() => projectionSignature(visible), [visible])
  // Orientation is part of what ELK solves even though it does not alter the
  // projected component/relationship inventory. Including it in the layout
  // signature prevents the previous direction from being treated as current
  // while the new solve is still running.
  const layoutSignature = `${orientation}\u0001${signature}`

  const [laidOut, setLaidOut] = useState<LayoutState | null>(null)
  const [error, setError] = useState<unknown>(null)
  const runIdRef = useRef(0)

  useEffect(() => {
    // An empty model needs no solver run; the derived result below already
    // describes it. Returning here also keeps this effect free of a synchronous
    // `setState`, which would cost a cascading render on every refetch.
    if (visible.nodes.length === 0) return

    const runId = runIdRef.current + 1
    runIdRef.current = runId

    let cancelled = false
    void layoutArchitecture(visible.nodes, visible.edges, {
      direction: elkDirectionForOrientation(orientation),
    })
      .then((layout) => {
        if (cancelled || runIdRef.current !== runId) return
        setLaidOut({ signature: layoutSignature, nodes: layout.nodes, routes: layout.routes })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled || runIdRef.current !== runId) return
        setError(cause)
      })

    return () => {
      cancelled = true
    }
    // `signature` is derived from `visible`; both are listed so a graph that is
    // structurally identical after a refetch does not re-run ELK.
  }, [visible, layoutSignature, orientation])

  // The edges always come from the current projection — an incoming update must
  // show up immediately, even if its layout is still being computed. Only the
  // node positions wait for ELK.
  return useMemo<ArchitectureGraph>(() => {
    const isEmpty = visible.nodes.length === 0
    const isCurrent = laidOut !== null && laidOut.signature === layoutSignature
    // Keep the last layout's positions while ELK solves the new structure, but
    // do not keep its data. A removal can turn an applied node into a ghost
    // without changing its id, and the overlay state must be visible in that
    // first render (the metrics below are already derived from `visible`).
    // `withCurrentData` intentionally matches only ids that are still drawn;
    // genuinely new proposal nodes wait for their first valid layout.
    const nodesWithCurrentData =
      laidOut === null ? [] : withCurrentData(laidOut.nodes, visible.nodes)

    return {
      nodes: isEmpty ? [] : nodesWithCurrentData,
      edges: visible.edges,
      routes: isCurrent ? laidOut.routes : {},
      diagnostics: projection.diagnostics ?? EMPTY_DIAGNOSTICS,
      isInitialLayout: !isEmpty && laidOut === null,
      isRelayouting: !isEmpty && !isCurrent,
      error,
      signature: layoutSignature,
      // Counted on the *reported* model, not on what is open: a collapsed
      // container hides components, it does not remove them, and the pane's
      // "28 Komponenten" must keep saying 28.
      appliedNodeCount: projection.appliedNodeCount,
      overlayNodeCount: projection.overlayNodeCount,
      appliedEdgeCount: projection.appliedEdgeCount,
      overlayEdgeCount: projection.overlayEdgeCount,
      collapsedIds: [...visible.collapsedComponentIds].sort(),
      requestedCollapsedIds,
      initialCollapsedIds: initialCollapsedIds(projection.nodes),
      hiddenComponentIds: visible.hiddenComponentIds,
      visibleNodeCount: visible.nodes.length,
      visibleEdgeCount: visible.edges.length,
      reportedRelationshipCount,
      ancestorsOf: (componentId) => ancestorIds(projection.nodes, componentId),
    }
  }, [laidOut, projection, visible, layoutSignature, error, reportedRelationshipCount, requestedCollapsedIds])
}

/**
 * Puts the current node data on the laid-out nodes.
 *
 * A work state changes far more often than the structure does — a planned
 * change becomes active, an active one becomes applied — and none of that moves
 * a node: `projectionSignature` covers ids, nesting and sizes only, so ELK is
 * deliberately not re-run for it. The positions therefore stay the ones from the
 * last layout while the data comes from the current projection. Without this
 * step a state change would be invisible until something structural happened to
 * force a new layout.
 */
function withCurrentData(
  laidOut: readonly ArchitectureNode[],
  current: readonly ArchitectureNode[],
): ArchitectureNode[] {
  const dataById = new Map(current.map((node) => [node.id, node.data]))
  return laidOut.map((node) => {
    const data = dataById.get(node.id)
    return data === undefined || data === node.data ? node : { ...node, data }
  })
}

interface LayoutState {
  signature: string
  nodes: ArchitectureNode[]
  routes: EdgeRoutes
}

/**
 * Applies the temporary drag positions and the current selection to the laid-out
 * nodes.
 *
 * Pure on purpose. It is the boundary between the two kinds of state: the
 * argument `nodes` is derived from the server model, `positions` is local UI
 * state, and the result exists only for rendering. Nothing here writes back —
 * a dragged node moves on screen and nowhere else, so a refetch of the
 * architecture can never mistake a drag for a reported change.
 */
export function applyTemporaryPositions(
  nodes: readonly ArchitectureNode[],
  positions: TemporaryPositions,
  selectedComponentId: ComponentId | null,
): ArchitectureNode[] {
  const hasPositions = Object.keys(positions).length > 0
  if (!hasPositions && selectedComponentId === null) {
    return nodes as ArchitectureNode[]
  }

  return nodes.map((node) => {
    const dragged = positions[node.id]
    const selected = node.id === selectedComponentId
    if (!dragged && !selected) return node
    return {
      ...node,
      ...(dragged ? { position: { x: dragged.x, y: dragged.y } } : {}),
      selected,
    }
  })
}

/**
 * Ids of the edges whose ELK route is no longer valid because one of their
 * endpoints was dragged away from where the layout put it.
 */
export function routesInvalidatedByDrag(
  edges: readonly ArchitectureEdge[],
  positions: TemporaryPositions,
): Set<string> {
  const moved = new Set(Object.keys(positions))
  if (moved.size === 0) return new Set()
  const invalid = new Set<string>()
  for (const edge of edges) {
    if (moved.has(edge.source) || moved.has(edge.target)) invalid.add(edge.id)
  }
  return invalid
}
