import { Bot, Hammer } from 'lucide-react'

import type {
  AppliedComponent,
  InspectorWorkStep,
  RunAgent,
  RunId,
} from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { componentKindStyle } from '@/canvas/componentKinds'

import { AGENT_STATUS_LABELS, formatTimestamp, orNotReported } from './formatting'

/**
 * Who is doing what, where, in which run.
 *
 * This block answers the question the issue starts from — "which agent is doing
 * what here" — before any evidence is shown, and it is the run context that
 * must survive a live update untouched.
 *
 * Everything is read from the response and nothing is inferred. The contract is
 * explicit that `responsibleAgent` is "read from evidence, not guessed" and that
 * an agent's `status` "stays empty until `agent.status_reported` arrives".
 * A missing value is therefore rendered as missing.
 */

export interface ComponentContextCardProps {
  componentId: string
  component: AppliedComponent | null
  responsibleAgent: RunAgent | null
  currentWorkStep: InspectorWorkStep | null
  /** The run the evidence below belongs to; `null` before any run exists. */
  runId: RunId | null
}

export function ComponentContextCard({
  componentId,
  component,
  responsibleAgent,
  currentWorkStep,
  runId,
}: ComponentContextCardProps) {
  return (
    <section
      className="border-border space-y-2 rounded-md border p-2"
      aria-label="Komponentenkontext"
      data-testid="inspector-context"
      data-run-id={runId ?? ''}
      data-component-id={componentId}
      data-agent-id={responsibleAgent?.agentId ?? ''}
    >
      <div className="space-y-0.5">
        <h3 className="truncate text-sm font-semibold">
          {component ? component.name : componentId}
        </h3>
        <p className="text-muted-foreground truncate font-mono text-2xs">{componentId}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {component ? (
          <Badge variant="outline" className="text-2xs font-normal">
            {componentKindStyle(component.kind).label}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-2xs font-normal">
            nicht im angewandten Modell
          </Badge>
        )}
        <Badge variant="secondary" className="text-2xs font-normal">
          Run {runId ?? 'nicht gemeldet'}
        </Badge>
      </div>

      {component && component.description.trim() !== '' && (
        <p className="text-muted-foreground text-xs">{component.description}</p>
      )}

      {!component && (
        <p className="text-muted-foreground text-xs">
          Die Komponente ist nicht mehr Teil des angewandten Architekturmodells. Belege
          und Historie bleiben erhalten.
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground flex items-center gap-1">
          <Bot className="size-3.5" aria-hidden="true" />
          Agent
        </dt>
        <dd data-testid="responsible-agent" className="min-w-0">
          {responsibleAgent ? (
            <>
              <span className="font-medium">
                {orNotReported(responsibleAgent.displayName, responsibleAgent.agentId)}
              </span>
              <span className="text-muted-foreground">
                {' '}
                ({responsibleAgent.role === '' ? 'Rolle nicht gemeldet' : responsibleAgent.role})
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Kein verantwortlicher Agent belegt.
            </span>
          )}
        </dd>

        {responsibleAgent && (
          <>
            <dt className="text-muted-foreground">Aufgabe</dt>
            <dd className="min-w-0" data-testid="agent-assigned-task">
              {orNotReported(responsibleAgent.assignedTask, 'Keine Aufgabe gemeldet.')}
            </dd>

            <dt className="text-muted-foreground">Status</dt>
            <dd className="min-w-0" data-testid="agent-status">
              {AGENT_STATUS_LABELS[responsibleAgent.status]}
              {responsibleAgent.statusNote.trim() !== '' && (
                <span className="text-muted-foreground"> — {responsibleAgent.statusNote}</span>
              )}
              {responsibleAgent.progress && (
                <span className="text-muted-foreground">
                  {' '}
                  · {responsibleAgent.progress.percent} % selbst gemeldet
                </span>
              )}
              {responsibleAgent.finishedOutcome && (
                <span className="text-muted-foreground">
                  {' '}
                  · beendet: {responsibleAgent.finishedOutcome}
                </span>
              )}
            </dd>
          </>
        )}

        <dt className="text-muted-foreground flex items-center gap-1">
          <Hammer className="size-3.5" aria-hidden="true" />
          Arbeitsschritt
        </dt>
        <dd className="min-w-0" data-testid="current-work-step">
          {currentWorkStep ? (
            <>
              <span className="font-medium">{currentWorkStep.title}</span>
              <span className="text-muted-foreground block text-2xs">
                {currentWorkStep.completedAt
                  ? `abgeschlossen ${formatTimestamp(currentWorkStep.completedAt)}`
                  : `offen seit ${formatTimestamp(currentWorkStep.startedAt)}`}
              </span>
              {currentWorkStep.summary && (
                <span className="text-muted-foreground block">{currentWorkStep.summary}</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              Kein Arbeitsschritt hat diese Komponente in diesem Run genannt.
            </span>
          )}
        </dd>
      </dl>
    </section>
  )
}
