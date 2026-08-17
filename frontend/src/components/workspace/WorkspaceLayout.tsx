import { PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  GroupImperativeHandle,
  Layout,
  PanelImperativeHandle,
} from 'react-resizable-panels'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  COLLAPSED_PANE_SIZE,
  PANE_IDS,
  PANE_MAX_WIDTH,
  PANE_MIN_WIDTH_PX,
  useUiStore,
  type PaneLayout,
} from '@/state/uiStore'

export interface WorkspaceLayoutProps {
  left: ReactNode
  center: ReactNode
  right: ReactNode
}

/**
 * The three-pane workspace.
 *
 * Sizes and collapse states live in the UI store and are persisted to
 * `localStorage`, so the split survives a reload. The store is the source of
 * truth and the panel group mirrors it imperatively — that way collapsing works
 * identically whether it was triggered by a toolbar button or by dragging a
 * separator past its minimum.
 *
 * Both side panes are independently collapsible. A collapsed pane keeps a thin
 * rail with its expand control, so the pane never disappears without a way back.
 *
 * The **shares** are relative and the **minimums are absolute** (issue #41).
 * That split is deliberate: the proportions are what keeps the architecture
 * surface dominant at every width, while a percentage minimum would shrink with
 * the window and let a pane become unusable at 1280 — the width a 1920 px
 * window has at 150 % browser zoom. The numbers live in `state/uiStore.ts`
 * next to the layout they constrain.
 *
 * Nothing here scrolls. The group is exactly one viewport tall and each pane
 * owns its own scroll region, which is what keeps the page itself free of a
 * scrollbar in either direction.
 */
export function WorkspaceLayout({ left, center, right }: WorkspaceLayoutProps) {
  const { t } = useTranslation('workspace')
  const layout = useUiStore((state) => state.layout)
  const leftCollapsed = useUiStore((state) => state.leftCollapsed)
  const rightCollapsed = useUiStore((state) => state.rightCollapsed)
  const setLayout = useUiStore((state) => state.setLayout)
  const setLeftCollapsed = useUiStore((state) => state.setLeftCollapsed)
  const setRightCollapsed = useUiStore((state) => state.setRightCollapsed)

  const groupRef = useRef<GroupImperativeHandle | null>(null)
  const leftPanelRef = useRef<PanelImperativeHandle | null>(null)
  const rightPanelRef = useRef<PanelImperativeHandle | null>(null)
  // Snapshot taken once on mount: `defaultLayout` must not change on every drag,
  // otherwise the group would fight the user for control of the split. Later
  // changes are pushed imperatively by `useApplyLayout`.
  const [initialLayout] = useState<PaneLayout>(() => useUiStore.getState().layout)

  useApplyLayout(groupRef, layout)
  // Re-apply both collapse commands when either side changes. Expanding one
  // panel can make the resizable group recompute the other panel's size; a
  // pre-collapsed sibling must stay collapsed through that recalculation.
  useApplyCollapse(leftPanelRef, leftCollapsed, rightCollapsed)
  useApplyCollapse(rightPanelRef, rightCollapsed, leftCollapsed)

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={initialLayout}
      groupRef={groupRef}
      onLayoutChanged={(next: Layout, meta) => {
        if (meta.isUserInteraction) setLayout(next)
      }}
    >
      <ResizablePanel
        id={PANE_IDS.left}
        collapsible
        collapsedSize={`${COLLAPSED_PANE_SIZE}%`}
        minSize={PANE_MIN_WIDTH_PX[PANE_IDS.left]}
        maxSize={PANE_MAX_WIDTH.left}
        panelRef={leftPanelRef}
        className="min-w-0"
        onResize={() => syncCollapsed(leftPanelRef, leftCollapsed, setLeftCollapsed)}
      >
        {leftCollapsed ? (
          <CollapsedRail
            side="left"
            label={t('pane.leftLabel')}
            onExpand={() => setLeftCollapsed(false)}
          />
        ) : (
          left
        )}
      </ResizablePanel>

      <ResizableHandle withHandle aria-label={t('pane.leftWidthLabel')} />

      <ResizablePanel
        id={PANE_IDS.center}
        minSize={PANE_MIN_WIDTH_PX[PANE_IDS.center]}
        className="min-w-0"
      >
        {center}
      </ResizablePanel>

      <ResizableHandle withHandle aria-label={t('pane.rightWidthLabel')} />

      <ResizablePanel
        id={PANE_IDS.right}
        collapsible
        collapsedSize={`${COLLAPSED_PANE_SIZE}%`}
        minSize={PANE_MIN_WIDTH_PX[PANE_IDS.right]}
        maxSize={PANE_MAX_WIDTH.right}
        panelRef={rightPanelRef}
        className="min-w-0"
        onResize={() => syncCollapsed(rightPanelRef, rightCollapsed, setRightCollapsed)}
      >
        {rightCollapsed ? (
          <CollapsedRail
            side="right"
            label={t('pane.rightLabel')}
            onExpand={() => setRightCollapsed(false)}
          />
        ) : (
          right
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

/** Thin rail shown instead of a collapsed pane, carrying its expand control. */
function CollapsedRail({
  side,
  label,
  onExpand,
}: {
  side: 'left' | 'right'
  label: string
  onExpand: () => void
}) {
  const { t } = useTranslation('workspace')
  const Icon = side === 'left' ? PanelLeftOpen : PanelRightOpen
  const expand = t('pane.expand', { pane: label })

  return (
    <div
      className="pane-surface items-center gap-2 py-2"
      data-testid={`pane-rail-${side}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" onClick={onExpand}>
            <Icon aria-hidden="true" />
            <span className="sr-only">{expand}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side={side === 'left' ? 'right' : 'left'}>{expand}</TooltipContent>
      </Tooltip>
      <span
        className="pane-heading text-muted-foreground whitespace-nowrap"
        style={{ writingMode: 'vertical-rl' }}
      >
        {label}
      </span>
    </div>
  )
}

/** Pushes a store-driven layout (e.g. deep focus) into the panel group. */
function useApplyLayout(
  groupRef: React.RefObject<GroupImperativeHandle | null>,
  layout: PaneLayout,
) {
  useEffect(() => {
    const group = groupRef.current
    if (!group) return

    const current = group.getLayout()
    if (Object.keys(current).length === 0) return
    const unchanged = Object.entries(layout).every(
      ([id, size]) => Math.round(current[id] ?? -1) === Math.round(size),
    )
    if (unchanged) return

    group.setLayout(layout)
  }, [groupRef, layout])
}

/** Mirrors the store's collapse flag onto the panel's imperative handle. */
function useApplyCollapse(
  panelRef: React.RefObject<PanelImperativeHandle | null>,
  collapsed: boolean,
  siblingCollapsed: boolean,
) {
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (collapsed && !panel.isCollapsed()) panel.collapse()
    if (!collapsed && panel.isCollapsed()) panel.expand()
  }, [panelRef, collapsed, siblingCollapsed])
}

/** Mirrors a drag-induced collapse back into the store. */
function syncCollapsed(
  panelRef: React.RefObject<PanelImperativeHandle | null>,
  collapsed: boolean,
  setCollapsed: (next: boolean) => void,
) {
  const panel = panelRef.current
  if (!panel) return
  const next = panel.isCollapsed()
  if (next !== collapsed) setCollapsed(next)
}
