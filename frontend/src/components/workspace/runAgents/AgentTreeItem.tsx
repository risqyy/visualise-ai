import { ChevronDown, ChevronRight, CornerDownRight, RotateCcw, Unlink } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentId } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ReportedText as ReportedValue, ReportedTime } from '@/i18n'
import { cn } from '@/lib/utils'

import type { AgentTreeNode } from './agentHierarchy'
import { ReportedProgress } from './ProgressDisplay'
import { ClippedReportedText } from './ClippedReportedText'
import {
  AGENT_ROLE_LABEL_KEY,
  AGENT_STATUS_GLYPH,
  AGENT_STATUS_LABEL_KEY,
  OUTCOME_LABEL_KEY,
  reportedWorkState,
} from './reporting'

/** Indent per level, in pixels. Kept small so depth 5 still fits the pane. */
const INDENT_PX = 12

/**
 * The one focus treatment of this pane.
 *
 * Every control inside an agent card — subtree toggle, selection, detail
 * disclosure, "show the whole text" — carries exactly this, so focus looks the
 * same wherever the keyboard lands (#39). Hover and selection are properties of
 * the card and live on the `<li>`; focus is a property of the control and lives
 * here.
 */
const CONTROL_FOCUS =
  'focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none'

export interface AgentTreeItemProps {
  node: AgentTreeNode
  collapsed: boolean
  selected: boolean
  /** `true` while the row paints its full detail block. */
  detailOpen: boolean
  onToggleCollapsed: (agentId: AgentId) => void
  onToggleDetail: (agentId: AgentId) => void
  onSelect: (agentId: AgentId) => void
}

/**
 * One agent of the tree, in two densities.
 *
 * The row answers the same questions it always did — role, assigned task, last
 * reported point in time, explicitly reported status, reported progress — and
 * answers them with what was reported, including "nothing was". What changed
 * with #39 is the **order and the weight**, not the content:
 *
 * 1. **Who** — the agent's name, alone on the first line so the tree can be
 *    scanned vertically at a glance and the name has the whole row to shorten
 *    into.
 * 2. **What kind of agent, and what is it doing** — the reported role and the
 *    reported status, the status carried by a glyph *and* a word so it survives
 *    greyscale, followed by the reported status message.
 * 3. **What it was asked to do** — the assigned task, clipped to two lines.
 * 4. **Everything else** — progress, last reported timestamp, reported outcome
 *    and the agent id — behind one disclosure per row.
 *
 * A row opens that disclosure by default when the agent's own last status names
 * ongoing work (`reportedWorkState`). No clock is read to decide that, here or
 * anywhere below: an old timestamp is an old timestamp and never a verdict
 * (ADR 0011).
 *
 * Two things are deliberately *outside* the disclosure and always painted: the
 * reported status, because it is the sentence the row exists for, and the
 * attachment notes, because hiding a malformed parent reference would hide the
 * fact that the report was malformed.
 */
export function AgentTreeItem({
  node,
  collapsed,
  selected,
  detailOpen,
  onToggleCollapsed,
  onToggleDetail,
  onSelect,
}: AgentTreeItemProps) {
  const { t } = useTranslation('agents')
  const { agent, depth, attachment, children, descendantCount } = node
  const hasChildren = children.length > 0
  const name = agent.displayName || agent.agentId
  const workState = reportedWorkState(agent)
  const detailId = useId()

  return (
    <li
      data-testid={`agent-row-${agent.agentId}`}
      data-agent-id={agent.agentId}
      data-run-id={agent.runId}
      data-depth={depth}
      data-attachment={attachment}
      data-selected={selected ? 'true' : 'false'}
      data-work-state={workState}
      data-density={detailOpen ? 'detailed' : 'compact'}
      className={cn(
        // Hover, focus-within and selection are the same surface treatment, so
        // the three states of a card can never drift apart.
        //
        // `relative` is load-bearing: the row carries `sr-only` labels, and
        // `sr-only` is `position: absolute`. Without a positioned ancestor
        // *inside* the scroll container they would be laid out against the
        // ScrollArea root, escape its clipping and stretch the pane.
        'relative border-l-2 py-1 pr-1 transition-colors',
        'hover:bg-accent/30 has-[:focus-visible]:bg-accent/30',
        selected ? 'border-l-primary bg-accent/60' : 'border-l-transparent',
      )}
      style={{ paddingLeft: `${depth * INDENT_PX + 2}px` }}
    >
      <div className="flex items-start gap-1">
        {hasChildren ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('mt-px shrink-0', CONTROL_FOCUS)}
            aria-expanded={!collapsed}
            // The agent's reported name is interpolated into our sentence: an
            // `aria-label` holds a string, so markup cannot mark it (ADR 0014).
            aria-label={t(collapsed ? 'row.subtreeExpand' : 'row.subtreeCollapse', {
              agent: name,
            })}
            onClick={() => onToggleCollapsed(agent.agentId)}
          >
            <ChevronRight
              className={cn('transition-transform', !collapsed && 'rotate-90')}
              aria-hidden="true"
            />
          </Button>
        ) : (
          <span className="mt-px flex size-6 shrink-0 items-center justify-center">
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
          className={cn('min-w-0 flex-1 py-0.5 text-left', CONTROL_FOCUS)}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                'truncate text-sm',
                workState === 'ongoing'
                  ? 'text-foreground font-semibold'
                  : 'text-foreground/80 font-medium',
              )}
            >
              {/* Reported display name, or the reported id when there is none. */}
              <ReportedValue value={name} />
            </span>
            {collapsed && descendantCount > 0 && (
              <Badge variant="secondary" className="shrink-0 font-normal">
                +{descendantCount}
              </Badge>
            )}
          </span>
        </button>

        <Button
          variant="ghost"
          size="icon-xs"
          className={cn('mt-px shrink-0', CONTROL_FOCUS)}
          aria-expanded={detailOpen}
          aria-controls={detailId}
          aria-label={t(detailOpen ? 'row.detailHide' : 'row.detailShow', { agent: name })}
          data-testid={`agent-detail-toggle-${agent.agentId}`}
          onClick={() => onToggleDetail(agent.agentId)}
        >
          <ChevronDown
            className={cn('transition-transform', !detailOpen && '-rotate-90')}
            aria-hidden="true"
          />
        </Button>
      </div>

      <div className="space-y-1 pt-0.5 pl-7">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
          <Badge variant="outline" className="shrink-0 font-normal">
            {t(AGENT_ROLE_LABEL_KEY[agent.role])}
          </Badge>
          {/*
            The reported status cell: the status word and, when the agent sent
            one, its status message. Both belong to the same statement, so they
            stay in one element — `agent-status-<id>` is what the acceptance
            suite reads to check that a projection carries the accepted note.
          */}
          <span
            data-testid={`agent-status-${agent.agentId}`}
            data-status={agent.status}
            data-work-state={workState}
            className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5"
          >
            <span className="sr-only">{t('row.statusLabel')}: </span>
            <span
              className={cn(
                'shrink-0 rounded-sm px-1 py-px',
                workState === 'ongoing'
                  ? 'bg-secondary text-foreground font-medium'
                  : 'text-muted-foreground',
              )}
            >
              <span aria-hidden="true" className="font-mono">
                {AGENT_STATUS_GLYPH[agent.status]}
              </span>{' '}
              {t(AGENT_STATUS_LABEL_KEY[agent.status])}
            </span>
            {agent.statusNote && (
              <span className="text-muted-foreground min-w-0 flex-1">
                <ClippedReportedText
                  text={agent.statusNote}
                  subject={t('row.subjectStatusNote')}
                  agentName={name}
                  lines={detailOpen ? 3 : 1}
                  testId={`agent-status-note-${agent.agentId}`}
                />
              </span>
            )}
          </span>
        </div>

        <div
          className={cn('text-xs', !agent.assignedTask && 'text-muted-foreground italic')}
        >
          <span className="sr-only">{t('row.taskLabel')}: </span>
          {agent.assignedTask ? (
            <ClippedReportedText
              text={agent.assignedTask}
              subject={t('row.subjectTask')}
              agentName={name}
              lines={2}
              testId={`agent-task-${agent.agentId}`}
            />
          ) : (
            <span data-testid={`agent-task-${agent.agentId}`}>{t('row.noTask')}</span>
          )}
        </div>

        {attachment === 'orphaned' && (
          <AttachmentNote
            icon={Unlink}
            testId={`agent-orphaned-${agent.agentId}`}
            text={t('row.orphaned', { parent: agent.parentAgentId ?? '' })}
          />
        )}
        {attachment === 'cycle_broken' && (
          <AttachmentNote
            icon={RotateCcw}
            testId={`agent-cycle-${agent.agentId}`}
            text={t('row.cycleBroken', { parent: agent.parentAgentId ?? '' })}
          />
        )}

        {detailOpen && (
          <div id={detailId} className="space-y-1.5 pt-0.5">
            <ReportedProgress
              progress={agent.progress}
              reportedBy={name}
              testId={`agent-progress-${agent.agentId}`}
            />

            <dl className="space-y-0.5 text-xs">
              <DetailRow label={t('row.lastEventLabel')}>
                {/*
                  "Zuletzt gemeldet" asks how long ago, so the relative phrase
                  leads and the exact UTC instant travels with it in `title`,
                  `aria-label` and `datetime` (#40). It is a rendering of the
                  reported instant and never a verdict about it.
                */}
                <span
                  data-testid={`agent-last-event-${agent.agentId}`}
                  className="pane-meta text-muted-foreground"
                >
                  <ReportedTime
                    value={agent.lastEventAt}
                    display="relative"
                    className="pane-meta"
                  />
                </span>
              </DetailRow>
              <DetailRow label={t('row.outcomeLabel')}>
                <span
                  data-testid={`agent-outcome-${agent.agentId}`}
                  data-outcome={agent.finishedOutcome ?? 'none'}
                  className={cn(!agent.finishedOutcome && 'text-muted-foreground italic')}
                >
                  {agent.finishedOutcome
                    ? t(OUTCOME_LABEL_KEY[agent.finishedOutcome])
                    : t('row.noOutcome')}
                </span>
              </DetailRow>
              <DetailRow label={t('row.agentIdLabel')}>
                <ReportedValue
                  value={agent.agentId}
                  className="pane-meta text-muted-foreground block truncate"
                />
              </DetailRow>
            </dl>
          </div>
        )}
      </div>
    </li>
  )
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground w-24 shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
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
      className="border-state-planned/60 text-muted-foreground flex items-start gap-1 rounded-md border border-dashed px-1.5 py-1 text-xs"
    >
      <Icon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  )
}
