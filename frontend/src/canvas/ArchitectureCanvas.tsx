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
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnNodeDrag,
  type Viewport,
} from '@xyflow/react'
import {
  Focus,
  Layers2,
  Map,
  MapPinOff,
  Maximize2,
  RotateCcw,
  Search,
  TriangleAlert,
} from 'lucide-react'
import type { TFunction } from 'i18next'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'

import '@xyflow/react/dist/style.css'

import type { ComponentId, Identifier, ProjectId } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUiStore } from '@/state/uiStore'
import { ReportedText } from '@/i18n'

import { EdgeMarkerDefs } from './RelationshipEdge'
import {
  INITIAL_CAMERA_POLICY,
  isBoundsFullyVisible,
  MIN_FIT_VIEWPORT,
  onLayoutReady,
  onProjectChanged,
  onUserFitRequest,
  viewportForFocus,
  viewportForBounds,
  type CameraPolicyState,
} from './cameraPolicy'
import {
  canvasAriaLabelConfig,
  componentNamesById,
  withEdgeAccessibility,
  withNodeAccessibility,
} from './canvasAccessibility'
import { componentKindLabel } from './componentKinds'
import { componentSearchEntries, searchComponentEntries } from './componentSearch'
import {
  DETAIL_LEVEL_DESCRIPTION_KEYS,
  DETAIL_LEVEL_LABEL_KEYS,
  DISCLOSURE_LABEL_KEYS,
  MIN_READABLE_ZOOM,
  detailLevelForZoom,
} from './detailLevel'
import { staggeredLabelRatios } from './edgeGeometry'
import { ARCHITECTURE_EDGE_TYPES, ARCHITECTURE_NODE_TYPES } from './flowRegistry'
import {
  COMPOUND_NODE_TYPE,
  diagnosticsCount,
  type ArchitectureEdge,
  type ArchitectureModel,
} from './graphProjection'
import type { GraphOrientation } from './graphOrientation'
import { CanvasNodeActionsContext, type CanvasNodeActions } from './nodeActions'
import {
  spatialNeighbor,
  toSpatialNodes,
  type SpatialDirection,
} from './spatialNavigation'
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
 * 4. **Keyboard focus is spatial.** Visible nodes share one roving Tab entry;
 *    arrow keys move focus through the actual layout and never move a node.
 * 5. **The first picture is readable.** The automatic camera never goes below
 *    `MIN_READABLE_ZOOM`, and a project opens on its top levels with deeper
 *    containers collapsed (`collapse.ts`). Both are undone by the explicit
 *    spatial "Gesamtkarte", never by anything the data does.
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
 * node …" over an aria-live region. This graph owns spatial focus instead, so
 * the canvas stops the keys before React Flow can move or announce a node.
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
  selectedRelationshipId?: Identifier | null | undefined
  onSelectComponent: (componentId: ComponentId | null) => void
  orientation: GraphOrientation
  onOrientationChange: (orientation: GraphOrientation) => void
  onSelectRelationship?: (relationshipId: Identifier | null) => void
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
  selectedRelationshipId,
  onSelectComponent,
  orientation,
  onOrientationChange,
  onMetricsChange,
  onSelectRelationship,
}: ArchitectureCanvasProps) {
  const { t } = useTranslation('canvas')
  // The words *and* the counted nouns the accessible names are built from —
  // `canvas:*` for the sentences (#42), `common:count.*` for the numbers (#40).
  // Stable per language, so it does not invalidate the label memos.
  const voice = useCanvasVoice()
  const collapsedComponentIds = useUiStore((state) => state.collapsedComponentIds)
  const setCollapsedComponentIds = useUiStore((state) => state.setCollapsedComponentIds)
  const setComponentCollapsed = useUiStore((state) => state.setComponentCollapsed)

  const relationshipRevealIds = useMemo(() => {
    if (!selectedRelationshipId) return [] as ComponentId[]
    const relationship = [
      ...model.relationships,
      ...(model.overlay?.extraRelationships ?? []).map((entry) => entry.relationship),
    ].find((entry) => entry.relationshipId === selectedRelationshipId)
    return relationship
      ? [relationship.sourceComponentId, relationship.targetComponentId]
      : []
  }, [model, selectedRelationshipId])

  const graph = useArchitectureGraph(model, {
    collapsedComponentIds,
    // A deep link is a statement about *what to look at*. Opening the
    // containers on the way to it changes what is drawn, not where the camera
    // is — so a link into a component four levels down arrives, and the camera
    // policy is untouched by it.
    revealComponentId: selectedComponentId ?? null,
    orientation,
    revealComponentIds: relationshipRevealIds,
  })
  const searchEntries = useMemo(
    () =>
      componentSearchEntries(
        model.components,
        model.overlay?.extraComponents.map((entry) => entry.component) ?? [],
      ),
    [model.components, model.overlay?.extraComponents],
  )
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  // The graph is a composite widget: one visible node owns the Tab entry and
  // arrow keys move focus spatially without changing the URL selection.
  const [focusedNodeId, setFocusedNodeId] = useState<ComponentId | null>(null)
  const graphHasNodeFocusRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null)
  const wasSearchOpenRef = useRef(false)
  const pendingFocusRef = useRef<ComponentId | null>(null)
  const invalidatePendingSearchFocus = useCallback(() => {
    pendingFocusRef.current = null
  }, [])
  const searchResults = useMemo(
    () => searchComponentEntries(searchEntries, searchQuery),
    [searchEntries, searchQuery],
  )
  const effectiveActiveSearchIndex =
    searchResults.length === 0 ? 0 : Math.min(activeSearchIndex, searchResults.length - 1)
  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
    } else if (wasSearchOpenRef.current) {
      searchTriggerRef.current?.focus()
    }
    wasSearchOpenRef.current = searchOpen
  }, [searchOpen])
  const flow = useReactFlow()
  const storeApi = useStoreApi()

  const camera = useUiStore((state) => state.camera)
  const setCamera = useUiStore((state) => state.setCamera)
  const nodePositions = useUiStore((state) => state.nodePositions)
  const setNodePosition = useUiStore((state) => state.setNodePosition)
  const clearNodePositions = useUiStore((state) => state.clearNodePositions)
  const minimapVisible = useUiStore((state) => state.minimapVisible)
  const setMinimapVisible = useUiStore((state) => state.setMinimapVisible)
  const architectureFocus = useUiStore((state) => state.architectureFocus)
  const toggleArchitectureFocus = useUiStore((state) => state.toggleArchitectureFocus)
  const clearExpandedEdges = useUiStore((state) => state.clearExpandedEdges)
  const toggleEdgeExpanded = useUiStore((state) => state.toggleEdgeExpanded)
  const storedSelectedRelationshipId = useUiStore((state) => state.selectedRelationshipId)
  const setStoredSelectedRelationshipId = useUiStore(
    (state) => state.setSelectedRelationshipId,
  )
  // Workspace selection is URL-backed. The store fallback keeps the canvas
  // useful in isolated renders while the URL effect is catching up.
  const activeSelectedRelationshipId = onSelectRelationship
    ? (selectedRelationshipId !== undefined ? selectedRelationshipId : null)
    : (selectedRelationshipId !== undefined
      ? selectedRelationshipId
      : storedSelectedRelationshipId)

  // A syntactically valid URL id may still be absent from this snapshot (or
  // point at a dangling relationship that projection cannot draw). Keep that
  // useful not-found inspector state, but never treat it as a visual selection:
  // otherwise every rendered edge would be dimmed with nothing to highlight.
  const visualSelectedRelationshipId = useMemo(() => {
    if (activeSelectedRelationshipId === null) return null
    return graph.edges.some((edge) =>
      edge.data?.relationships.some(
        (relationship) => relationship.relationshipId === activeSelectedRelationshipId,
      ),
    )
      ? activeSelectedRelationshipId
      : null
  }, [activeSelectedRelationshipId, graph.edges])

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
  // A direction switch is an explicit user action. It invalidates local drag
  // positions and parks one fit until the direction-specific layout lands.
  const orientationRef = useRef<GraphOrientation | null>(null)
  // The very first viewport React Flow renders with. Read once so a later
  // camera change never re-mounts the flow.
  const [initialViewport] = useState<Viewport>(() => useUiStore.getState().camera)

  // `graph.nodes` is already what `collapse.ts` left visible, so the accessible
  // names describe exactly the boxes that are drawn — a component behind a
  // closed container is not a tab stop and is not named as one.
  const visibleNodeIds = useMemo(() => new Set(graph.nodes.map((node) => node.id)), [graph.nodes])
  const rovingNodeId = useMemo(() => {
    if (focusedNodeId !== null && visibleNodeIds.has(focusedNodeId)) return focusedNodeId
    return graph.nodes[0]?.id ?? null
  }, [focusedNodeId, graph.nodes, visibleNodeIds])

  const positionedNodes = useMemo(
    () => {
      const relatedNodeIds = new Set(
        visualSelectedRelationshipId === null
          ? []
          : graph.edges.flatMap((edge) =>
              edge.data?.relationships.some(
                (relationship) =>
                  relationship.relationshipId === visualSelectedRelationshipId,
              )
                ? [edge.source, edge.target]
                : [],
            ),
      )
      const positioned = applyTemporaryPositions(
        graph.nodes,
        nodePositions,
        selectedComponentId ?? null,
      ).map((node) =>
        relatedNodeIds.has(node.id)
          ? { ...node, data: { ...node.data, relationshipSelected: true } }
          : node,
      )
      return positioned
    },
    [
      graph.edges,
      graph.nodes,
      nodePositions,
      selectedComponentId,
      visualSelectedRelationshipId,
    ],
  )

  const nodes = useMemo(
    () => withNodeAccessibility(positionedNodes, voice, rovingNodeId),
    [positionedNodes, rovingNodeId, voice],
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
    surface.style.setProperty('--vai-canvas-zoom-inverse', String(1 / safe))
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
      const { width, height, nodeLookup } = storeApi.getState()
      if (nodeLookup.size === 0) return false

      const bounds = getNodesBounds([...nodeLookup.values()], { nodeLookup })
      // React Flow reports zero (and briefly undersized) surfaces while a
      // pane is mounting or changing size. Do not consume an explicit request
      // against that surface: callers can safely retry after measurement.
      if (
        width < MIN_FIT_VIEWPORT ||
        height < MIN_FIT_VIEWPORT ||
        bounds.width <= 0 ||
        bounds.height <= 0
      ) {
        return false
      }

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
      setFitViewCount((count) => count + 1)
      return true
    },
    [flow, storeApi, setCamera, publishZoom],
  )

  /**
   * Folding both side panes changes the drawing surface asynchronously. The
   * focus action therefore parks one explicit fit on entry and on return until
   * the browser has applied the new surface size, then clears the request
   * permanently. The effect intentionally depends only on focus and surface
   * size: a later live model update must never be mistaken for another camera
   * command.
  */
  type SurfaceSize = { width: number; height: number }
  type ArchitectureFocusFitPending = {
    mode: 'enter' | 'exit'
    before: SurfaceSize
    last: SurfaceSize | null
    stableFrames: number
    observedSize: SurfaceSize | null
  }
  const architectureFocusFitRafRef = useRef<number | null>(null)
  const architectureFocusFitUsesRafRef = useRef(false)
  const architectureFocusFitPendingRef = useRef<ArchitectureFocusFitPending | null>(null)
  const previousArchitectureFocusRef = useRef(false)
  const architectureFocusFitContextRef = useRef({
    architectureFocus,
    graphIsRelayouting: graph.isRelayouting,
    nodeCount: graph.nodes.length,
    projectId,
  })
  const fitViewRef = useRef(fitView)
  const scheduleArchitectureFocusFitCheckRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    architectureFocusFitContextRef.current = {
      architectureFocus,
      graphIsRelayouting: graph.isRelayouting,
      nodeCount: graph.nodes.length,
      projectId,
    }
    fitViewRef.current = fitView
  }, [architectureFocus, fitView, graph.isRelayouting, graph.nodes.length, projectId])

  const scheduleArchitectureFocusFitCheck = useCallback(() => {
    if (
      architectureFocusFitPendingRef.current === null ||
      architectureFocusFitRafRef.current !== null
    ) {
      return
    }

    const check = () => {
      architectureFocusFitRafRef.current = null
      const pending = architectureFocusFitPendingRef.current
      if (pending === null) return

      const context = architectureFocusFitContextRef.current
      const expectedFocus = pending.mode === 'enter'
      if (context.architectureFocus !== expectedFocus) {
        architectureFocusFitPendingRef.current = null
        return
      }

      const { width, height, nodeLookup } = storeApi.getState()
      const size = { width, height }
      const sizeChanged = width !== pending.before.width || height !== pending.before.height
      const measuredByReactFlow =
        width >= MIN_FIT_VIEWPORT && height >= MIN_FIT_VIEWPORT
      const domRect = surfaceRef.current?.getBoundingClientRect()
      const hasBrowserLayout = Boolean(domRect && domRect.width > 0 && domRect.height > 0)
      const canWaitForBrowserResize =
        typeof window.requestAnimationFrame === 'function' && hasBrowserLayout

      if (
        context.graphIsRelayouting ||
        context.nodeCount === 0 ||
        nodeLookup.size === 0 ||
        !measuredByReactFlow ||
        (!sizeChanged && canWaitForBrowserResize) ||
        (pending.observedSize !== null &&
          (Math.round(pending.observedSize.width) !== width ||
            Math.round(pending.observedSize.height) !== height))
      ) {
        pending.last = null
        pending.stableFrames = 0
        scheduleArchitectureFocusFitCheckRef.current?.()
        return
      }

      // In a real browser, React Flow's ResizeObserver and the two animation
      // frames below make this wait for the *new* pane size, not the valid old
      // size that is still in the store during the collapse. jsdom has no
      // animation frames or layout engine; its fixed React Flow fallback size
      // is the only measurable surface there, so allow it after one retry.
      if (
        pending.last === null ||
        pending.last.width !== width ||
        pending.last.height !== height
      ) {
        pending.last = size
        pending.stableFrames = 1
        scheduleArchitectureFocusFitCheckRef.current?.()
        return
      }
      pending.stableFrames += 1
      if (canWaitForBrowserResize && pending.stableFrames < 2) {
        scheduleArchitectureFocusFitCheckRef.current?.()
        return
      }

      if (!fitViewRef.current('user')) {
        pending.last = null
        pending.stableFrames = 0
        scheduleArchitectureFocusFitCheckRef.current?.()
        return
      }

      architectureFocusFitPendingRef.current = null
      // A focus fit can be the first usable picture of a project. Record that
      // fact so the policy does not replay an automatic initial fit after this
      // explicit request completes.
      policyRef.current = {
        fittedProjectId: context.projectId,
        fittedSize: size,
      }
    }

    if (typeof window.requestAnimationFrame === 'function') {
      architectureFocusFitUsesRafRef.current = true
      architectureFocusFitRafRef.current = window.requestAnimationFrame(check)
    } else {
      architectureFocusFitUsesRafRef.current = false
      architectureFocusFitRafRef.current = window.setTimeout(check, 16)
    }
  }, [storeApi])

  useEffect(() => {
    scheduleArchitectureFocusFitCheckRef.current = scheduleArchitectureFocusFitCheck
  }, [scheduleArchitectureFocusFitCheck])

  // Observe the same surface React Flow measures. The observer wakes the
  // settling loop as soon as either panel collapse has produced a new box;
  // the loop still compares/equalises the store dimensions before fitting.
  useEffect(() => {
    const target = surfaceRef.current?.querySelector('.react-flow') ?? surfaceRef.current
    if (!target || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const pending = architectureFocusFitPendingRef.current
      if (pending === null) return
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) {
        pending.observedSize = { width: rect.width, height: rect.height }
      }
      scheduleArchitectureFocusFitCheck()
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [scheduleArchitectureFocusFitCheck])

  // A transition creates exactly one parked request. It is redeemed by the
  // observer/rAF loop above once the new dimensions are visible, and cannot be
  // replayed by later graph or live-data updates.
  useEffect(() => {
    const entering = architectureFocus && !previousArchitectureFocusRef.current
    const leaving = !architectureFocus && previousArchitectureFocusRef.current
    previousArchitectureFocusRef.current = architectureFocus

    if (!entering && !leaving) return

    architectureFocusFitPendingRef.current = {
      mode: entering ? 'enter' : 'exit',
      before: { width: surfaceWidth, height: surfaceHeight },
      last: null,
      stableFrames: 0,
      observedSize: null,
    }
    // Claim the camera before React Flow reports the new size so the settling
    // policy cannot win a race with this explicit fit.
    userMovedCameraRef.current = true
    scheduleArchitectureFocusFitCheck()
  }, [
    architectureFocus,
    scheduleArchitectureFocusFitCheck,
    surfaceHeight,
    surfaceWidth,
  ])

  useEffect(
    () => () => {
      const pendingFrame = architectureFocusFitRafRef.current
      if (pendingFrame !== null) {
        if (architectureFocusFitUsesRafRef.current) {
          window.cancelAnimationFrame(pendingFrame)
        } else {
          window.clearTimeout(pendingFrame)
        }
      }
      architectureFocusFitRafRef.current = null
      architectureFocusFitPendingRef.current = null
    },
    [],
  )

  /** Explicitly reveals one laid-out component without changing the zoom. */
  const focusComponentInView = useCallback(
    (componentId: ComponentId) => {
      invalidatePendingSearchFocus()
      const { width, height, nodeLookup } = storeApi.getState()
      const node = nodeLookup.get(componentId)
      if (!node || width <= 0 || height <= 0) return
      const focus = getNodesBounds([node], { nodeLookup })
      const current = flow.getViewport()
      const viewport = viewportForFocus(current, focus, { width, height })
      userMovedCameraRef.current = true
      if (viewport.x === current.x && viewport.y === current.y) return
      void flow.setViewport(viewport)
      setCamera(viewport)
      setDetailLevel(detailLevelForZoom(viewport.zoom))
      publishZoom(viewport.zoom)
    },
    [flow, invalidatePendingSearchFocus, publishZoom, setCamera, storeApi],
  )

  // React Flow's node lookup is an external mutable store. Read it during
  // render so layout and temporary drag updates are reflected immediately;
  // React already re-renders this component for both kinds of change.
  const selectionFocusBounds = (() => {
    if (!selectedComponentId) return null
    const { nodeLookup } = storeApi.getState()
    const node = nodeLookup.get(selectedComponentId)
    return node ? getNodesBounds([node], { nodeLookup }) : null
  })()
  const selectionNeedsJump = useMemo(() => {
    if (!selectionFocusBounds || surfaceWidth <= 0 || surfaceHeight <= 0) return false
    return !isBoundsFullyVisible(
      camera,
      selectionFocusBounds,
      { width: surfaceWidth, height: surfaceHeight },
    )
  }, [camera, selectionFocusBounds, surfaceHeight, surfaceWidth])

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

  useEffect(() => {
    const previous = orientationRef.current
    orientationRef.current = orientation
    // The first orientation is the URL/default input for the initial picture,
    // not a second explicit camera movement.
    if (previous === null || previous === orientation) return

    invalidatePendingSearchFocus()
    // Positions are meaningful only in the coordinate system that produced
    // them. Resetting them here keeps one transient set instead of persisting
    // two direction-specific sets, while selection and disclosure stay intact.
    clearNodePositions()
    pendingFitRef.current = { mode: 'user', focusComponentId: null }
  }, [clearNodePositions, invalidatePendingSearchFocus, orientation])

  /** Fits now if the graph is already the right one, otherwise after re-layout. */
  const requestFit = useCallback(
    (mode: FitMode, afterRelayout: boolean) => {
      invalidatePendingSearchFocus()
      // "Lesbare Systemübersicht" reproduces the entry picture, and the entry picture keeps
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
    [fitView, invalidatePendingSearchFocus, selectedComponentId],
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
    // An architecture-focus transition owns the next camera movement. Leave
    // the automatic initial/resize policy untouched until that explicit fit
    // has a valid measured surface.
    if (architectureFocusFitPendingRef.current !== null) return
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
    setCollapsedComponentIds(graph.requestedCollapsedIds)
  }, [
    collapsedComponentIds,
    graph.nodes.length,
    graph.requestedCollapsedIds,
    setCollapsedComponentIds,
  ])

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

  // A search result may have opened one or more collapsed ancestors. Wait for
  // that exact layout before panning; unrelated containers stay collapsed and
  // no camera movement happens while ELK is still solving the new graph.
  useEffect(() => {
    const componentId = pendingFocusRef.current
    if (componentId === null || graph.isRelayouting || graph.nodes.length === 0) return
    pendingFocusRef.current = null
    focusComponentInView(componentId)
  }, [focusComponentInView, graph.isRelayouting, graph.nodes.length, graph.signature])

  // A collapse, orientation change or live replacement can remove the node
  // that owns the roving entry. Keep the entry on the nearest visible ancestor
  // where possible, otherwise use the first node in the canonical projection
  // order. Wait for the new layout so a stale in-flight graph cannot steal the
  // focus state back while ELK is solving.
  const graphNodes = graph.nodes
  const graphAncestorsOf = graph.ancestorsOf
  const graphIsRelayouting = graph.isRelayouting
  useEffect(() => {
    if (graphIsRelayouting) return

    const current = focusedNodeId
    const fallback =
      current !== null && visibleNodeIds.has(current)
        ? current
        : current !== null
          ? [...graphAncestorsOf(current)].reverse().find((id) => visibleNodeIds.has(id)) ??
            graphNodes[0]?.id ??
            null
          : graphNodes[0]?.id ?? null
    if (fallback === current) return

    // Defer the state write to the next microtask. `rovingNodeId` already
    // derives the valid fallback during this render, and the deferred write
    // avoids a cascading render directly from the synchronization effect.
    queueMicrotask(() =>
      setFocusedNodeId((previous) => (previous === current ? fallback : previous)),
    )
    if (!graphHasNodeFocusRef.current) return

    const active = document.activeElement
    const activeNode = active instanceof HTMLElement ? active.closest('.react-flow__node') : null
    const activeNodeId = activeNode?.getAttribute('data-id')
    if (active !== document.body && activeNodeId !== current) return

    queueMicrotask(() => {
      const next = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].find(
        (element) => element.getAttribute('data-id') === fallback,
      )
      next?.focus()
    })
  }, [
    focusedNodeId,
    graphAncestorsOf,
    graphIsRelayouting,
    graphNodes,
    visibleNodeIds,
  ])

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
      return {
        ...edge,
        data: {
          ...edge.data,
          ...(route ? { route } : {}),
        },
      }
    })
    const labelRatios = staggeredLabelRatios(
      routed.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.data?.route ? { route: edge.data.route } : {}),
      })),
    )
    const positioned = routed.map((edge) => {
      const labelRatio = labelRatios.get(edge.id)
      if (!edge.data || labelRatio === undefined) return edge
      return { ...edge, data: { ...edge.data, labelRatio } }
    })
    return withEdgeAccessibility(
      positioned,
      nodeNames,
      voice,
      visualSelectedRelationshipId,
    ).map((edge) => ({
      ...edge,
      ...(edge.data
        ? {
            data: {
              ...edge.data,
              selectedRelationshipId: visualSelectedRelationshipId,
              onSelectRelationship:
                onSelectRelationship ?? setStoredSelectedRelationshipId,
            },
          }
        : {}),
    }))
  }, [
    graph.edges,
    graph.routes,
    nodePositions,
    nodeNames,
    onSelectRelationship,
    setStoredSelectedRelationshipId,
    visualSelectedRelationshipId,
    voice,
  ])

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      onSelectComponent(node.id === selectedComponentId ? null : node.id)
    },
    [onSelectComponent, selectedComponentId],
  )

  const openSearch = useCallback(() => {
    setSearchQuery('')
    setActiveSearchIndex(0)
    setSearchOpen(true)
  }, [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])

  // The command is scoped to the mounted architecture workspace, but it also
  // works when focus is in a neighbouring pane or on the document body. The
  // editable guard keeps `/` from stealing an input's normal text entry.
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const editable =
        target instanceof Element
          ? target.closest('input, textarea, select, [contenteditable="true"]')
          : null
      const commandSearch =
        (event.key === '/' && editable === null) ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')
      if (!commandSearch || event.defaultPrevented) return
      event.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', onWindowKeyDown)
    return () => window.removeEventListener('keydown', onWindowKeyDown)
  }, [openSearch])

  const onJumpToSelection = useCallback(() => {
    if (selectedComponentId) focusComponentInView(selectedComponentId)
  }, [focusComponentInView, selectedComponentId])

  const selectSearchResult = useCallback(
    (componentId: ComponentId) => {
      const ancestors = new Set(graph.ancestorsOf(componentId))
      const nextCollapsed = graph.requestedCollapsedIds.filter((id) => !ancestors.has(id))
      // Compare the effective sets, not the requested arrays: a nested collapse
      // below an already closed parent is still part of the full state, but it
      // does not change the picture until that parent is opened. This also
      // catches a deep-link reveal being closed when the search moves elsewhere.
      const nextVisibleCollapsed = nextCollapsed.filter(
        (id) => !graph.ancestorsOf(id).some((ancestor) => nextCollapsed.includes(ancestor)),
      )
      const willRelayout =
        nextVisibleCollapsed.length !== graph.collapsedIds.length ||
        nextVisibleCollapsed.some((id, index) => id !== graph.collapsedIds[index])

      if (willRelayout) {
        pendingFocusRef.current = componentId
        setCollapsedComponentIds(nextCollapsed)
      } else {
        // A no-relayout search is complete in this user action. Never leave a
        // ref behind that a later model update could interpret as a new camera
        // request.
        pendingFocusRef.current = null
      }
      // Search is an explicit selection, not the click-toggle interaction of a
      // canvas node. The URL, selected node and inspector therefore converge on
      // this exact id even when it was already selected.
      onSelectComponent(componentId)
      closeSearch()
      if (!willRelayout) focusComponentInView(componentId)
    },
    [closeSearch, focusComponentInView, graph, onSelectComponent, setCollapsedComponentIds],
  )

  const onSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveSearchIndex((index) =>
          searchResults.length === 0 ? 0 : (index + 1) % searchResults.length,
        )
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveSearchIndex((index) =>
          searchResults.length === 0
            ? 0
            : (index - 1 + searchResults.length) % searchResults.length,
        )
      } else if (event.key === 'Enter') {
        const result = searchResults[effectiveActiveSearchIndex]
        if (!result) return
        event.preventDefault()
        selectSearchResult(result.component.componentId)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        closeSearch()
      }
    },
    [closeSearch, effectiveActiveSearchIndex, searchResults, selectSearchResult],
  )

  /**
   * The path is the hit target when labels are hidden. At readable levels a
   * bundle remains a disclosure action: the path opens it, while its expanded
   * labels select one member at a time. At map level the path selects the first
   * member in the inspector, because expanding labels would violate the text
   * floor.
   */
  const onEdgeClick = useCallback<EdgeMouseHandler<ArchitectureEdge>>(
    (_event, edge) => {
      const relationships = edge.data?.relationships ?? []
      if (relationships.length > 1) {
        if (detailLevel === 'minimal') {
          const first = relationships[0]
          if (!first) return
          ;(onSelectRelationship ?? setStoredSelectedRelationshipId)(
            first.relationshipId === visualSelectedRelationshipId
              ? null
              : first.relationshipId,
          )
          return
        }
        toggleEdgeExpanded(edge.id)
        return
      }
      const only = relationships[0]
      if (!only) return
      ;(onSelectRelationship ?? setStoredSelectedRelationshipId)(
        only.relationshipId === visualSelectedRelationshipId ? null : only.relationshipId,
      )
    },
    [
      onSelectRelationship,
      setStoredSelectedRelationshipId,
      toggleEdgeExpanded,
      detailLevel,
      visualSelectedRelationshipId,
    ],
  )

  // Temporary, local, never persisted and never sent anywhere.
  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) => {
      setNodePosition(node.id, { x: node.position.x, y: node.position.y })
    },
    [setNodePosition],
  )

  const spatialNodes = useMemo(() => toSpatialNodes(positionedNodes), [positionedNodes])

  const focusSpatialNode = useCallback(
    (componentId: ComponentId, direction: SpatialDirection) => {
      // The viewport can apply nested transforms that are not represented by
      // the relative React Flow model positions alone. In the browser use the
      // rendered rectangles as the source of truth; jsdom has no layout, so
      // the model projection remains the deterministic test fallback.
      const renderedNodes = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(
        (element, order) => {
          const rect = element.getBoundingClientRect()
          return {
            id: element.getAttribute('data-id') ?? '',
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            order,
          }
        },
      )
      const hasLayout = renderedNodes.some(
        (node) => node.width > 0 || node.height > 0 || node.x !== 0 || node.y !== 0,
      )
      const nextId = spatialNeighbor(
        hasLayout ? renderedNodes : spatialNodes,
        componentId,
        direction,
        orientation,
      )
      if (nextId === null) return

      setFocusedNodeId(nextId)
      // This helper preserves the current zoom and only pans when needed. It
      // also makes keyboard focus reliable in browsers where programmatic
      // focus does not match React Flow's :focus-visible auto-pan check.
      focusComponentInView(nextId)
      const next = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].find(
        (element) => element.getAttribute('data-id') === nextId,
      )
      next?.focus()
    },
    [focusComponentInView, orientation, spatialNodes],
  )

  const onSurfaceFocusCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const node = target.closest('.react-flow__node')
    const componentId = node?.getAttribute('data-id')
    if (componentId === null || componentId === undefined) return
    graphHasNodeFocusRef.current = true
    setFocusedNodeId(componentId)
  }, [])

  const onSurfaceBlurCapture = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (!(next instanceof globalThis.Node) || !surfaceRef.current?.contains(next)) {
      graphHasNodeFocusRef.current = false
    }
  }, [])

  // React Flow passes `null` for a programmatic move and the real input event
  // for a user one — which is exactly the distinction the camera policy needs.
  const onMoveStart = useCallback((event: unknown) => {
    if (event !== null && event !== undefined) {
      userMovedCameraRef.current = true
      invalidatePendingSearchFocus()
    }
  }, [invalidatePendingSearchFocus])

  const onMove = useCallback(
    (event: unknown, viewport: Viewport) => {
      if (event !== null && event !== undefined) invalidatePendingSearchFocus()
      setDetailLevel(detailLevelForZoom(viewport.zoom))
      publishZoom(viewport.zoom)
    },
    [invalidatePendingSearchFocus, publishZoom],
  )

  const onMoveEnd = useCallback(
    (event: unknown, viewport: Viewport) => {
      if (event !== null && event !== undefined) invalidatePendingSearchFocus()
      setCamera(viewport)
      setDetailLevel(detailLevelForZoom(viewport.zoom))
      publishZoom(viewport.zoom)
    },
    [invalidatePendingSearchFocus, setCamera, publishZoom],
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
   * the same two actions its badges offer to the mouse. At map level the
   * bundle control is icon-only, so activation selects its first relationship
   * for the inspector instead of exposing text below the readability floor.
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

      const editable = target.closest('input, textarea, select, [contenteditable="true"]')
      const commandSearch =
        (event.key === '/' && editable === null) ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')
      if (commandSearch) {
        event.preventDefault()
        event.stopPropagation()
        openSearch()
        return
      }

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
        if (ARROW_KEYS.has(event.key)) {
          // Spatial navigation owns the arrow keys. React Flow's default
          // handler would otherwise try to move a selected node and announce
          // a position update that this controlled, read-only graph discards.
          event.preventDefault()
          event.stopPropagation()
          focusSpatialNode(componentId, event.key as SpatialDirection)
        }
        return
      }

      const edgeElement = target.closest('.react-flow__edge')
      if (!edgeElement) return
      const edgeId = edgeElement.getAttribute('data-id')
      if (edgeId === null) return
      if (!ACTIVATION_KEYS.has(event.key) && event.key !== 'Escape') return
      if (event.key === 'Escape' && activeSelectedRelationshipId === null) return

      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        ;(onSelectRelationship ?? setStoredSelectedRelationshipId)(null)
        return
      }
      const edge = edges.find((candidate) => candidate.id === edgeId)
      const relationships = edge?.data?.relationships ?? []
      if (relationships.length > 1) {
        if (detailLevel === 'minimal') {
          const first = relationships[0]
          if (!first) return
          ;(onSelectRelationship ?? setStoredSelectedRelationshipId)(
            first.relationshipId === activeSelectedRelationshipId
              ? null
              : first.relationshipId,
          )
          return
        }
        toggleEdgeExpanded(edgeId)
        return
      }
      const only = relationships[0]
      if (!only) return
      ;(onSelectRelationship ?? setStoredSelectedRelationshipId)(
        only.relationshipId === activeSelectedRelationshipId ? null : only.relationshipId,
      )
    },
    [
      edges,
      onSelectComponent,
      selectedComponentId,
      activeSelectedRelationshipId,
      onSelectRelationship,
      setStoredSelectedRelationshipId,
      detailLevel,
      openSearch,
      focusSpatialNode,
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

  /** "Gesamtkarte": everything open, everything on screen for orientation. */
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
      onFocusCapture={onSurfaceFocusCapture}
      onBlurCapture={onSurfaceBlurCapture}
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
      data-layout-orientation={orientation}
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
          onEdgeClick={onEdgeClick}
          onNodeDragStop={onNodeDragStop}
          onMoveStart={onMoveStart}
          onMove={onMove}
          onMoveEnd={onMoveEnd}
          nodesDraggable
          nodesConnectable={false}
          edgesFocusable
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
            <div
              className={`canvas-toolbar architecture-toolbar ${minimapVisible ? '' : 'architecture-toolbar-full'} border-border bg-card/90 nopan nodrag flex min-w-0 flex-wrap items-center gap-1 rounded-md border px-1 py-1 backdrop-blur-sm`}
            >
              <div
                className="flex min-w-0 flex-wrap items-center gap-1"
                role="group"
                aria-label={t('tool.primaryActions')}
                data-testid="canvas-primary-actions"
              >
              <Button
                ref={searchTriggerRef}
                variant="ghost"
                size="sm"
                className="canvas-toolbar-action h-7 gap-1.5 px-2 text-xs"
                aria-haspopup="dialog"
                aria-expanded={searchOpen}
                aria-keyshortcuts="/ Control+K Meta+K"
                onClick={openSearch}
                data-testid="canvas-component-search"
              >
                <Search aria-hidden="true" />
                {t('search.trigger')}
              </Button>

              {selectionNeedsJump && selectedComponentId && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="canvas-toolbar-action h-7 gap-1.5 px-2 text-xs"
                      onClick={onJumpToSelection}
                      data-testid="canvas-jump-to-selection"
                    >
                      <MapPinOff aria-hidden="true" />
                      {t('search.jumpToSelection')}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80">
                    {t('search.jumpToSelectionHint')}
                  </TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="canvas-toolbar-action h-7 gap-1.5 px-2 text-xs"
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
                      className="canvas-toolbar-action h-7 gap-1.5 px-2 text-xs"
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
                      className="canvas-toolbar-action h-7 gap-1.5 px-2 text-xs"
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
                    variant={architectureFocus ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={toggleArchitectureFocus}
                    aria-pressed={architectureFocus}
                    data-testid="canvas-toggle-architecture-focus"
                  >
                    <Focus aria-hidden="true" />
                    {t(architectureFocus ? 'tool.exitArchitectureFocus' : 'tool.focusArchitecture')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-80">
                  {t(
                    architectureFocus
                      ? 'tool.exitArchitectureFocusHint'
                      : 'tool.focusArchitectureHint',
                  )}
                </TooltipContent>
              </Tooltip>
              </div>

              <div
                className="flex min-w-0 flex-wrap items-center gap-1"
                role="group"
                aria-label={t('tool.secondaryInfo')}
                data-testid="canvas-secondary-info"
              >
                <span className="bg-border mx-0.5 h-4 w-px" aria-hidden="true" />

                <div
                  className="border-border/70 flex min-w-0 flex-wrap items-center rounded-sm border"
                  role="group"
                  aria-label={t('tool.layoutOrientation')}
                  data-testid="canvas-layout-orientation"
                >
                <Button
                  variant="ghost"
                  size="sm"
                  className="canvas-toolbar-action h-7 gap-1 px-2 text-xs"
                  aria-pressed={orientation === 'top-down'}
                  onClick={() => onOrientationChange('top-down')}
                  data-testid="canvas-layout-top-down"
                >
                  <span aria-hidden="true">↓ </span>
                  {t('tool.layoutTopDown')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="canvas-toolbar-action h-7 gap-1 px-2 text-xs"
                  aria-pressed={orientation === 'left-right'}
                  onClick={() => onOrientationChange('left-right')}
                  data-testid="canvas-layout-left-right"
                >
                  <span aria-hidden="true">→ </span>
                  {t('tool.layoutLeftRight')}
                </Button>
                </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="canvas-toolbar-action size-7"
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
            </div>
            {searchOpen && (
              <div
                className="border-border bg-card text-card-foreground nokey nopan absolute top-full left-0 z-50 mt-1 w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-md border shadow-lg"
                role="dialog"
                aria-label={t('search.trigger')}
                data-testid="canvas-component-search-dialog"
              >
                <div className="border-border flex items-center gap-2 border-b p-2">
                  <Search className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                  <label htmlFor="canvas-component-search-input" className="sr-only">
                    {t('search.hint')}
                  </label>
                  <input
                    ref={searchInputRef}
                    id="canvas-component-search-input"
                    type="search"
                    role="combobox"
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value)
                      setActiveSearchIndex(0)
                    }}
                    onKeyDown={(event) => {
                      // React Flow owns the surrounding keyboard surface; keep
                      // ordinary text entry from reaching its pane handler.
                      event.stopPropagation()
                      onSearchKeyDown(event)
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    placeholder={t('search.hint')}
                    aria-describedby="canvas-component-search-status"
                    aria-controls="canvas-component-search-results"
                    aria-expanded={searchQuery.trim() !== '' && searchResults.length > 0}
                    aria-autocomplete="list"
                    aria-activedescendant={
                      searchQuery.trim() !== '' && searchResults.length > 0
                        ? `canvas-component-search-result-${effectiveActiveSearchIndex}`
                        : undefined
                    }
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    data-testid="canvas-component-search-input"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('search.close')}
                    onClick={closeSearch}
                    data-testid="canvas-component-search-close"
                  >
                    <span aria-hidden="true">×</span>
                  </Button>
                </div>

                <p
                  id="canvas-component-search-status"
                  data-testid="canvas-component-search-status"
                  className="text-muted-foreground px-3 py-2 text-xs"
                  role="status"
                  aria-live="polite"
                >
                  {searchQuery.trim() === ''
                    ? t('search.empty')
                    : searchResults.length === 0
                      ? t('search.noResults')
                      : t('search.resultCount', { count: searchResults.length })}
                </p>

                {searchQuery.trim() !== '' && searchResults.length > 0 && (
                  <div
                    className="border-border max-h-72 overflow-y-auto border-t p-1"
                    id="canvas-component-search-results"
                    role="listbox"
                    aria-label={t('search.trigger')}
                    data-testid="canvas-component-search-results"
                  >
                    {searchResults.map((entry, index) => (
                      <button
                        key={entry.component.componentId}
                        type="button"
                        id={`canvas-component-search-result-${index}`}
                        role="option"
                        aria-selected={index === effectiveActiveSearchIndex}
                        className={`hover:bg-accent focus-visible:bg-accent flex w-full min-w-0 flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm outline-none ${index === effectiveActiveSearchIndex ? 'bg-accent' : ''}`}
                        onMouseEnter={() => setActiveSearchIndex(index)}
                        onClick={() => selectSearchResult(entry.component.componentId)}
                        data-testid="canvas-component-search-result"
                        data-component-id={entry.component.componentId}
                      >
                        <span className="flex w-full min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium">
                            <ReportedText value={entry.component.name} />
                          </span>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {componentKindLabel(entry.component.kind, t)}
                          </span>
                        </span>
                        <span className="text-muted-foreground w-full truncate text-xs">
                          {entry.containerPath.length > 0 ? (
                            <ReportedText value={entry.containerPath.join(' / ')} />
                          ) : (
                            t('search.root')
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
