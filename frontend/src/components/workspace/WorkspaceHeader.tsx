import { Link } from '@tanstack/react-router'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'

import type { ProjectId, RunId } from '@/api/types'
import { LiveConnectionBadge } from '@/components/LiveConnectionBadge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUiStore } from '@/state/uiStore'

export interface WorkspaceHeaderProps {
  projectId: ProjectId
  runId: RunId
}

/**
 * Top bar of the workspace: where you are, whether the stream is live and the
 * two independent pane toggles.
 *
 * The project is shown as its slug. The contract carries no display name for a
 * project, and the cockpit does not invent one.
 */
export function WorkspaceHeader({ projectId, runId }: WorkspaceHeaderProps) {
  const leftCollapsed = useUiStore((state) => state.leftCollapsed)
  const rightCollapsed = useUiStore((state) => state.rightCollapsed)
  const toggleLeft = useUiStore((state) => state.toggleLeftCollapsed)
  const toggleRight = useUiStore((state) => state.toggleRightCollapsed)

  return (
    <header className="border-border bg-card flex h-11 shrink-0 items-center gap-3 border-b px-3">
      <PaneToggle
        label="Run- und Agent-Bereich"
        collapsed={leftCollapsed}
        onToggle={toggleLeft}
        openIcon={PanelLeftClose}
        closedIcon={PanelLeftOpen}
      />

      <Separator orientation="vertical" className="h-5" />

      <nav aria-label="Kontext" className="flex min-w-0 items-baseline gap-2">
        <Link
          to="/projects"
          className="text-muted-foreground hover:text-foreground rounded-sm text-xs"
        >
          Projekte
        </Link>
        <span aria-hidden="true" className="text-muted-foreground text-xs">
          /
        </span>
        <span className="truncate font-mono text-sm font-medium">{projectId}</span>
        <span aria-hidden="true" className="text-muted-foreground text-xs">
          /
        </span>
        <span className="text-muted-foreground truncate font-mono text-xs">{runId}</span>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <LiveConnectionBadge />
        <Separator orientation="vertical" className="h-5" />
        <PaneToggle
          label="Inspector"
          collapsed={rightCollapsed}
          onToggle={toggleRight}
          openIcon={PanelRightClose}
          closedIcon={PanelRightOpen}
        />
      </div>
    </header>
  )
}

function PaneToggle({
  label,
  collapsed,
  onToggle,
  openIcon: OpenIcon,
  closedIcon: ClosedIcon,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
  openIcon: typeof PanelLeftClose
  closedIcon: typeof PanelLeftOpen
}) {
  const Icon = collapsed ? ClosedIcon : OpenIcon
  const action = collapsed ? 'ausklappen' : 'einklappen'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={label}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} {action}
      </TooltipContent>
    </Tooltip>
  )
}
