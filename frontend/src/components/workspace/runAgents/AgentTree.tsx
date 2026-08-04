import { ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

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
 * Collapse state lives in the UI store (`collapsedAgentIds`) and is keyed by
 * agent id, so a live event that adds a subagent cannot fold anything the user
 * had opened. Selection is local and transient — it is a property of looking at
 * the run, not of the run (ADR 0003).
 */
export function AgentTree({ agents, selectedAgentId, onSelectAgent }: AgentTreeProps) {
  const collapsedAgentIds = useUiStore((state) => state.collapsedAgentIds)
  const setAgentCollapsed = useUiStore((state) => state.setAgentCollapsed)
  const toggleAgentCollapsed = useUiStore((state) => state.toggleAgentCollapsed)
  const [filter, setFilter] = useState('')

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
            aria-label="Agents filtern"
            placeholder="Agents filtern"
            className="border-input bg-background focus-visible:ring-ring h-7 w-full rounded-md border pr-2 pl-6 text-xs focus-visible:ring-2 focus-visible:outline-none"
          />
        </div>
        {branches.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={allCollapsed ? 'Alle Subagents ausklappen' : 'Alle Subagents einklappen'}
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

      {rows.length === 0 ? (
        <EmptyState
          title="Kein Agent passt zum Filter"
          description={`Kein Agent dieses Runs enthält „${filter.trim()}“.`}
        />
      ) : (
        <ul
          aria-label="Agenthierarchie"
          data-max-depth={tree.maxDepth}
          className="divide-border/60 divide-y"
        >
          {rows.map(({ node, collapsed }) => (
            <AgentTreeItem
              key={node.agent.agentId}
              node={node}
              collapsed={collapsed}
              selected={node.agent.agentId === selectedAgentId}
              onToggleCollapsed={toggleAgentCollapsed}
              onSelect={onSelectAgent}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
