import { Link } from '@tanstack/react-router'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ProjectId, RunId } from '@/api/types'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { LiveConnectionBadge } from '@/components/LiveConnectionBadge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ReportedText } from '@/i18n'
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
 * project, and the cockpit does not invent one — so the slug and the run id go
 * through `ReportedText` rather than through the catalogue.
 */
export function WorkspaceHeader({ projectId, runId }: WorkspaceHeaderProps) {
  const { t } = useTranslation('workspace')
  const leftCollapsed = useUiStore((state) => state.leftCollapsed)
  const rightCollapsed = useUiStore((state) => state.rightCollapsed)
  const toggleLeft = useUiStore((state) => state.toggleLeftCollapsed)
  const toggleRight = useUiStore((state) => state.toggleRightCollapsed)

  return (
    <header className="border-border bg-card flex h-11 shrink-0 items-center gap-3 border-b px-3">
      <PaneToggle
        label={t('pane.leftLabel')}
        collapsed={leftCollapsed}
        onToggle={toggleLeft}
        openIcon={PanelLeftClose}
        closedIcon={PanelLeftOpen}
      />

      <Separator orientation="vertical" className="h-5" />

      <nav
        aria-label={t('header.contextLabel')}
        className="flex min-w-0 items-baseline gap-2"
      >
        <Link
          to="/projects"
          className="text-muted-foreground hover:text-foreground rounded-sm text-xs"
        >
          {t('header.projectsLink')}
        </Link>
        <span aria-hidden="true" className="text-muted-foreground text-xs">
          /
        </span>
        <ReportedText value={projectId} className="truncate font-mono text-sm font-medium" />
        <span aria-hidden="true" className="text-muted-foreground text-xs">
          /
        </span>
        <ReportedText
          value={runId}
          className="text-muted-foreground truncate font-mono text-xs"
        />
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <LiveConnectionBadge />
        <Separator orientation="vertical" className="h-5" />
        {/*
          The workspace header is the cockpit's only persistent chrome, so the
          language switch sits here rather than in a settings screen — and it
          sits in the header's right cluster, next to the other two controls
          that are about *how* the cockpit is looked at rather than about the
          data. The pane toggle stays at the very edge, mirroring the left one.
        */}
        <LanguageSwitcher />
        <Separator orientation="vertical" className="h-5" />
        <PaneToggle
          label={t('pane.rightLabel')}
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
  const { t } = useTranslation('workspace')
  const Icon = collapsed ? ClosedIcon : OpenIcon
  // The pane's own name is interpolated into a whole sentence rather than
  // concatenated with a verb: German puts the verb last ("Inspector
  // ausklappen"), English puts it first ("Expand the inspector"), and only one
  // sentence per language can carry both.
  const tooltip = collapsed
    ? t('pane.expand', { pane: label })
    : t('pane.collapse', { pane: label })

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
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
