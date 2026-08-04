import { ChevronRight, CornerDownRight, RotateCcw, Unlink } from 'lucide-react'

import type { AgentId } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { AgentTreeNode } from './agentHierarchy'
import { ReportedProgress } from './ProgressDisplay'
import {
  AGENT_ROLE_LABEL,
  AGENT_STATUS_LABEL,
  OUTCOME_LABEL,
  formatTimestamp,
} from './reporting'

/** Indent per level, in pixels. Kept small so depth 5 still fits the pane. */
const INDENT_PX = 12

export interface AgentTreeItemProps {
  node: AgentTreeNode
  collapsed: boolean
  selected: boolean
  onToggleCollapsed: (agentId: AgentId) => void
  onSelect: (agentId: AgentId) => void
}

/**
 * One agent of the tree.
 *
 * The row always answers the four questions the issue asks for — role, assigned
 * task, last reported point in time, explicitly reported status — and answers
 * them with what was reported, including "nothing was". `lastEventAt` is a
 * timestamp and never a judgement: the pane does not compare it against a clock
 * and has no notion of an agent being late.
 */
export function AgentTreeItem({
  node,
  collapsed,
  selected,
  onToggleCollapsed,
  onSelect,
}: AgentTreeItemProps) {
  const { agent, depth, attachment, children, descendantCount } = node
  const hasChildren = children.length > 0
  const name = agent.displayName || agent.agentId

  return (
    <li
      data-testid={`agent-row-${agent.agentId}`}
      data-agent-id={agent.agentId}
      data-run-id={agent.runId}
      data-depth={depth}
      data-attachment={attachment}
      data-selected={selected ? 'true' : 'false'}
      className={cn(
        'border-l-2 py-1 pr-1',
        selected ? 'border-l-primary bg-accent/60' : 'border-l-transparent',
      )}
      style={{ paddingLeft: `${depth * INDENT_PX + 2}px` }}
    >
      <div className="flex items-start gap-1">
        {hasChildren ? (
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5 size-5 shrink-0"
            aria-expanded={!collapsed}
            aria-label={`Subagents von ${name} ${collapsed ? 'ausklappen' : 'einklappen'}`}
            onClick={() => onToggleCollapsed(agent.agentId)}
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', !collapsed && 'rotate-90')}
              aria-hidden="true"
            />
          </Button>
        ) : (
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            {depth > 0 && (
              <CornerDownRight
                className="text-muted-foreground/60 size-3"
                aria-hidden="true"
              />
            )}
          </span>
        )}

        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(agent.agentId)}
          className="focus-visible:ring-ring min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{name}</span>
            <Badge variant="outline" className="shrink-0 text-2xs font-normal">
              {AGENT_ROLE_LABEL[agent.role]}
            </Badge>
            {collapsed && descendantCount > 0 && (
              <Badge variant="secondary" className="shrink-0 text-2xs font-normal">
                +{descendantCount}
              </Badge>
            )}
          </span>

          <span className="text-muted-foreground block truncate font-mono text-2xs">
            {agent.agentId}
          </span>
        </button>
      </div>

      <div className="space-y-1.5 pt-1 pl-6">
        {attachment === 'orphaned' && (
          <AttachmentNote
            icon={Unlink}
            testId={`agent-orphaned-${agent.agentId}`}
            text={`Gemeldeter Parent „${agent.parentAgentId ?? ''}“ gehört nicht zu diesem Run. Der Agent wird als eigene Wurzel gezeigt.`}
          />
        )}
        {attachment === 'cycle_broken' && (
          <AttachmentNote
            icon={RotateCcw}
            testId={`agent-cycle-${agent.agentId}`}
            text={`Die gemeldete Parent-Kette läuft im Kreis. Die Kante zu „${agent.parentAgentId ?? ''}“ wurde hier getrennt; der Agent wird als eigene Wurzel gezeigt.`}
          />
        )}

        <dl className="space-y-0.5 text-2xs">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground shrink-0">Aufgabe</dt>
            <dd
              data-testid={`agent-task-${agent.agentId}`}
              className={cn('min-w-0', !agent.assignedTask && 'text-muted-foreground italic')}
            >
              {agent.assignedTask || 'keine Aufgabe gemeldet'}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground shrink-0">Status</dt>
            <dd
              data-testid={`agent-status-${agent.agentId}`}
              data-status={agent.status}
              className={cn('min-w-0', !agent.status && 'text-muted-foreground italic')}
            >
              {AGENT_STATUS_LABEL[agent.status]}
              {agent.statusNote && (
                <span className="text-muted-foreground"> — {agent.statusNote}</span>
              )}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground shrink-0">Zuletzt</dt>
            <dd
              data-testid={`agent-last-event-${agent.agentId}`}
              className="text-muted-foreground min-w-0 font-mono"
            >
              {formatTimestamp(agent.lastEventAt)}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground shrink-0">Abschluss</dt>
            <dd
              data-testid={`agent-outcome-${agent.agentId}`}
              data-outcome={agent.finishedOutcome ?? 'none'}
              className={cn('min-w-0', !agent.finishedOutcome && 'text-muted-foreground italic')}
            >
              {agent.finishedOutcome
                ? OUTCOME_LABEL[agent.finishedOutcome]
                : 'kein Abschluss gemeldet'}
            </dd>
          </div>
        </dl>

        <ReportedProgress
          progress={agent.progress}
          reportedBy={name}
          testId={`agent-progress-${agent.agentId}`}
        />
      </div>
    </li>
  )
}

function AttachmentNote({
  icon: Icon,
  text,
  testId,
}: {
  icon: typeof Unlink
  text: string
  testId: string
}) {
  return (
    <p
      data-testid={testId}
      className="border-state-planned/60 text-muted-foreground flex items-start gap-1 rounded-md border border-dashed px-1.5 py-1 text-2xs"
    >
      <Icon className="mt-px size-3 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  )
}
