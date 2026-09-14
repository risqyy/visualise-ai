import { useLayoutEffect, type ReactNode } from 'react'

import { canvasViewKey, useUiStore } from '@/state/uiStore'

/** Activate a view before mounting React Flow, so it reads that view's initial
 * viewport and disclosure. Live revisions leave this boundary mounted.
 */
export function CanvasViewBoundary({ projectId, viewId, collapsedDefaults, children }: { projectId: string; viewId: string | null; collapsedDefaults?: string[] | undefined; children: ReactNode }) {
  const activeKey = useUiStore((state) => state.activeCanvasViewKey)
  const collapsed = useUiStore((state) => state.collapsedComponentIds)
  const activate = useUiStore((state) => state.activateCanvasView)
  const key = canvasViewKey(projectId, viewId)
  useLayoutEffect(() => { activate(projectId, viewId, collapsedDefaults) }, [activate, projectId, viewId, collapsedDefaults])
  return activeKey === key && (viewId === null || collapsed !== null || collapsedDefaults === undefined) ? children : null
}
