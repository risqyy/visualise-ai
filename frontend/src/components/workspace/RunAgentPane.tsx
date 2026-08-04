import { Link } from '@tanstack/react-router'
import { ChevronRight, ListTree } from 'lucide-react'

import { useAgents, useRuns } from '@/api/queries'
import type { ProjectId, RunId, RunSummary } from '@/api/types'
import { AsyncState, EmptyState } from '@/components/AsyncState'
import { PaneHeader } from '@/components/workspace/PaneHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export interface RunAgentPaneProps {
  projectId: ProjectId
  runId: RunId
}

/**
 * Left pane: run selection and the agent hierarchy of the selected run.
 *
 * The shell owns the **navigation** between runs, because direct navigation to a
 * run is an acceptance criterion of this issue. The agent/subagent tree itself,
 * its progress rendering and the plan revisions are built in #11 — this pane
 * only provides the named region and the correct loading, error and empty
 * states for it. No agent data is invented here.
 */
export function RunAgentPane({ projectId, runId }: RunAgentPaneProps) {
  const runs = useRuns(projectId)
  const agents = useAgents(projectId, runId)

  const runList: RunSummary[] = runs.data?.pages.flatMap((page) => page.runs) ?? []
  const agentCount = agents.data?.agents.length ?? 0

  return (
    <section
      className="pane-surface"
      aria-label="Run- und Agent-Bereich"
      data-testid="pane-run-agents"
    >
      <PaneHeader title="Runs und Agents" subtitle={projectId} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <Collapsible defaultOpen>
            <div className="flex items-center justify-between gap-2">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-1.5 [&[data-state=open]>svg]:rotate-90"
                >
                  <ChevronRight className="size-3.5 transition-transform" aria-hidden="true" />
                  <span className="pane-heading">Runs</span>
                </Button>
              </CollapsibleTrigger>
              {runList.length > 0 && (
                <span className="text-muted-foreground text-2xs">
                  {runList.length} geladen
                </span>
              )}
            </div>

            <CollapsibleContent className="pt-1">
              <AsyncState
                isPending={runs.isPending}
                isError={runs.isError}
                error={runs.error}
                isEmpty={runList.length === 0}
                emptyTitle="Keine Runs gemeldet"
                emptyDescription="Sobald ein Orchestrator Ereignisse sendet, erscheint sein Run hier."
                onRetry={() => void runs.refetch()}
              >
                <ul className="space-y-1">
                  {runList.map((run) => (
                    <li key={run.runId}>
                      <RunLink projectId={projectId} run={run} active={run.runId === runId} />
                    </li>
                  ))}
                </ul>
                {runs.hasNextPage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 w-full"
                    disabled={runs.isFetchingNextPage}
                    onClick={() => void runs.fetchNextPage()}
                  >
                    {runs.isFetchingNextPage ? 'Lädt…' : 'Ältere Runs laden'}
                  </Button>
                )}
              </AsyncState>
            </CollapsibleContent>
          </Collapsible>

          <Separator />

          <section aria-label="Agenthierarchie" data-testid="agent-tree-region">
            <div className="flex items-center justify-between gap-2">
              <span className="pane-heading">Agenthierarchie</span>
              {agents.isSuccess && (
                <Badge variant="outline" className="text-2xs font-normal">
                  {agentCount} gemeldet
                </Badge>
              )}
            </div>

            <div className="pt-2">
              <AsyncState
                isPending={agents.isPending}
                isError={agents.isError}
                error={agents.error}
                isEmpty={agentCount === 0}
                emptyTitle="Keine Agents gemeldet"
                emptyDescription={`Für Run ${runId} liegt noch kein agent.started-Ereignis vor.`}
                onRetry={() => void agents.refetch()}
                skeletonRows={4}
              >
                <EmptyState
                  title="Agentbaum folgt"
                  description="Die Darstellung von Agents, Subagents, Fortschritt und Planrevisionen wird in einem eigenen Arbeitspaket ergänzt. Die Daten werden bereits geladen und live invalidiert."
                >
                  <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
                    <ListTree className="size-3.5" aria-hidden="true" />
                    {agentCount} Agents im Run {runId}
                  </p>
                </EmptyState>
              </AsyncState>
            </div>
          </section>
        </div>
      </ScrollArea>
    </section>
  )
}

function RunLink({
  projectId,
  run,
  active,
}: {
  projectId: ProjectId
  run: RunSummary
  active: boolean
}) {
  return (
    <Link
      to="/projects/$projectId/runs/$runId"
      params={{ projectId, runId: run.runId }}
      search={{}}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'hover:bg-accent focus-visible:ring-ring block rounded-md px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      <span className="block truncate font-mono text-xs">{run.runId}</span>
      <span className="text-muted-foreground flex items-center gap-1.5 text-2xs">
        {run.outcome ? (
          <>abgeschlossen: {run.outcome}</>
        ) : (
          <>ohne Terminalereignis</>
        )}
        <span aria-hidden="true">·</span>
        {run.agentCount} Agents
      </span>
    </Link>
  )
}
