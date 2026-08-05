import { Link } from '@tanstack/react-router'
import { History, Radio } from 'lucide-react'

import type { ProjectId, RunDetail, RunId, RunSummary } from '@/api/types'
import { AsyncState, EmptyState } from '@/components/AsyncState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ReportedTime } from '@/i18n'
import { cn } from '@/lib/utils'

import { OUTCOME_LABEL } from './reporting'

export interface RunSelectorProps {
  projectId: ProjectId
  /** The run the workspace is currently showing. */
  runId: RunId
  /** `null` when the project has no current run, `undefined` while loading. */
  currentRun: RunDetail | null | undefined
  runs: readonly RunSummary[]
  isPending: boolean
  isError: boolean
  error: unknown
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onFetchNextPage: () => void
  onRetry: () => void
}

/**
 * Run selection for one project.
 *
 * The current run is the default, and it is resolved through `/runs/current`
 * rather than by scanning the paged list (see `src/api/currentRun.ts`).
 * Historical runs are one click away, but selecting one is an explicit
 * navigation to a different URL — it never merges into the current view. When
 * the shown run is not the current one the pane says so before anything else and
 * offers the way back, so a historical view can never be mistaken for live.
 */
export function RunSelector({
  projectId,
  runId,
  currentRun,
  runs,
  isPending,
  isError,
  error,
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
  onRetry,
}: RunSelectorProps) {
  const showingCurrentRun = currentRun != null && currentRun.runId === runId

  return (
    <div className="space-y-2">
      {currentRun === null && (
        <div data-testid="no-current-run">
          <EmptyState
            title="Kein aktueller Run"
            description="Für dieses Projekt hat noch kein Root-Orchestrator einen Run eröffnet."
          />
        </div>
      )}

      {currentRun && !showingCurrentRun && (
        <div
          data-testid="historical-run-banner"
          role="status"
          className="border-state-planned bg-state-planned/10 space-y-1.5 rounded-md border px-2 py-1.5"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <History className="size-3.5 shrink-0" aria-hidden="true" />
            Historischer Run
          </p>
          <p className="text-muted-foreground text-xs">
            Diese Ansicht zeigt einen abgelegten Run, nicht den aktuellen. Aktuell ist{' '}
            <span className="font-mono">{currentRun.runId}</span>.
          </p>
          <Button asChild variant="outline" size="xs" className="w-full">
            <Link
              to="/projects/$projectId/runs/$runId"
              params={{ projectId, runId: currentRun.runId }}
              search={{}}
              data-testid="back-to-current-run"
            >
              <Radio className="size-3" aria-hidden="true" />
              Zum aktuellen Run wechseln
            </Link>
          </Button>
        </div>
      )}

      {currentRun && showingCurrentRun && (
        <p
          data-testid="current-run-banner"
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <Radio className="text-state-applied size-3.5 shrink-0" aria-hidden="true" />
          Aktueller Run des Projekts
        </p>
      )}

      <AsyncState
        isPending={isPending}
        isError={isError}
        error={error}
        isEmpty={runs.length === 0}
        emptyTitle="Keine Runs gemeldet"
        emptyDescription="Sobald ein Orchestrator Ereignisse sendet, erscheint sein Run hier."
        onRetry={onRetry}
      >
        <ul aria-label="Runs des Projekts" className="space-y-1">
          {runs.map((run) => (
            <li key={run.runId}>
              <RunLink projectId={projectId} run={run} shown={run.runId === runId} />
            </li>
          ))}
        </ul>
        {hasNextPage && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            disabled={isFetchingNextPage}
            onClick={onFetchNextPage}
          >
            {isFetchingNextPage ? 'Lädt…' : 'Ältere Runs laden'}
          </Button>
        )}
      </AsyncState>
    </div>
  )
}

/**
 * One run of the list.
 *
 * An open run is described as open — never as running, hanging or stalled. The
 * contract closes a run only on an explicit `run.finished`, and silence is not a
 * terminal state, so the label says exactly that.
 */
function RunLink({
  projectId,
  run,
  shown,
}: {
  projectId: ProjectId
  run: RunSummary
  shown: boolean
}) {
  return (
    <Link
      to="/projects/$projectId/runs/$runId"
      params={{ projectId, runId: run.runId }}
      search={{}}
      aria-current={shown ? 'page' : undefined}
      data-testid={`run-option-${run.runId}`}
      data-current={run.isCurrent ? 'true' : 'false'}
      data-open={run.isOpen ? 'true' : 'false'}
      className={cn(
        'hover:bg-accent focus-visible:ring-ring block rounded-md px-2 py-1.5 focus-visible:ring-2 focus-visible:outline-none',
        shown && 'bg-accent text-accent-foreground',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-xs">{run.runId}</span>
        {run.isCurrent && (
          <Badge variant="secondary" className="shrink-0 font-normal">
            aktuell
          </Badge>
        )}
      </span>
      <span className="text-muted-foreground block text-xs">
        {run.isOpen
          ? 'offen — kein Terminalereignis gemeldet'
          : `beendet: ${run.outcome ? OUTCOME_LABEL[run.outcome] : 'ohne gemeldetes Ergebnis'}`}
      </span>
      <span className="pane-meta text-muted-foreground block">
        seit <ReportedTime value={run.startedAt} />
      </span>
      <span className="text-muted-foreground block text-xs">
        {/*
          `RunSummary` carries no agent count — only `RunDetail.counts` does, on
          a different endpoint. The root agent is what the summary reports.
        */}
        Root: {run.rootAgentId ?? 'kein Root-Agent gemeldet'}
      </span>
    </Link>
  )
}
