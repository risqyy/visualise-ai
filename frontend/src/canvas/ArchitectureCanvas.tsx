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
import type { TFunction } from 'i18next'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

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
  canvasAriaLabelConfig,
  componentNamesById,
  withEdgeAccessibility,
  withNodeAccessibility,
} from './canvasAccessibility'
import {
  DETAIL_LEVEL_DESCRIPTION_KEYS,
  DETAIL_LEVEL_LABEL_KEYS,
  DISCLOSURE_LABEL_KEYS,
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
import { useCanvasVoice } from './useCanvasVoice'

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
 *
 * The accessible surface — names, roles and states of the nodes and edges —
 * lives in `./canvasAccessibility`; this component only wires it up, owns the
 * keyboard activation and publishes the live zoom so the focus ring can stay a
 * constant width inside the CSS transform (see `--vai-canvas-zoom`).
 */

const MIN_ZOOM = 0.12
const MAX_ZOOM = 2.5

const NODE_TYPES = ARCHITECTURE_NODE_TYPES
const EDGE_TYPES = ARCHITECTURE_EDGE_TYPES

/**
 * Arrow keys reach React Flow's node handler, which announces "Moved selected
 * node …" over an aria-live region. Nothing moves: the graph is fully
 * controlled and has no `onNodesChange`, so the position change is dropped. The
 * canvas therefore stops the keys before that announcement can be made — a
 * screen reader must never be told about a change that did not happen.
 */
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/** Keys that activate the focused node or edge. */
const ACTIVATION_KEYS = new Set(['Enter', ' '])

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
  /** Reports the counts the canvas actually draws to the pane header. */
  onMetricsChange?: (metrics: ArchitectureCanvasMetrics) => void
}

export interface ArchitectureCanvasMetrics {
  appliedComponentCount: number
  overlayComponentCount: number
  visibleElementCount: number
  totalElementCount: number
  reportedRelationshipCount: number
  visibleConnectionCount: number
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
  onMetricsChange,
}: ArchitectureCanvasProps) {
  const { t } = useTranslation('canvas')
  // The words *and* the counted nouns the accessible names are built from —
  // `canvas:*` for the sentences (#42), `common:count.*` for the numbers (#40).
  // Stable per language, so it does not invalidate the label memos.
  const voice = useCanvasVoice()
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
  const toggleEdgeExpanded = useUiStore((state) => state.toggleEdgeExpanded)
  const selectedRelationshipId = useUiStore((state) => state.selectedRelationshipId)
  const setSelectedRelationshipId = useUiStore((state) => state.setSelectedRelationshipId)

  // The size of the drawing surface, as React Flow measures it. Subscribing
  // here is what lets the initial fit wait for the three panes to settle
  // instead of fitting against a pane that has not measured itself yet.
  const surfaceWidth = useStore((state) => state.width)
  const surfaceHeight = useStore((state) => state.height)

  const [detailLevel, setDetailLevel] = useState(() => detailLevelForZoom(camera.zoom))
  const [fitViewCount, setFitViewCount] = useState(0)
  const policyRef = useRef<CameraPolicyState>(INITIAL_CAMERA_POLICY)
  // The drawing surface itself. Used to publish the live zoom to CSS, nothing
  // else — the camera stays React Flow's.
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  // Id of the visually hidden description every screen reader gets when it
  // enters the graph.
  const instructionsId = `architecture-graph-instructions-${useId()}`
  // React Flow's own English a11y strings, replaced with the catalogue's. Not
  // only a translation: its defaults offer "press delete to remove it" and
  // "use the arrow keys to move the node around", and neither is true here.
  const ariaLabelConfig = useMemo(() => canvasAriaLabelConfig(t), [t])
  // Flipped by the first pan or zoom that came from a real input event. From
  // then on the camera is the user's and nothing but "Einpassen" touches it.
  const userMovedCameraRef = useRef(false)
  // The very first viewport React Flow renders with. Read once so a later
  // camera change never re-mounts the flow.
  const [initialViewport] = useState<Viewport>(() => useUiStore.getState().camera)

  // `graph.nodes` is already what `collapse.ts` left visible, so the accessible
  // names describe exactly the boxes that are drawn — a component behind a
  // closed container is not a tab stop and is not named as one.
  const nodes = useMemo(
    () =>
      withNodeAccessibility(
        applyTemporaryPositions(graph.nodes, nodePositions, selectedComponentId ?? null),
        voice,
      ),
    [graph.nodes, nodePositions, selectedComponentId, voice],
  )

  /**
   * Publishes the live zoom as a CSS custom property on the surface.
   *
   * The canvas draws inside a CSS transform, so every length inside it is
   * multiplied by the zoom: a 2 px focus ring is 0.4 px at zoom 0.2, which is
   * no ring at all. The stylesheet divides the ring width by this value, which
   * makes the rendered ring the same number of CSS pixels at every zoom level.
   *
   * Written imperatively on purpose. The wrapper carries no `style` prop, so
   * React never overwrites the property, and publishing it does not cost a
   * render on every frame of a pan.
   */
  const publishZoom = useCallback((zoom: number) => {
    const surface = surfaceRef.current
    if (!surface) return
    const safe = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
    surface.style.setProperty('--vai-canvas-zoom', String(safe))
    surface.setAttribute('data-canvas-zoom', safe.toFixed(4))
  }, [])

  useLayoutEffect(() => {
    publishZoom(useUiStore.getState().camera.zoom)
  }, [publishZoom])

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
      publishZoom(viewport.zoom)
    },
    [flow, storeApi, setCamera, publishZoom],
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

  // Endpoint names for the edge labels. Derived from the laid-out graph rather
  // than from `nodes`, so a selection — which changes nothing an edge says —
  // does not rebuild every edge. `collapse.ts` lifts a hidden endpoint onto its
  // nearest *visible* ancestor, so every endpoint of every drawn edge is a node
  // of `graph.nodes` and no name can fall back to an id.
  const nodeNames = useMemo(() => componentNamesById(graph.nodes), [graph.nodes])

  const edges = useMemo<ArchitectureEdge[]>(() => {
    const invalidated = routesInvalidatedByDrag(graph.edges, nodePositions)
    const routed = graph.edges.map((edge) => {
      const route = invalidated.has(edge.id) ? undefined : graph.routes[edge.id]
      if (!edge.data) return edge
      return { ...edge, data: { ...edge.data, ...(route ? { route } : {}) } }
    })
    return withEdgeAccessibility(routed, nodeNames, voice)
  }, [graph.edges, graph.routes, nodePositions, nodeNames, voice])

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
      publishZoom(viewport.zoom)
    },
    [publishZoom],
  )

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      setCamera(viewport)
      setDetailLevel(detailLevelForZoom(viewport.zoom))
      publishZoom(viewport.zoom)
    },
    [setCamera, publishZoom],
  )

  /**
   * Keyboard activation of the focused node or edge.
   *
   * Handled in the **capture** phase, one level above React Flow, for two
   * reasons: it is the only place that runs before React Flow's own node and
   * edge key handling, and stopping the event there keeps the built-in
   * behaviour — an internal selection this fully controlled graph drops on the
   * floor, and an aria-live message about a move that never happens — from
   * running at all.
   *
   * What is left is exactly what the canvas really does: activating a component
   * writes the `component` search parameter, which is the same path a click
   * takes, so the URL, the selection and the inspector cannot drift apart.
   * Activating an edge unfolds a bundle or selects the single relationship —
   * the same two actions its badges offer to the mouse.
   *
   * A real control *inside* a node — the disclosure toggle of a container — is
   * left alone: it is its own tab stop with its own action, and a container
   * that could not be opened from the keyboard would be worse than an unnamed
   * one.
   */
  const onSurfaceKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const nodeElement = target.closest('.react-flow__node')
      if (nodeElement) {
        const control = target.closest('button, a[href], input, select, textarea')
        if (control !== null && nodeElement.contains(control)) return

        const componentId = nodeElement.getAttribute('data-id')
        if (componentId === null) return
        if (ACTIVATION_KEYS.has(event.key)) {
          event.preventDefault()
          event.stopPropagation()
          onSelectComponent(componentId === selectedComponentId ? null : componentId)
          return
        }
        if (event.key === 'Escape') {
          // Only the *selection* is taken back here. With nothing selected the
          // key travels on, so an Escape from a focused node can still leave
          // deep focus — one Escape per layer, none of them swallowed.
          if (selectedComponentId === undefined) return
          event.preventDefault()
          event.stopPropagation()
          onSelectComponent(null)
          return
        }
        // Swallowed, never announced. See ARROW_KEYS.
        if (ARROW_KEYS.has(event.key)) event.stopPropagation()
        return
      }

      const edgeElement = target.closest('.react-flow__edge')
      if (!edgeElement) return
      const edgeId = edgeElement.getAttribute('data-id')
      if (edgeId === null) return
      if (!ACTIVATION_KEYS.has(event.key) && event.key !== 'Escape') return
      if (event.key === 'Escape' && selectedRelationshipId === null) return

      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setSelectedRelationshipId(null)
        return
      }
      const edge = edges.find((candidate) => candidate.id === edgeId)
      const relationships = edge?.data?.relationships ?? []
      if (relationships.length > 1) {
        toggleEdgeExpanded(edgeId)
        return
      }
      const only = relationships[0]
      if (!only) return
      setSelectedRelationshipId(
        only.relationshipId === selectedRelationshipId ? null : only.relationshipId,
      )
    },
    [
      edges,
      onSelectComponent,
      selectedComponentId,
      selectedRelationshipId,
      setSelectedRelationshipId,
      toggleEdgeExpanded,
    ],
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

  const canvasMetrics = useMemo<ArchitectureCanvasMetrics>(
    () => ({
      appliedComponentCount: graph.appliedNodeCount,
      overlayComponentCount: graph.overlayNodeCount,
      visibleElementCount: graph.visibleNodeCount,
      totalElementCount: graph.appliedNodeCount + graph.overlayNodeCount,
      reportedRelationshipCount: graph.reportedRelationshipCount,
      visibleConnectionCount: graph.visibleEdgeCount,
    }),
    [
      graph.appliedNodeCount,
      graph.overlayNodeCount,
      graph.visibleNodeCount,
      graph.reportedRelationshipCount,
      graph.visibleEdgeCount,
    ],
  )

  // Publish before the browser paints. Collapse and overlay updates change the
  // visible connection count without necessarily changing the pane's model
  // counts, so a passive effect would briefly expose the previous number.
  useLayoutEffect(() => {
    onMetricsChange?.(canvasMetrics)
  }, [canvasMetrics, onMetricsChange])

  // The applied model and the overlay are counted separately on purpose: a
  // planned change must become visible on the canvas **without** changing what
  // the applied model contains, and these two numbers are how that stays
  // checkable from the outside.
  return (
    <div
      ref={surfaceRef}
      className="relative h-full w-full min-w-0"
      onKeyDownCapture={onSurfaceKeyDownCapture}
      data-testid="architecture-canvas"
      data-fit-view-count={fitViewCount}
      data-detail-level={detailLevel}
      data-node-count={graph.appliedNodeCount}
      data-edge-count={graph.appliedEdgeCount}
      data-overlay-node-count={graph.overlayNodeCount}
      data-overlay-edge-count={graph.overlayEdgeCount}
      data-visible-node-count={graph.visibleNodeCount}
      data-visible-connection-count={graph.visibleEdgeCount}
      data-reported-relationship-count={graph.reportedRelationshipCount}
      data-total-element-count={graph.appliedNodeCount + graph.overlayNodeCount}
      data-hidden-node-count={hiddenCount}
      data-collapsed-count={graph.collapsedIds.length}
      // The surface the camera was computed against. Reported so "is this node
      // actually on screen" is answerable from outside without a layout engine.
      data-surface-width={surfaceWidth}
      data-surface-height={surfaceHeight}
      data-layouting={graph.isRelayouting ? 'true' : 'false'}
    >
      <EdgeMarkerDefs />
      {/* Read out when a screen reader enters the graph: what is drawn here and
          how it is operated — including that it cannot be edited. */}
      <p id={instructionsId} className="sr-only" data-testid="canvas-instructions">
        {t('graph.instructions')}
      </p>
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
          // Keyboard focus may bring a node that sits outside the viewport into
          // view. That is a deliberate exception and the only one: it is
          // requested by the user's own Tab press, it keeps the zoom, and it is
          // not a `fitView` — `data-fit-view-count` does not move (ADR 0018).
          autoPanOnNodeFocus
          ariaLabelConfig={ariaLabelConfig}
          aria-label={t('graph.label')}
          aria-describedby={instructionsId}
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
              ariaLabel={t('graph.minimapLabel')}
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
                    {t(DISCLOSURE_LABEL_KEYS.fitWholeModel)}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-80">
                  {t(DISCLOSURE_LABEL_KEYS.fitWholeModelHint)}
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
                      {t(DISCLOSURE_LABEL_KEYS.backToOverview)}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    {t(DISCLOSURE_LABEL_KEYS.backToOverviewHint)}
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
                      {t('tool.resetPositions')}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('tool.resetPositionsHint')}</TooltipContent>
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
                      {t(minimapVisible ? 'tool.hideMinimap' : 'tool.showMinimap')}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t(minimapVisible ? 'tool.hideMinimap' : 'tool.showMinimap')}
                </TooltipContent>
              </Tooltip>

              <span className="bg-border mx-0.5 h-4 w-px" aria-hidden="true" />

              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="text-muted-foreground px-1 text-[11px] whitespace-nowrap"
                    data-testid="canvas-detail-level"
                  >
                    {t('detail.indicator', {
                      level: t(DETAIL_LEVEL_LABEL_KEYS[detailLevel]),
                    })}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t(DETAIL_LEVEL_DESCRIPTION_KEYS[detailLevel])}
                </TooltipContent>
              </Tooltip>

              {graph.appliedNodeCount + graph.overlayNodeCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="text-muted-foreground px-1 text-[11px] whitespace-nowrap"
                      data-testid="canvas-visibility"
                    >
                      {t(DISCLOSURE_LABEL_KEYS.visibility, {
                        visible: graph.visibleNodeCount,
                        total: graph.appliedNodeCount + graph.overlayNodeCount,
                        count: graph.appliedNodeCount + graph.overlayNodeCount,
                      })}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    {t(DISCLOSURE_LABEL_KEYS.visibilityHint)}
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
                      {t('diagnostics.summary', { count: problemCount })}
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
                {t('graph.layouting')}
              </span>
            </Panel>
          )}
        </ReactFlow>
      </CanvasNodeActionsContext>
    </div>
  )
}

/**
 * What the projection had to work around in the reported snapshot.
 *
 * Each line names a *count* of reported inconsistencies and what the canvas did
 * about it. Nothing here quotes a reported value, so every line is entirely the
 * cockpit's own sentence and comes from the catalogue.
 */
function DiagnosticsSummary({
  graph,
}: {
  graph: ReturnType<typeof useArchitectureGraph>
}) {
  const { t } = useTranslation('canvas')
  const { diagnostics } = graph
  const lines = diagnosticLines(diagnostics, t)

  return (
    <ul className="space-y-1 text-xs">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

function diagnosticLines(
  diagnostics: ReturnType<typeof useArchitectureGraph>['diagnostics'],
  t: TFunction<'canvas'>,
): string[] {
  const lines: string[] = []
  if (diagnostics.orphanedParents.length > 0) {
    lines.push(
      t('diagnostics.orphanedParents', { count: diagnostics.orphanedParents.length }),
    )
  }
  if (diagnostics.hierarchyCycles.length > 0) {
    lines.push(
      t('diagnostics.hierarchyCycles', { count: diagnostics.hierarchyCycles.length }),
    )
  }
  if (diagnostics.danglingRelationships.length > 0) {
    lines.push(
      t('diagnostics.danglingRelationships', {
        count: diagnostics.danglingRelationships.length,
      }),
    )
  }
  if (diagnostics.duplicateComponentIds.length > 0) {
    lines.push(
      t('diagnostics.duplicateComponentIds', {
        count: diagnostics.duplicateComponentIds.length,
      }),
    )
  }
  if (diagnostics.duplicateRelationshipIds.length > 0) {
    lines.push(
      t('diagnostics.duplicateRelationshipIds', {
        count: diagnostics.duplicateRelationshipIds.length,
      }),
    )
  }
  return lines
}
