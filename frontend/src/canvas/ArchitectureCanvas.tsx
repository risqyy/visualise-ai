import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  useReactFlow,
  useStore,
  useStoreApi,
  type NodeMouseHandler,
  type OnNodeDrag,
  type Viewport,
} from '@xyflow/react'
import { Layers2, Map, MapPinOff, Maximize2, RotateCcw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import '@xyflow/react/dist/style.css'

import type { ComponentId, ProjectId } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUiStore } from '@/state/uiStore'

import { EdgeMarkerDefs } from './RelationshipEdge'
import {
  INITIAL_CAMERA_POLICY,
  onLayoutReady,
  onProjectChanged,
  onUserFitRequest,
  viewportForBounds,
  type CameraPolicyState,
} from './cameraPolicy'
import {
  DETAIL_LEVEL_DESCRIPTIONS,
  DETAIL_LEVEL_LABELS,
  DISCLOSURE_LABELS,
  MIN_READABLE_ZOOM,
  detailLevelForZoom,
} from './detailLevel'
import { ARCHITECTURE_EDGE_TYPES, ARCHITECTURE_NODE_TYPES } from './flowRegistry'
import {
  COMPOUND_NODE_TYPE,
  diagnosticsCount,
  type ArchitectureEdge,
  type ArchitectureModel,
} from './graphProjection'
import { CanvasNodeActionsContext, type CanvasNodeActions } from './nodeActions'
import {
  applyTemporaryPositions,
  routesInvalidatedByDrag,
  useArchitectureGraph,
} from './useArchitectureGraph'

/**
 * The interactive architecture canvas.
 *
 * Everything structural happens elsewhere — `graphProjection` builds the graph,
 * `elkLayout` places it, `cameraPolicy` decides when the camera may move. This
 * component wires those to React Flow and owns exactly three interaction rules:
 *
 * 1. **Selecting a component is a URL change**, not canvas state. Clicking a
 *    node calls back into the route, which sets the `component` search param and
 *    with it the inspector context. The canvas reads the selection back from
 *    there, so a deep link and a click produce the same state.
 * 2. **Dragging is temporary and local.** `onNodeDragStop` writes into the UI
 *    store and nowhere else. The architecture read model is what the agent
 *    reported; it is not the user's to edit, and a refetch must not be able to
 *    pick a drag up as a domain change.
 * 3. **The camera is the user's.** `fitView` runs on the first model of a
 *    project and on an explicit click, never because data arrived.
 * 4. **The first picture is readable.** The automatic camera never goes below
 *    `MIN_READABLE_ZOOM`, and a project opens on its top levels with deeper
 *    containers collapsed (`collapse.ts`). Both are undone by an explicit
 *    "Gesamtes Modell einpassen", never by anything the data does.
 */

const MIN_ZOOM = 0.12
const MAX_ZOOM = 2.5

const NODE_TYPES = ARCHITECTURE_NODE_TYPES
const EDGE_TYPES = ARCHITECTURE_EDGE_TYPES

/**
 * Why the camera is being moved.
 *
 * `initial` is the one movement the user did not ask for, so it is the one that
 * has to stay readable; `user` is an explicit request for the whole model and
 * may zoom out as far as the model needs.
 */
type FitMode = 'initial' | 'user'

export interface ArchitectureCanvasProps {
  projectId: ProjectId
  model: ArchitectureModel
  selectedComponentId?: ComponentId | undefined
  onSelectComponent: (componentId: ComponentId | null) => void
}

export function ArchitectureCanvas(props: ArchitectureCanvasProps) {
  return (
    <ReactFlowProvider>
      <ArchitectureCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function ArchitectureCanvasInner({
  projectId,
  model,
  selectedComponentId,
  onSelectComponent,
}: ArchitectureCanvasProps) {
  const collapsedComponentIds = useUiStore((state) => state.collapsedComponentIds)
  const setCollapsedComponentIds = useUiStore((state) => state.setCollapsedComponentIds)
  const setComponentCollapsed = useUiStore((state) => state.setComponentCollapsed)

  const graph = useArchitectureGraph(model, {
    collapsedComponentIds,
    // A deep link is a statement about *what to look at*. Opening the
    // containers on the way to it changes what is drawn, not where the camera
    // is — so a link into a component four levels down arrives, and the camera
    // policy is untouched by it.
    revealComponentId: selectedComponentId ?? null,
  })
  const flow = useReactFlow()
  const storeApi = useStoreApi()

  const camera = useUiStore((state) => state.camera)
  const setCamera = useUiStore((state) => state.setCamera)
  const nodePositions = useUiStore((state) => state.nodePositions)
  const setNodePosition = useUiStore((state) => state.setNodePosition)
  const clearNodePositions = useUiStore((state) => state.clearNodePositions)
  const minimapVisible = useUiStore((state) => state.minimapVisible)
  const setMinimapVisible = useUiStore((state) => state.setMinimapVisible)
  const clearExpandedEdges = useUiStore((state) => state.clearExpandedEdges)

  // The size of the drawing surface, as React Flow measures it. Subscribing
  // here is what lets the initial fit wait for the three panes to settle
  // instead of fitting against a pane that has not measured itself yet.
  const surfaceWidth = useStore((state) => state.width)
  const surfaceHeight = useStore((state) => state.height)

  const [detailLevel, setDetailLevel] = useState(() => detailLevelForZoom(camera.zoom))
  const [fitViewCount, setFitViewCount] = useState(0)
  const policyRef = useRef<CameraPolicyState>(INITIAL_CAMERA_POLICY)
  // Flipped by the first pan or zoom that came from a real input event. From
  // then on the camera is the user's and nothing but "Einpassen" touches it.
  const userMovedCameraRef = useRef(false)
  // The very first viewport React Flow renders with. Read once so a later
  // camera change never re-mounts the flow.
  const [initialViewport] = useState<Viewport>(() => useUiStore.getState().camera)

  const nodes = useMemo(
    () =>
      applyTemporaryPositions(graph.nodes, nodePositions, selectedComponentId ?? null),
    [graph.nodes, nodePositions, selectedComponentId],
  )
  /**
   * Puts the currently drawn graph under the camera.
   *
   * The viewport is computed and applied explicitly instead of going through
   * `instance.fitView()`: that call schedules itself through React Flow's node
   * change queue, which a fully controlled graph without `onNodesChange` never
   * drains. Computing it here also makes the result a pure function of the ELK
   * layout — the same model always ends up under the same camera.
   *
   * The two modes are the whole readability rule. `initial` may not zoom below
   * `MIN_READABLE_ZOOM`, anchors an oversized model at its top-left corner and
   * keeps `focusComponentId` on screen; `user` fits whatever is there, however
   * small that turns out, because the user asked for the overview.
   */
  const fitView = useCallback(
    (mode: FitMode, focusComponentId: ComponentId | null = null) => {
      setFitViewCount((count) => count + 1)

      const { width, height, nodeLookup } = storeApi.getState()
      if (nodeLookup.size === 0) return

      const bounds = getNodesBounds([...nodeLookup.values()], { nodeLookup })
      if (width <= 0 || height <= 0 || bounds.width <= 0 || bounds.height <= 0) return

      // The absolute box of the node the URL points at. `getNodesBounds` is what
      // resolves a nested node's parent-relative position for us, so the focus
      // arrives in the same coordinates as the model bounds.
      const focusNode = focusComponentId === null ? undefined : nodeLookup.get(focusComponentId)
      const focus = focusNode ? getNodesBounds([focusNode], { nodeLookup }) : null

      const viewport = viewportForBounds(
        bounds,
        { width, height },
        mode === 'initial'
          ? { minZoom: MIN_READABLE_ZOOM, overflow: 'start', focus }
          : { minZoom: MIN_ZOOM },
      )
      void flow.setViewport(viewport)
      setCamera(viewport)
      setDetailLevel(detailLevelForZoom(viewport.zoom))
    },
    [flow, storeApi, setCamera],
  )

  /**
   * A fit the user asked for, held until the layout it is about exists.
   *
   * Expanding or collapsing containers changes the ELK input, so at the moment
   * of the click the bounds the camera needs have not been computed yet. A ref
   * rather than state: the parked request changes nothing on screen, and the
   * effect that redeems it already re-runs when the new layout lands.
   */
  const pendingFitRef = useRef<{ mode: FitMode; focusComponentId: ComponentId | null } | null>(
    null,
  )

  /** Fits now if the graph is already the right one, otherwise after re-layout. */
  const requestFit = useCallback(
    (mode: FitMode, afterRelayout: boolean) => {
      // "Systemebene" reproduces the entry picture, and the entry picture keeps
      // the selected component on screen. The whole-model overview does not: it
      // is about the model, not about one component of it.
      const focusComponentId =
        mode === 'initial' ? (selectedComponentId ?? null) : null
      if (afterRelayout) {
        pendingFitRef.current = { mode, focusComponentId }
        return
      }
      policyRef.current = onUserFitRequest(policyRef.current).state
      fitView(mode, focusComponentId)
    },
    [fitView, selectedComponentId],
  )

  // Switching projects makes the next model an initial one again — including
  // its disclosure: the containers the user opened in project A say nothing
  // about project B. Only a real *change* resets it; a remount of the canvas
  // must not throw away what the user opened.
  const disclosedProjectRef = useRef<ProjectId | null>(null)
  useEffect(() => {
    policyRef.current = onProjectChanged(policyRef.current, projectId)
    clearExpandedEdges()
    if (disclosedProjectRef.current !== null && disclosedProjectRef.current !== projectId) {
      setCollapsedComponentIds(null)
    }
    disclosedProjectRef.current = projectId
  }, [projectId, clearExpandedEdges, setCollapsedComponentIds])

  // The only automatic camera movement in the whole cockpit: the first laid-out
  // model of a project, plus a resize of the surface while it is still settling
  // and the user has not taken the camera over. Every later layout — an added
  // component, a removed relationship, a replacing snapshot — returns `null`
  // here and leaves zoom, pan and selection exactly where the user left them.
  //
  // `selectedComponentId` is an *input* to that one movement, not a trigger for
  // a second one. A deep link says which component the picture is about, and
  // the first picture is the only one nobody has taken over yet; honouring it
  // there costs no extra fit. It is in the dependency list because a later
  // selection change must run the policy again and be told `null` — which is
  // exactly the assertion that a click never moves the camera.
  useEffect(() => {
    const decision = onLayoutReady(policyRef.current, {
      projectId,
      hasLayout: graph.nodes.length > 0,
      viewport: { width: surfaceWidth, height: surfaceHeight },
      userMovedCamera: userMovedCameraRef.current,
    })
    policyRef.current = decision.state
    if (decision.fit === null) return
    fitView('initial', selectedComponentId ?? null)
  }, [
    projectId,
    graph.nodes.length,
    surfaceWidth,
    surfaceHeight,
    selectedComponentId,
    fitView,
  ])

  // The initial disclosure, written down once it has been applied.
  //
  // Until this runs the collapsed set is a *derivation* (`initialCollapsedIds`
  // minus the path to a deep-linked component), and a derivation cannot be
  // toggled: opening one container would have to know which others were closed.
  // Materialising it makes every later expand and collapse a plain edit of an
  // explicit list. It writes the set the canvas is already showing, so it
  // changes no picture and triggers no re-layout.
  useEffect(() => {
    if (collapsedComponentIds !== null || graph.nodes.length === 0) return
    setCollapsedComponentIds(graph.collapsedIds)
  }, [collapsedComponentIds, graph.nodes.length, graph.collapsedIds, setCollapsedComponentIds])

  // Redeems a parked fit once the layout it was asked about has landed. It goes
  // through `onUserFitRequest`, so it stays an explicit movement and never
  // becomes a second automatic one.
  useEffect(() => {
    const pending = pendingFitRef.current
    if (pending === null || graph.isRelayouting || graph.nodes.length === 0) return
    pendingFitRef.current = null
    policyRef.current = onUserFitRequest(policyRef.current).state
    fitView(pending.mode, pending.focusComponentId)
  }, [graph.isRelayouting, graph.nodes.length, graph.signature, fitView])

  const edges = useMemo<ArchitectureEdge[]>(() => {
    const invalidated = routesInvalidatedByDrag(graph.edges, nodePositions)
    return graph.edges.map((edge) => {
      const route = invalidated.has(edge.id) ? undefined : graph.routes[edge.id]
      if (!edge.data) return edge
      return { ...edge, data: { ...edge.data, ...(route ? { route } : {}) } }
    })
  }, [graph.edges, graph.routes, nodePositions])

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      onSelectComponent(node.id === selectedComponentId ? null : node.id)
    },
    [onSelectComponent, selectedComponentId],
  )

  // Temporary, local, never persisted and never sent anywhere.
  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) => {
      setNodePosition(node.id, { x: node.position.x, y: node.position.y })
    },
    [setNodePosition],
  )

  // React Flow passes `null` for a programmatic move and the real input event
  // for a user one — which is exactly the distinction the camera policy needs.
  const onMoveStart = useCallback((event: unknown) => {
    if (event !== null && event !== undefined) userMovedCameraRef.current = true
  }, [])

  const onMove = useCallback(
    (_event: unknown, viewport: Viewport) => {
      setDetailLevel(detailLevelForZoom(viewport.zoom))
    },
    [],
  )

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      setCamera(viewport)
      setDetailLevel(detailLevelForZoom(viewport.zoom))
    },
    [setCamera],
  )

  /**
   * Opens or closes one container.
   *
   * Closing one that holds the current selection moves the selection up to it.
   * The selection lives in the URL and drives the inspector, so leaving it on a
   * component that is no longer drawn would put the three out of step — and
   * re-opening the container just to keep a hidden selection alive would make
   * the collapse impossible.
   */
  const onToggleCollapsed = useCallback<CanvasNodeActions['toggleCollapsed']>(
    (componentId, collapsed) => {
      if (
        collapsed &&
        selectedComponentId !== undefined &&
        selectedComponentId !== componentId &&
        graph.ancestorsOf(selectedComponentId).includes(componentId)
      ) {
        onSelectComponent(componentId)
      }
      setComponentCollapsed(componentId, collapsed)
    },
    [graph, selectedComponentId, onSelectComponent, setComponentCollapsed],
  )

  const nodeActions = useMemo<CanvasNodeActions>(
    () => ({ toggleCollapsed: onToggleCollapsed }),
    [onToggleCollapsed],
  )

  /** "Gesamtes Modell einpassen": everything open, everything on screen. */
  const onShowWholeModel = useCallback(() => {
    const willRelayout = graph.collapsedIds.length > 0
    if (willRelayout) setCollapsedComponentIds([])
    requestFit('user', willRelayout)
  }, [graph.collapsedIds.length, requestFit, setCollapsedComponentIds])

  /** Back to the picture the project opened with. */
  const onBackToOverview = useCallback(() => {
    const target = graph.initialCollapsedIds
    const willRelayout =
      target.length !== graph.collapsedIds.length ||
      target.some((componentId, index) => graph.collapsedIds[index] !== componentId)
    if (willRelayout) setCollapsedComponentIds(target)
    requestFit('initial', willRelayout)
  }, [graph.initialCollapsedIds, graph.collapsedIds, requestFit, setCollapsedComponentIds])

  const hasTemporaryPositions = Object.keys(nodePositions).length > 0
  const problemCount = diagnosticsCount(graph.diagnostics)
  const hiddenCount = graph.hiddenComponentIds.size

  // The applied model and the overlay are counted separately on purpose: a
  // planned change must become visible on the canvas **without** changing what
  // the applied model contains, and these two numbers are how that stays
  // checkable from the outside.
  return (
    <div
      className="relative h-full w-full min-w-0"
      data-testid="architecture-canvas"
      data-fit-view-count={fitViewCount}
      data-detail-level={detailLevel}
      data-node-count={graph.appliedNodeCount}
      data-edge-count={graph.appliedEdgeCount}
      data-overlay-node-count={graph.overlayNodeCount}
      data-overlay-edge-count={graph.overlayEdgeCount}
      data-visible-node-count={graph.visibleNodeCount}
      data-hidden-node-count={hiddenCount}
      data-collapsed-count={graph.collapsedIds.length}
      // The surface the camera was computed against. Reported so "is this node
      // actually on screen" is answerable from outside without a layout engine.
      data-surface-width={surfaceWidth}
      data-surface-height={surfaceHeight}
      data-layouting={graph.isRelayouting ? 'true' : 'false'}
    >
      <EdgeMarkerDefs />
      <CanvasNodeActionsContext value={nodeActions}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultViewport={initialViewport}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          onMoveStart={onMoveStart}
          onMove={onMove}
          onMoveEnd={onMoveEnd}
          nodesDraggable
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
          // Selection is owned by the URL, so React Flow must not manage its own.
          selectNodesOnDrag={false}
          multiSelectionKeyCode={null}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: false }}
          attributionPosition="bottom-left"
          className="bg-canvas"
          aria-label="Interaktiver Architekturgraph"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={28}
            size={1}
            color="var(--canvas-grid)"
          />
          <Controls
            showInteractive={false}
            // The built-in fit control is replaced by "Einpassen" in the toolbar,
            // which goes through the camera policy instead of around it.
            showFitView={false}
            position="bottom-right"
            className="!border-border !bg-card/90 !shadow-none [&>button]:!border-border [&>button]:!bg-card [&>button]:!fill-current [&>button]:!text-foreground"
          />
          {minimapVisible && (
            <MiniMap
              position="top-right"
              pannable
              zoomable
              ariaLabel="Übersichtskarte der Architektur"
              className="!border-border !bg-card/80 !m-2 !rounded-md !border"
              style={{ width: 168, height: 112 }}
              maskColor="color-mix(in oklab, var(--background) 72%, transparent)"
              nodeColor={(node) =>
                node.type === COMPOUND_NODE_TYPE
                  ? 'var(--graphite-700)'
                  : 'var(--graphite-400)'
              }
              nodeStrokeWidth={0}
            />
          )}

          <Panel position="top-left" className="!m-2">
            {/* Wraps rather than overflows: the centre pane can be resized down
                to a few hundred pixels, and a toolbar that runs past its edge
                takes its own controls out of reach. */}
            <div className="border-border bg-card/90 flex max-w-[min(100%,44rem)] flex-wrap items-center gap-1 rounded-md border px-1 py-1 backdrop-blur-sm">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={onShowWholeModel}
                    data-testid="canvas-fit-view"
                  >
                    <Maximize2 aria-hidden="true" />
                    {DISCLOSURE_LABELS.fitWholeModel}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-80">
                  {DISCLOSURE_LABELS.fitWholeModelHint} Die Kamera bewegt sich sonst nur beim
                  ersten Laden — nie durch eintreffende Ereignisse.
                </TooltipContent>
              </Tooltip>

              {graph.initialCollapsedIds.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs"
                      onClick={onBackToOverview}
                      data-testid="canvas-back-to-overview"
                    >
                      <Layers2 aria-hidden="true" />
                      {DISCLOSURE_LABELS.backToOverview}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    {DISCLOSURE_LABELS.backToOverviewHint}
                  </TooltipContent>
                </Tooltip>
              )}

              {hasTemporaryPositions && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 px-2 text-xs"
                      onClick={clearNodePositions}
                      data-testid="canvas-reset-positions"
                    >
                      <RotateCcw aria-hidden="true" />
                      Positionen zurücksetzen
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Verschobene Knoten zurück auf das berechnete Layout. Verschiebungen sind
                    ohnehin nur lokal und ändern das Architekturmodell nicht.
                  </TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setMinimapVisible(!minimapVisible)}
                    aria-pressed={minimapVisible}
                    data-testid="canvas-toggle-minimap"
                  >
                    {minimapVisible ? (
                      <Map aria-hidden="true" />
                    ) : (
                      <MapPinOff aria-hidden="true" />
                    )}
                    <span className="sr-only">
                      Übersichtskarte {minimapVisible ? 'ausblenden' : 'einblenden'}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Übersichtskarte {minimapVisible ? 'ausblenden' : 'einblenden'}
                </TooltipContent>
              </Tooltip>

              <span className="bg-border mx-0.5 h-4 w-px" aria-hidden="true" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="text-muted-foreground px-1 text-[11px] whitespace-nowrap"
                    data-testid="canvas-detail-level"
                  >
                    Detailstufe: {DETAIL_LEVEL_LABELS[detailLevel]}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{DETAIL_LEVEL_DESCRIPTIONS[detailLevel]}</TooltipContent>
              </Tooltip>

              {hiddenCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="text-muted-foreground px-1 text-[11px] whitespace-nowrap"
                      data-testid="canvas-visibility"
                    >
                      {DISCLOSURE_LABELS.visibility(
                        graph.visibleNodeCount,
                        graph.visibleNodeCount + hiddenCount,
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    {DISCLOSURE_LABELS.visibilityHint}
                  </TooltipContent>
                </Tooltip>
              )}

              {problemCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="text-state-planned flex items-center gap-1 px-1 text-[11px]"
                      data-testid="canvas-diagnostics"
                    >
                      <TriangleAlert className="size-3.5" aria-hidden="true" />
                      {problemCount} unstimmige Angaben
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    <DiagnosticsSummary graph={graph} />
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </Panel>

          {graph.isRelayouting && (
            <Panel position="top-center" className="!m-2">
              <span
                className="border-border bg-card/90 text-muted-foreground rounded-md border px-2 py-1 text-[11px]"
                role="status"
                data-testid="canvas-layouting"
              >
                Layout wird berechnet…
              </span>
            </Panel>
          )}
        </ReactFlow>
      </CanvasNodeActionsContext>
    </div>
  )
}

function DiagnosticsSummary({
  graph,
}: {
  graph: ReturnType<typeof useArchitectureGraph>
}) {
  const { diagnostics } = graph
  const lines: string[] = []
  if (diagnostics.orphanedParents.length > 0) {
    lines.push(
      `${diagnostics.orphanedParents.length} Komponente(n) verweisen auf ein Elternteil, das nicht Teil des Snapshots ist. Sie werden als eigenständige Wurzeln gezeigt.`,
    )
  }
  if (diagnostics.hierarchyCycles.length > 0) {
    lines.push(
      `${diagnostics.hierarchyCycles.length} Zyklus/Zyklen in der Hierarchie. Der jeweils erste Knoten wurde gelöst, damit die Struktur darstellbar bleibt.`,
    )
  }
  if (diagnostics.danglingRelationships.length > 0) {
    lines.push(
      `${diagnostics.danglingRelationships.length} Beziehung(en) zeigen auf eine Komponente außerhalb des Snapshots und werden nicht gezeichnet.`,
    )
  }
  if (diagnostics.duplicateComponentIds.length > 0) {
    lines.push(
      `${diagnostics.duplicateComponentIds.length} doppelte Komponenten-ID(s); jeweils die erste Meldung wird gezeigt.`,
    )
  }
  if (diagnostics.duplicateRelationshipIds.length > 0) {
    lines.push(
      `${diagnostics.duplicateRelationshipIds.length} doppelte Beziehungs-ID(s); jeweils die erste Meldung wird gezeigt.`,
    )
  }
  return (
    <ul className="space-y-1 text-xs">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

