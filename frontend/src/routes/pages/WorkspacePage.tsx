import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useEffect } from 'react'

import { useProject } from '@/api/queries'
import { useLiveStream } from '@/api/useLiveStream'
import { ArchitecturePane } from '@/components/workspace/ArchitecturePane'
import { InspectorPane } from '@/components/workspace/InspectorPane'
import { RunAgentPane } from '@/components/workspace/RunAgentPane'
import { WorkspaceHeader } from '@/components/workspace/WorkspaceHeader'
import { WorkspaceLayout } from '@/components/workspace/WorkspaceLayout'
import { useUiStore } from '@/state/uiStore'
import type { DeepFocusTarget } from '@/routes/searchParams'
import {
  DEFAULT_GRAPH_ORIENTATION,
  type GraphOrientation,
} from '@/canvas/graphOrientation'

const route = getRouteApi('/projects/$projectId/runs/$runId')

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
  const { projectId, runId } = route.useParams()
  const search = route.useSearch()
  const navigate = route.useNavigate()

  // Keeps the project detail subscribed so live events invalidate and refetch
  // it. The header renders the slug — the contract has no project display name.
  useProject(projectId)
  useLiveStream(projectId)

  const setSelectedComponentId = useUiStore((state) => state.setSelectedComponentId)
  const enterDeepFocus = useUiStore((state) => state.enterDeepFocus)
  const exitDeepFocus = useUiStore((state) => state.exitDeepFocus)

  // URL -> UI store. The canvas (#9) and the inspector (#12) read the selection
  // from the store; the URL stays authoritative.
  useEffect(() => {
    setSelectedComponentId(search.component ?? null)
  }, [search.component, setSelectedComponentId])

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
        search: (previous) => ({ ...previous, component: componentId ?? undefined }),
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

  const setGraphOrientation = useCallback(
    (layout: GraphOrientation) => {
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
      <WorkspaceHeader projectId={projectId} runId={runId} />
      <WorkspaceLayout
        left={<RunAgentPane projectId={projectId} runId={runId} />}
        center={
          <ArchitecturePane
            projectId={projectId}
            selectedComponentId={search.component}
            onSelectComponent={setSelectedComponent}
            orientation={search.layout ?? DEFAULT_GRAPH_ORIENTATION}
            onOrientationChange={setGraphOrientation}
          />
        }
        right={
          <InspectorPane
            projectId={projectId}
            runId={runId}
            componentId={search.component}
            focus={search.focus}
            historyMode={search.history === true}
            onSetFocus={setFocus}
            onSetHistoryMode={setHistoryMode}
          />
        }
      />
    </>
  )
}
