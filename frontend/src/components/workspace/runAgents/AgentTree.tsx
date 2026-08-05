import { ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentId, RunAgent } from '@/api/types'
import { EmptyState } from '@/components/AsyncState'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/state/uiStore'

import { AgentTreeItem } from './AgentTreeItem'
import {
  branchAgentIds,
  buildAgentTree,
  filterAgentTree,
  visibleAgentRows,
} from './agentHierarchy'
import {
  AGENT_STATUS_GLYPH,
  AGENT_STATUS_LABEL_KEY,
  reportedWorkState,
  statusTally,
} from './reporting'

export interface AgentTreeProps {
  agents: readonly RunAgent[]
  selectedAgentId: AgentId | null
  onSelectAgent: (agentId: AgentId) => void
}

/**
 * The agent/subagent hierarchy of one run.
 *
 * The rows are rendered as one flat list with an indent per level rather than
 * as nested lists: a run with many spawns then scrolls as a single column
 * instead of drifting to the right, and collapsing a branch is a change to which
 * rows are produced, not to the DOM structure around them.
 *
 * Three pieces of viewer state meet here, and they are kept apart on purpose:
 *
 * * **Which subtrees are folded** lives in the UI store (`collapsedAgentIds`)
 *   and is keyed by agent id, so a live event that adds a subagent cannot fold
 *   anything the user had opened.
 * * **Which row is selected** is local and transient — it is a property of
 *   looking at the run, not of the run (ADR 0003).
 * * **Which rows show their details** is local as well, and stored as an
 *   *override* rather than as the state itself: without an override a row
 *   follows the agent's own reported status (#39). A row the user opened
 *   therefore stays open when the next report arrives, and a row nobody touched
 *   follows the report. Nothing about it is persisted, because it describes a
 *   snapshot of the run rather than a layout preference.
 */
export function AgentTree({ agents, selectedAgentId, onSelectAgent }: AgentTreeProps) {
  const { t } = useTranslation('agents')
  const collapsedAgentIds = useUiStore((state) => state.collapsedAgentIds)
  const setAgentCollapsed = useUiStore((state) => state.setAgentCollapsed)
  const toggleAgentCollapsed = useUiStore((state) => state.toggleAgentCollapsed)
  const [filter, setFilter] = useState('')
  const [detailOverrides, setDetailOverrides] = useState<Record<AgentId, boolean>>({})

  const tree = useMemo(() => buildAgentTree(agents), [agents])
  const visibleRoots = useMemo(() => filterAgentTree(tree.roots, filter), [tree.roots, filter])
  const collapsedSet = useMemo(() => new Set(collapsedAgentIds), [collapsedAgentIds])
  const rows = useMemo(
    // A filtered view shows every match; collapsing only applies to the full tree.
    () => visibleAgentRows(visibleRoots, filter.trim() === '' ? collapsedSet : new Set()),
    [visibleRoots, collapsedSet, filter],
  )

  const branches = useMemo(() => branchAgentIds(tree.roots), [tree.roots])
  const allCollapsed = branches.length > 0 && branches.every((id) => collapsedSet.has(id))
  const tally = useMemo(() => statusTally(agents), [agents])

  const toggleDetail = useCallback(
    (agentId: AgentId) =>
      setDetailOverrides((current) => {
        const agent = agents.find((candidate) => candidate.agentId === agentId)
        const byReport = agent !== undefined && reportedWorkState(agent) === 'ongoing'
        return { ...current, [agentId]: !(current[agentId] ?? byReport) }
      }),
    [agents],
  )

  return (
    <div data-testid="agent-tree" className="space-y-2">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label={t('tree.filterLabel')}
            placeholder={t('tree.filterLabel')}
            className="border-input bg-background focus-visible:ring-ring h-7 w-full rounded-md border pr-2 pl-6 text-xs focus-visible:ring-2 focus-visible:outline-none"
          />
        </div>
        {branches.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="focus-visible:ring-ring shrink-0 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
            aria-label={allCollapsed ? t('tree.expandAll') : t('tree.collapseAll')}
            onClick={() => {
              for (const id of branches) setAgentCollapsed(id, !allCollapsed)
            }}
          >
            {allCollapsed ? (
              <ChevronsUpDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronsDownUp className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        )}
      </div>

      {/*
        How often each status word was reported. A count of reported values, in
        the same category as `run.counts` — never a share, never an aggregate of
        the agents' own percentages, which ADR 0011 rules out.
      */}
      {tally.length > 0 && (
        <p
          data-testid="agent-status-tally"
          // `relative` for the same reason as on an agent row: the `sr-only`
          // headline is absolutely positioned and needs a containing block
          // inside the scroll container.
          className="text-muted-foreground relative flex flex-wrap gap-x-2 gap-y-0.5 text-xs"
        >
          <span className="sr-only">{t('tree.statusTally')}: </span>
          {tally.map(({ status, count }) => (
            <span key={status || 'unreported'} data-tally-status={status}>
              <span aria-hidden="true" className="font-mono">
                {AGENT_STATUS_GLYPH[status]}
              </span>{' '}
              {count} × {t(AGENT_STATUS_LABEL_KEY[status])}
            </span>
          ))}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={t('tree.filterEmptyTitle')}
          description={t('tree.filterEmptyDescription', { filter: filter.trim() })}
        />
      ) : (
        <ul
          aria-label={t('tree.label')}
          data-max-depth={tree.maxDepth}
          className="divide-border/60 divide-y"
        >
          {rows.map(({ node, collapsed }) => (
            <AgentTreeItem
              key={node.agent.agentId}
              node={node}
              collapsed={collapsed}
              selected={node.agent.agentId === selectedAgentId}
              detailOpen={
                detailOverrides[node.agent.agentId] ??
                reportedWorkState(node.agent) === 'ongoing'
              }
              onToggleCollapsed={toggleAgentCollapsed}
              onToggleDetail={toggleDetail}
              onSelect={onSelectAgent}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
