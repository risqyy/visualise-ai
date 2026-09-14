import type { Component, Relationship, SavedView } from '@/api/types'
import { getNodesBounds } from '@xyflow/react'
import { collapseGraph } from '@/canvas/collapse'
import { viewportForBounds } from '@/canvas/cameraPolicy'
import { MIN_READABLE_ZOOM, type DetailLevel } from '@/canvas/detailLevel'
import { staggeredLabelRatios } from '@/canvas/edgeGeometry'
import { placeEdgeLabels } from '@/canvas/edgeLabelLayout'
import { layoutArchitecture } from '@/canvas/elkLayout'
import { elkDirectionForOrientation } from '@/canvas/graphOrientation'
import { projectArchitecture } from '@/canvas/graphProjection'
import { resolveArchitectureView } from '@/views/resolveArchitectureView'

export interface Snapshot {
  model: { components: Component[]; relationships: Relationship[] }
  view: SavedView
  viewRevision: number
}
export interface Settings {
  viewport: { width: number; height: number; pixelRatio: 1 | 2 }
  detailLevel: 'map' | 'readable' | 'standard' | 'full'
}
export const DETAILS: Record<Settings['detailLevel'], DetailLevel> = {
  map: 'minimal', readable: 'overview', standard: 'standard', full: 'full',
}

/** Exactly the pure pipeline used by the interactive native canvas. */
export async function prepare(snapshot: Snapshot, settings: Settings) {
  const resolved = resolveArchitectureView(snapshot.model, snapshot.view)
  const orientation = snapshot.view.orientation === 'left-to-right' ? 'left-right' : 'top-down'
  const projected = projectArchitecture(resolved.model, orientation)
  const collapsed = collapseGraph(projected.nodes, projected.edges, resolved.collapsedComponentIds, orientation)
  const layout = await layoutArchitecture(collapsed.nodes, collapsed.edges, { direction: elkDirectionForOrientation(orientation) })
  const routed = collapsed.edges.map((edge) => ({
    ...edge,
    data: { ...edge.data!, ...(layout.routes[edge.id] ? { route: layout.routes[edge.id] } : {}) },
  }))
  const labelRatios = staggeredLabelRatios(routed.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, ...(edge.data.route ? { route: edge.data.route } : {}),
  })))
  const positioned = routed.map((edge) => ({
    ...edge, data: { ...edge.data, labelRatio: labelRatios.get(edge.id) ?? 0.5 },
  }))
  const viewport = layout.nodes.length === 0 ? { x: 0, y: 0, zoom: 1 } : viewportForBounds(
    getNodesBounds(layout.nodes.filter((node) => !node.parentId)), settings.viewport,
    { minZoom: MIN_READABLE_ZOOM, overflow: 'start' },
  )
  const labelPositions = placeEdgeLabels(positioned, layout.nodes, {
    detailLevel: DETAILS[settings.detailLevel], zoom: viewport.zoom,
    expandedEdgeIds: settings.detailLevel === 'full' ? positioned.map((edge) => edge.id) : [],
  })
  const edges = positioned.map((edge) => ({
    ...edge, data: { ...edge.data, labelPositions: labelPositions.get(edge.id) ?? {}, bundleExpanded: settings.detailLevel === 'full' },
  }))
  return { nodes: layout.nodes, edges, viewport, resolved }
}
export type Prepared = Awaited<ReturnType<typeof prepare>>
