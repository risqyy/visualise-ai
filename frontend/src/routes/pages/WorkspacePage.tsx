import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useProject } from '@/api/queries'
import { useLiveStream } from '@/api/useLiveStream'
import { ArchitecturePane } from '@/components/workspace/ArchitecturePane'
import { InspectorPane } from '@/components/workspace/InspectorPane'
import { RunAgentPane } from '@/components/workspace/RunAgentPane'
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader'
import { WorkspaceLayout } from '@/components/workspace/WorkspaceLayout'
import { ReportedText } from '@/i18n'
import { canvasViewKey, useUiStore } from '@/state/uiStore'
import type { DeepFocusTarget } from '@/routes/searchParams'
import {
  type GraphOrientation,
} from '@/canvas/graphOrientation'

const route = getRouteApi('/projects/$projectId/runs/$runId')
const WORKSPACE_TARGETS = ['run-agents', 'architecture', 'inspector'] as const
type WorkspaceTarget = (typeof WORKSPACE_TARGETS)[number]

/**
 * `/projects/$projectId/runs/$runId` — the cockpit workspace.
 *
 * The route parameters and the validated search parameters are the single
 * source of truth for what is shown, so every state of the workspace is a URL
 * that can be shared. The local UI store mirrors the selection for the canvas
 * and the inspector, but never the other way round: nothing writes UI state back
 * into the URL except an explicit user action.
 */
export function WorkspacePage() {
  const { t } = useTranslation('workspace')
  const { projectId, runId } = route.useParams()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const [navigationRequest, setNavigationRequest] = useState<{ target: WorkspaceTarget } | null>(null)
  const pageTitle = t('navigation.pageTitle', { projectId, runId })

  useEffect(() => {
    const previousTitle = document.title
    document.title = pageTitle
    return () => { document.title = previousTitle }
  }, [pageTitle])

  // The request renders after a collapsed pane has mounted its heading. Keep
  // focus local; browser fragment scrolling could move overflow-hidden ancestors.
  useLayoutEffect(() => {
    if (!navigationRequest) return
    mainRef.current?.querySelector<HTMLElement>(
      `#workspace-${navigationRequest.target}-heading`,
    )?.focus({ preventScroll: true })
  }, [navigationRequest])

  const jumpToPane = (target: WorkspaceTarget) => {
    const ui = useUiStore.getState()
    if (target !== 'architecture') ui.exitArchitectureFocus()
    if (target === 'run-agents') ui.setLeftCollapsed(false)
    if (target === 'inspector') ui.setRightCollapsed(false)
    setNavigationRequest({ target })
  }

  // Keeps the project detail subscribed so live events invalidate and refetch
  // it. The header renders the slug — the contract has no project display name.
  useProject(projectId)
  useLiveStream(projectId)

  const setSelectedComponentId = useUiStore((state) => state.setSelectedComponentId)
  const setSelectedRelationshipId = useUiStore((state) => state.setSelectedRelationshipId)
  const enterDeepFocus = useUiStore((state) => state.enterDeepFocus)
  const exitDeepFocus = useUiStore((state) => state.exitDeepFocus)

  // Save the departing view before passive URL mirroring overwrites selection
  // or orientation, including when the next definition is still loading.
  useLayoutEffect(() => {
    useUiStore.getState().activateCanvasView(projectId, search.view ?? null)
  }, [projectId, search.view])

  // URL -> UI store. The canvas (#9) and the inspector (#12) read the selection
  // from the store; the URL stays authoritative.
  useEffect(() => {
    setSelectedComponentId(search.component ?? null)
  }, [projectId, search.view, search.component, setSelectedComponentId])

  // Relationship selection follows the same URL -> local mirror as component
  // selection. The URL remains authoritative, so a reload and a click expose
  // the same inspector and canvas state.
  useEffect(() => {
    setSelectedRelationshipId(search.relationship ?? null)
  }, [projectId, search.view, search.relationship, setSelectedRelationshipId])

  useEffect(() => {
    useUiStore.getState().setCanvasOrientationOverride(search.layout ?? null)
  }, [projectId, search.view, search.layout])

  // URL -> deep-focus layout.
  useEffect(() => {
    if (search.focus) enterDeepFocus(search.focus)
    else exitDeepFocus()
  }, [search.focus, enterDeepFocus, exitDeepFocus])

  const setFocus = useCallback(
    (target: DeepFocusTarget | undefined) => {
      void navigate({
        search: (previous) => ({ ...previous, focus: target }),
        replace: true,
      })
    },
    [navigate],
  )

  // Canvas selection -> URL. The canvas never keeps a selection of its own: a
  // click and a deep link go through the same `component` search parameter, so
  // an incoming live update cannot change what is selected.
  const setSelectedComponent = useCallback(
    (componentId: string | null) => {
      void navigate({
        search: (previous) => ({
          ...previous,
          component: componentId ?? undefined,
          relationship: undefined,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const setSelectedRelationship = useCallback(
    (relationshipId: string | null) => {
      void navigate({
        search: (previous) => ({
          ...previous,
          relationship: relationshipId ?? undefined,
          component: undefined,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const setHistoryMode = useCallback(
    (enabled: boolean) => {
      void navigate({
        search: (previous) => ({ ...previous, history: enabled ? true : undefined }),
        replace: true,
      })
    },
    [navigate],
  )

  const setView = useCallback((viewId: string | undefined) => {
    const remembered = useUiStore.getState().canvasViews[canvasViewKey(projectId, viewId ?? null)]
    void navigate({ search: (previous) => ({ ...previous, view: viewId, layout: remembered?.orientationOverride ?? undefined, component: remembered?.selectedComponentId ?? undefined, relationship: remembered?.selectedRelationshipId ?? undefined }), replace: false })
  }, [navigate, projectId])

  const setGraphOrientation = useCallback(
    (layout: GraphOrientation) => {
      useUiStore.getState().setCanvasOrientationOverride(layout)
      void navigate({
        search: (previous) => ({ ...previous, layout }),
        replace: true,
      })
    },
    [navigate],
  )

  // Escape leaves deep focus — the mode enlarges content, it must never trap.
  useEffect(() => {
    if (!search.focus) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocus(undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [search.focus, setFocus])

  return (
    <>
      <nav aria-label={t('navigation.label')}>
        {WORKSPACE_TARGETS.map((target) => (
          <a
            key={target}
            href={`#workspace-${target}-heading`}
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:text-foreground focus:outline-2 focus:outline-ring"
            onClick={(event) => {
              event.preventDefault()
              jumpToPane(target)
            }}
          >
            {t(`navigation.${target}`)}
          </a>
        ))}
      </nav>
      <WorkspaceHeader projectId={projectId} runId={runId} />
      <main ref={mainRef} aria-labelledby="workspace-title" className="flex min-h-0 flex-1 flex-col">
        <h1 id="workspace-title" className="sr-only">
          {t('navigation.headingLabel')} <ReportedText value={projectId} /> · <ReportedText value={runId} />
        </h1>
        <WorkspaceLayout
          left={<RunAgentPane projectId={projectId} runId={runId} />}
          center={
            <ArchitecturePane
              projectId={projectId}
              runId={runId}
              viewId={search.view}
              onSelectView={setView}
              selectedComponentId={search.component}
              selectedRelationshipId={search.relationship}
              onSelectComponent={setSelectedComponent}
              orientation={search.layout}
              onOrientationChange={setGraphOrientation}
              onSelectRelationship={setSelectedRelationship}
            />
          }
          right={
            <InspectorPane
              projectId={projectId}
              runId={runId}
              componentId={search.component}
              relationshipId={search.relationship}
              focus={search.focus}
              historyMode={search.history === true}
              onSetFocus={setFocus}
              onSetHistoryMode={setHistoryMode}
            />
          }
        />
      </main>
    </>
  )
}
