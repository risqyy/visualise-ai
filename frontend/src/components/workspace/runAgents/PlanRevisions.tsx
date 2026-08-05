import { useTranslation } from 'react-i18next'

import type { RunPlan, RunPlanRevision } from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { ReportedTime } from '@/i18n'
import { cn } from '@/lib/utils'

import { CompletedStepsMeter } from './ProgressDisplay'
import {
  PLAN_STEP_STATE_GLYPH,
  PLAN_STEP_STATE_LABEL,
  stepCompletion,
} from './reporting'

export interface PlanRevisionsProps {
  plans: readonly RunPlan[]
}

/**
 * Every plan of the run with **every** revision it ever had.
 *
 * Revisions are append-only by contract: a `plan.step_updated` only reaches the
 * revision that was current when it was reported, so an earlier revision keeps
 * exactly the step states it was last seen with. The pane renders that literally
 * — all revisions, ascending, each with all of its steps. Showing only the
 * current revision would make a re-plan invisible, and a re-plan is one of the
 * things a reviewer most needs to see.
 *
 * Older revisions are visually receded but never hidden and never collapsed
 * away: what changed between revision 1 and revision 2 has to be readable
 * without an interaction.
 */
export function PlanRevisions({ plans }: PlanRevisionsProps) {
  const { t } = useTranslation('common')

  return (
    <div data-testid="plan-revisions" className="space-y-3">
      {plans.map((plan) => (
        <article
          key={plan.planId}
          data-testid={`plan-${plan.planId}`}
          data-revision-count={plan.revisions.length}
          className="border-border rounded-md border"
        >
          <header className="border-border flex items-baseline gap-1.5 border-b px-2 py-1.5">
            <h4 className="truncate font-mono text-xs font-medium">{plan.planId}</h4>
            <span className="text-muted-foreground shrink-0 text-xs">
              {t('count.revision', { count: plan.revisions.length })}
            </span>
          </header>

          <ol aria-label={`Revisionen von ${plan.planId}`} className="divide-border divide-y">
            {[...plan.revisions]
              .sort((left, right) => left.revision - right.revision)
              .map((revision) => (
                <PlanRevisionEntry
                  key={revision.revision}
                  planId={plan.planId}
                  revision={revision}
                />
              ))}
          </ol>
        </article>
      ))}
    </div>
  )
}

function PlanRevisionEntry({
  planId,
  revision,
}: {
  planId: string
  revision: RunPlanRevision
}) {
  const completion = stepCompletion(revision)

  return (
    <li
      data-testid={`plan-revision-${planId}-${revision.revision}`}
      data-revision={revision.revision}
      data-current-revision={revision.isCurrent ? 'true' : 'false'}
      className={cn('space-y-1.5 px-2 py-2', !revision.isCurrent && 'bg-muted/30')}
    >
      <div className="flex items-baseline gap-1.5">
        <h5 className="text-xs font-medium">Revision {revision.revision}</h5>
        {revision.isCurrent ? (
          <Badge variant="secondary" className="font-normal">
            aktuell
          </Badge>
        ) : (
          <Badge variant="outline" className="font-normal">
            frühere Fassung
          </Badge>
        )}
      </div>

      <p className="pane-meta text-muted-foreground">
        <ReportedTime value={revision.createdAt} /> · {revision.createdByAgentId}
      </p>

      <CompletedStepsMeter
        completion={completion}
        label={`Revision ${revision.revision}`}
        testId={`plan-completion-${planId}-${revision.revision}`}
      />

      <ol className="space-y-0.5">
        {[...revision.steps]
          .sort((left, right) => left.order - right.order)
          .map((step) => (
            <li
              key={step.stepId}
              data-testid={`plan-step-${planId}-${revision.revision}-${step.stepId}`}
              data-step-state={step.state}
              className="flex items-baseline gap-1.5 text-xs"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'shrink-0 font-mono',
                  step.state === 'done' ? 'text-state-applied' : 'text-muted-foreground',
                )}
              >
                {PLAN_STEP_STATE_GLYPH[step.state]}
              </span>
              <span className="min-w-0 flex-1">{step.title}</span>
              <span className="text-muted-foreground shrink-0">
                {PLAN_STEP_STATE_LABEL[step.state]}
              </span>
            </li>
          ))}
      </ol>
    </li>
  )
}
