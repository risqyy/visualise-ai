import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useCurrentRun } from '@/api/currentRun'
import { useAgents, usePlans, useRun, useRuns } from '@/api/queries'
import type { AgentId, ProjectId, RunId, RunSummary } from '@/api/types'
import { AsyncState } from '@/components/AsyncState'
import { PaneHeader } from '@/components/workspace/PaneHeader'
import { AgentTree } from '@/components/workspace/runAgents/AgentTree'
import { PlanRevisions } from '@/components/workspace/runAgents/PlanRevisions'
import { RunSelector } from '@/components/workspace/runAgents/RunSelector'
import { OUTCOME_LABEL } from '@/components/workspace/runAgents/reporting'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { ReportedTime } from '@/i18n'

export interface RunAgentPaneProps {
  projectId: ProjectId
  runId: RunId
}

/**
 * Left pane: run selection, the agent/subagent hierarchy and the plans of the
 * selected run.
 *
 * Four rules hold across everything below, and each of them is a rule about what
 * the pane must *not* do:
 *
 * 1. **Nothing is derived from silence.** A run without `run.finished` is open
 *    and shows its last reported values. There is no timeout, no heuristic and
 *    no "seems stuck" anywhere in this subtree — `lastEventAt` is rendered as a
 *    timestamp and never compared against a clock.
 * 2. **A historical run never overlays the current one.** Looking at an older
 *    run is a different URL, announced by a banner that carries the way back.
 * 3. **Estimates and counted facts keep different shapes.** See
 *    `runAgents/ProgressDisplay.tsx`.
 * 4. **Live events invalidate narrowly.** The queries below are keyed per run
 *    (ADR 0003), so an `agent.progress_reported` refetches this run's agent list
 *    and nothing else. Selection and collapse state live outside the cache, so a
 *    refetch cannot move them.
 * 5. **Density never removes anything.** Long reported texts are clipped by CSS
 *    and stay complete in the DOM, and a compact agent row is one keystroke away
 *    from its full detail. What a row shows first follows the agent's *own*
 *    reported status — never elapsed time (#39, ADR 0014).
 */
export function RunAgentPane({ projectId, runId }: RunAgentPaneProps) {
  const { t } = useTranslation('common')
  const runs = useRuns(projectId)
  const currentRun = useCurrentRun(projectId)
  const run = useRun(projectId, runId)
  const agents = useAgents(projectId, runId)
  const plans = usePlans(projectId, runId)

  // Selection is transient by design (ADR 0003): it describes this tab looking
  // at the run, not the run. Keeping it in component state is also what makes a
  // live refetch harmless — the query cache changes, this value does not.
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null)

  const runList: RunSummary[] = runs.data?.pages.flatMap((page) => page.runs) ?? []
  const agentList = agents.data?.agents ?? []
  const planList = plans.data?.plans ?? []

  return (
    <section
      className="pane-surface"
      aria-label="Run- und Agent-Bereich"
      data-testid="pane-run-agents"
      data-run-id={runId}
    >
      <PaneHeader title="Runs und Agents" subtitle={projectId} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <Section
            title="Runs"
            count={runList.length > 0 ? `${runList.length} geladen` : null}
          >
            <RunSelector
              projectId={projectId}
              runId={runId}
              currentRun={currentRun.data}
              runs={runList}
              isPending={runs.isPending}
              isError={runs.isError}
              error={runs.error}
              hasNextPage={runs.hasNextPage}
              isFetchingNextPage={runs.isFetchingNextPage}
              onFetchNextPage={() => void runs.fetchNextPage()}
              onRetry={() => void runs.refetch()}
            />
          </Section>

          <Separator />

          <section aria-label="Gemeldeter Runzustand" data-testid="run-state">
            <span className="pane-heading">Runzustand</span>
            <div className="pt-1">
              <AsyncState
                isPending={run.isPending}
                isError={run.isError}
                error={run.error}
                emptyTitle="Run nicht verfügbar"
                onRetry={() => void run.refetch()}
                skeletonRows={2}
              >
                {run.data && (
                  <dl className="space-y-0.5 text-xs">
                    <Row label="Run">
                      <span className="pane-meta">{run.data.run.runId}</span>
                    </Row>
                    <Row label="Zustand">
                      <span
                        data-testid="run-openness"
                        data-open={run.data.run.isOpen ? 'true' : 'false'}
                      >
                        {run.data.run.isOpen
                          ? 'offen — kein Terminalereignis gemeldet'
                          : `beendet: ${
                              run.data.run.outcome
                                ? OUTCOME_LABEL[run.data.run.outcome]
                                : 'ohne gemeldetes Ergebnis'
                            }`}
                      </span>
                    </Row>
                    <Row label="Beginn">
                      <ReportedTime value={run.data.run.startedAt} className="pane-meta" />
                    </Row>
                    <Row label="Ende">
                      {/*
                        A timestamp is metadata and may be 11 px; "nothing was
                        reported" is a sentence and is not (#39).
                      */}
                      {run.data.run.finishedAt ? (
                        <ReportedTime value={run.data.run.finishedAt} className="pane-meta" />
                      ) : (
                        <span className="text-muted-foreground">kein Ende gemeldet</span>
                      )}
                    </Row>
                    <Row label="Umfang">
                      {t('count.agent', { count: run.data.run.counts.agents })} ·{' '}
                      {t('count.plan', { count: run.data.run.counts.plans })} ·{' '}
                      {t('count.workStep', { count: run.data.run.counts.workSteps })}
                    </Row>
                  </dl>
                )}
              </AsyncState>
            </div>
          </section>

          <Separator />

          <section aria-label="Agenthierarchie" data-testid="agent-tree-region">
            <div className="flex items-center justify-between gap-2">
              <span className="pane-heading">Agenthierarchie</span>
              {agents.isSuccess && (
                <Badge variant="outline" className="font-normal">
                  {agentList.length} gemeldet
                </Badge>
              )}
            </div>

            <div className="pt-2">
              <AsyncState
                isPending={agents.isPending}
                isError={agents.isError}
                error={agents.error}
                isEmpty={agentList.length === 0}
                emptyTitle="Keine Agents gemeldet"
                emptyDescription={`Für Run ${runId} liegt noch kein agent.started-Ereignis vor.`}
                onRetry={() => void agents.refetch()}
                skeletonRows={4}
              >
                <AgentTree
                  agents={agentList}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={setSelectedAgentId}
                />
              </AsyncState>
            </div>
          </section>

          <Separator />

          <Section title="Pläne" count={planList.length > 0 ? `${planList.length}` : null}>
            <AsyncState
              isPending={plans.isPending}
              isError={plans.isError}
              error={plans.error}
              isEmpty={planList.length === 0}
              emptyTitle="Kein Plan veröffentlicht"
              emptyDescription={`Für Run ${runId} liegt noch kein plan.published-Ereignis vor.`}
              onRetry={() => void plans.refetch()}
              skeletonRows={3}
            >
              <PlanRevisions plans={planList} />
            </AsyncState>
          </Section>
        </div>
      </ScrollArea>
    </section>
  )
}

/** A collapsible block of the pane, with the same header row everywhere. */
function Section({
  title,
  count,
  children,
}: {
  title: string
  count: string | null
  children: ReactNode
}) {
  return (
    <Collapsible defaultOpen>
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-1.5 [&[data-state=open]>svg]:rotate-90"
          >
            <ChevronRight className="size-3.5 transition-transform" aria-hidden="true" />
            <span className="pane-heading">{title}</span>
          </Button>
        </CollapsibleTrigger>
        {count && <span className="text-muted-foreground text-xs">{count}</span>}
      </div>
      <CollapsibleContent className="pt-1">{children}</CollapsibleContent>
    </Collapsible>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground w-16 shrink-0">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
