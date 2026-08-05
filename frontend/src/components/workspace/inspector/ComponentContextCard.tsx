import { Bot, Hammer } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type {
  AppliedComponent,
  InspectorWorkStep,
  RunAgent,
  RunId,
} from '@/api/types'
import { Badge } from '@/components/ui/badge'
import { componentKindLabel } from '@/canvas/componentKinds'
import {
  ReportedText,
  ReportedTime,
  formatPercent,
  useFormattingLanguage,
} from '@/i18n'

import { INSPECTOR_AGENT_STATUS_LABEL_KEY, orNotReported } from './formatting'

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
 *
 * Two values are deliberately shown **as the contract sends them** and not
 * translated: the agent's `role` and its `finishedOutcome`. They are wire
 * values, and the technical glossary in `src/i18n/README.md` records why. What
 * *is* translated is the closed status vocabulary, which the agent tree paints
 * as a word too — the same word, from the same catalogue entry.
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
  const { t } = useTranslation('inspector')
  const { t: tAgents } = useTranslation('agents')
  const { t: tCanvas } = useTranslation('canvas')
  const language = useFormattingLanguage()

  return (
    <section
      className="border-border space-y-2 rounded-md border p-2"
      aria-label={t('context.label')}
      data-testid="inspector-context"
      data-run-id={runId ?? ''}
      data-component-id={componentId}
      data-agent-id={responsibleAgent?.agentId ?? ''}
    >
      <div className="space-y-0.5">
        <h3 className="truncate text-sm font-semibold">
          <ReportedText value={component ? component.name : componentId} />
        </h3>
        <p className="text-muted-foreground truncate font-mono text-2xs">
          <ReportedText value={componentId} />
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {component ? (
          <Badge variant="outline" className="text-2xs font-normal">
            {componentKindLabel(component.kind, tCanvas)}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-2xs font-normal">
            {t('context.notInModel')}
          </Badge>
        )}
        <Badge variant="secondary" className="text-2xs font-normal">
          {t('meta.runPrefix')}{' '}
          {/*
            `common:time.notReported` is about an instant; a missing run is a
            missing *value*, and the inspector owns that sentence.
          */}
          {runId === null ? t('context.runNotReported') : <ReportedText value={runId} />}
        </Badge>
      </div>

      {component && component.description.trim() !== '' && (
        <p className="text-muted-foreground text-xs">
          <ReportedText value={component.description} />
        </p>
      )}

      {!component && (
        <p className="text-muted-foreground text-xs">{t('context.notInModelNote')}</p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground flex items-center gap-1">
          <Bot className="size-3.5" aria-hidden="true" />
          {t('context.agentLabel')}
        </dt>
        <dd data-testid="responsible-agent" className="min-w-0">
          {responsibleAgent ? (
            <>
              <span className="font-medium">
                <ReportedText
                  value={orNotReported(
                    responsibleAgent.displayName,
                    responsibleAgent.agentId,
                  )}
                />
              </span>
              <span className="text-muted-foreground">
                {' '}
                (
                {responsibleAgent.role === '' ? (
                  t('context.roleNotReported')
                ) : (
                  <ReportedText value={responsibleAgent.role} />
                )}
                )
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t('context.noAgent')}</span>
          )}
        </dd>

        {responsibleAgent && (
          <>
            <dt className="text-muted-foreground">{t('context.taskLabel')}</dt>
            <dd className="min-w-0" data-testid="agent-assigned-task">
              {/* The assigned task is the agent's own paragraph. Verbatim. */}
              {responsibleAgent.assignedTask.trim() === '' ? (
                t('context.noTask')
              ) : (
                <ReportedText value={responsibleAgent.assignedTask} />
              )}
            </dd>

            <dt className="text-muted-foreground">{t('context.statusLabel')}</dt>
            <dd className="min-w-0" data-testid="agent-status">
              {tAgents(INSPECTOR_AGENT_STATUS_LABEL_KEY[responsibleAgent.status])}
              {responsibleAgent.statusNote.trim() !== '' && (
                <span className="text-muted-foreground">
                  {' '}
                  — <ReportedText value={responsibleAgent.statusNote} />
                </span>
              )}
              {responsibleAgent.progress && (
                <span className="text-muted-foreground">
                  {' '}
                  · {formatPercent(responsibleAgent.progress.percent, language)}{' '}
                  {t('context.selfReported')}
                </span>
              )}
              {responsibleAgent.finishedOutcome && (
                <span className="text-muted-foreground">
                  {' '}
                  · {t('context.finished')}{' '}
                  <ReportedText value={responsibleAgent.finishedOutcome} />
                </span>
              )}
            </dd>
          </>
        )}

        <dt className="text-muted-foreground flex items-center gap-1">
          <Hammer className="size-3.5" aria-hidden="true" />
          {t('context.workStepLabel')}
        </dt>
        <dd className="min-w-0" data-testid="current-work-step">
          {currentWorkStep ? (
            <>
              <span className="font-medium">
                <ReportedText value={currentWorkStep.title} />
              </span>
              <span className="text-muted-foreground block text-2xs">
                {/*
                  Label and instant stay separate rather than interpolated:
                  `<ReportedTime>` is an element, and it is what carries the
                  UTC label, the exact value in `dateTime` and the relative
                  reading (#40, ADR 0019).
                */}
                {currentWorkStep.completedAt ? (
                  <>
                    {t('context.workStepCompleted')}{' '}
                    <ReportedTime value={currentWorkStep.completedAt} />
                  </>
                ) : (
                  <>
                    {t('context.workStepOpen')}{' '}
                    <ReportedTime value={currentWorkStep.startedAt} />
                  </>
                )}
              </span>
              {currentWorkStep.summary && (
                <span className="text-muted-foreground block">
                  <ReportedText value={currentWorkStep.summary} />
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">{t('context.noWorkStep')}</span>
          )}
        </dd>
      </dl>
    </section>
  )
}
