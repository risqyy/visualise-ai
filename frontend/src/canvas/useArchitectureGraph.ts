import { useEffect, useMemo, useRef, useState } from 'react'

import type { ComponentId } from '@/api/types'

import { layoutArchitecture, type EdgeRoutes } from './elkLayout'
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
}

const EMPTY_MODEL: ArchitectureModel = { components: [], relationships: [] }

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
): ArchitectureGraph {
  const projection = useMemo(
    () => projectArchitecture(model ?? EMPTY_MODEL),
    [model],
  )
  const signature = useMemo(() => projectionSignature(projection), [projection])

  const [laidOut, setLaidOut] = useState<LayoutState | null>(null)
  const [error, setError] = useState<unknown>(null)
  const runIdRef = useRef(0)

  useEffect(() => {
    // An empty model needs no solver run; the derived result below already
    // describes it. Returning here also keeps this effect free of a synchronous
    // `setState`, which would cost a cascading render on every refetch.
    if (projection.nodes.length === 0) return

    const runId = runIdRef.current + 1
    runIdRef.current = runId

    let cancelled = false
    void layoutArchitecture(projection.nodes, projection.edges)
      .then((layout) => {
        if (cancelled || runIdRef.current !== runId) return
        setLaidOut({ signature, nodes: layout.nodes, routes: layout.routes })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled || runIdRef.current !== runId) return
        setError(cause)
      })

    return () => {
      cancelled = true
    }
    // `signature` is derived from `projection`; both are listed so a projection
    // that is structurally identical after a refetch does not re-run ELK.
  }, [projection, signature])

  // The edges always come from the current projection — an incoming update must
  // show up immediately, even if its layout is still being computed. Only the
  // node positions wait for ELK.
  return useMemo<ArchitectureGraph>(() => {
    const isEmpty = projection.nodes.length === 0
    const isCurrent = laidOut !== null && laidOut.signature === signature

    return {
      nodes: isEmpty ? [] : isCurrent ? laidOut.nodes : (laidOut?.nodes ?? []),
      edges: projection.edges,
      routes: isCurrent ? laidOut.routes : {},
      diagnostics: projection.diagnostics ?? EMPTY_DIAGNOSTICS,
      isInitialLayout: !isEmpty && laidOut === null,
      isRelayouting: !isEmpty && !isCurrent,
      error,
      signature,
    }
  }, [laidOut, projection, signature, error])
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
