import { Trans, useTranslation } from 'react-i18next'

import { ReportedText, formatPercent, useFormattingLanguage } from '@/i18n'
import { cn } from '@/lib/utils'

import { progressStatement, type ProgressStatement, type StepCompletion } from './reporting'
import type { AgentProgress } from '@/api/types'

/**
 * Two renderings for two different kinds of statement, told apart by **shape**
 * rather than by colour.
 *
 * * **Counted facts** are drawn as a row of discrete segments. The reader can
 *   literally count them, because the underlying thing is countable: steps an
 *   agent explicitly marked done, in its own bounded task.
 * * **Reported claims** get no track and no fill at all. They are a quoted
 *   number, prefixed with `≈`, attributed to the agent that said it. There is
 *   nothing to measure against, so nothing is drawn as if there were.
 *
 * The two never share a container, never share a shape, and the distinction
 * survives greyscale — that is why it is geometry and not a colour. See
 * `docs/decisions/0011-run-and-agent-hierarchy.md`.
 */

/** Segments of the counted meter. Ten keeps a segment worth exactly 10 %. */
const METER_SEGMENTS = 10

export interface ReportedProgressProps {
  /** `null` when the agent never reported a number — say so, do not guess. */
  progress: AgentProgress | null
  /** Who reported it; a claim is always attributed. */
  reportedBy: string
  testId: string
}

/** The progress an agent reported about itself, in the form its claim allows. */
export function ReportedProgress({ progress, reportedBy, testId }: ReportedProgressProps) {
  const { t } = useTranslation('agents')

  if (progress === null) {
    return (
      <p
        data-testid={testId}
        data-progress-form="none"
        className="text-muted-foreground text-xs"
      >
        {t('progress.none')}
      </p>
    )
  }

  const statement = progressStatement(progress)

  return statement.form === 'counted' ? (
    <CountedProgress statement={statement} testId={testId} />
  ) : (
    <ClaimedProgress statement={statement} reportedBy={reportedBy} testId={testId} />
  )
}

/**
 * A countable quantity: one segment per tenth, filled from the left.
 *
 * This is the only progress rendering with `role="progressbar"`. The role
 * promises a measurable value between a known minimum and a known maximum, and
 * only counted steps of a bounded task keep that promise.
 */
function CountedProgress({
  statement,
  testId,
}: {
  statement: ProgressStatement
  testId: string
}) {
  const { t } = useTranslation('agents')
  const language = useFormattingLanguage()
  const percent = formatPercent(statement.percent, language)
  const filled = Math.round((statement.percent / 100) * METER_SEGMENTS)

  return (
    <div
      data-testid={testId}
      data-progress-group="counted"
      data-progress-form="counted"
      data-progress-scope={statement.scope}
      data-progress-basis={statement.basis}
      className="space-y-1"
    >
      <div
        role="progressbar"
        aria-valuenow={statement.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        // The percentage is already formatted for the reader's language (#40),
        // so it is interpolated as text and not as a number.
        aria-label={t('progress.meterLabel', {
          percent,
          subject: t(statement.subjectKey),
          derivation: t(statement.derivationKey),
        })}
        className="flex gap-0.5"
      >
        {Array.from({ length: METER_SEGMENTS }, (_, index) => (
          <span
            key={index}
            data-progress-segment=""
            data-filled={index < filled ? 'true' : 'false'}
            className={cn(
              'h-1.5 flex-1 rounded-[1px]',
              index < filled ? 'bg-state-applied' : 'bg-muted',
            )}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        <span className="text-foreground font-medium">{percent}</span>{' '}
        {t(statement.subjectKey)} · {t(statement.derivationKey)}
      </p>
    </div>
  )
}

/**
 * A reported claim: no track, no fill, no `progressbar` role.
 *
 * The `≈` and the attribution are part of the value, not decoration — they are
 * what keeps the number from being read as a measurement. An orchestrator's
 * estimate for the whole run lands here even when it says it counted steps,
 * because nothing in v0 can count the steps of a whole run.
 */
function ClaimedProgress({
  statement,
  reportedBy,
  testId,
}: {
  statement: ProgressStatement
  reportedBy: string
  testId: string
}) {
  const { t } = useTranslation('agents')
  const language = useFormattingLanguage()

  return (
    <div
      data-testid={testId}
      data-progress-group="claim"
      data-progress-form="claim"
      data-progress-scope={statement.scope}
      data-progress-basis={statement.basis}
      className="border-border/70 text-muted-foreground rounded-md border border-dashed px-2 py-1 text-xs"
    >
      <p>
        <span data-claim-marker="" aria-hidden="true" className="font-mono">
          ≈
        </span>{' '}
        <span data-claim-value="" className="text-foreground font-medium">
          {formatPercent(statement.percent, language)}
        </span>{' '}
        {t(statement.subjectKey)}
      </p>
      <p className="mt-0.5">
        {/*
          The attribution names the reporting agent inside the clause, which is
          the `<Trans>` case: the name is a prop of `ReportedText`, so it stays
          the agent's word in every language.
        */}
        <Trans
          ns="agents"
          i18nKey="progress.claimNote"
          values={{ derivation: t(statement.derivationKey) }}
          components={{ agent: <ReportedText value={reportedBy} /> }}
        />
      </p>
    </div>
  )
}

export interface CompletedStepsMeterProps {
  completion: StepCompletion
  /** Names what the steps belong to, e.g. `Revision 2`. */
  label: string
  testId: string
}

/**
 * The objective counterpart of `ReportedProgress`: one segment per plan step,
 * filled for every step the agent explicitly marked `done`.
 *
 * Same shape language as `CountedProgress` on purpose — both are counts of
 * reported facts. A revision without steps renders `0 von 0` and no segments
 * rather than an empty full-width track.
 */
export function CompletedStepsMeter({
  completion,
  label,
  testId,
}: CompletedStepsMeterProps) {
  const { t } = useTranslation('agents')

  return (
    <div
      data-testid={testId}
      data-progress-group="counted"
      data-progress-form="counted"
      data-progress-basis="completed_steps"
      className="space-y-1"
    >
      {completion.total > 0 && (
        <div
          role="progressbar"
          aria-valuenow={completion.done}
          aria-valuemin={0}
          aria-valuemax={completion.total}
          aria-label={t('steps.meterLabel', {
            label,
            done: completion.done,
            total: completion.total,
          })}
          className="flex gap-0.5"
        >
          {completion.states.map((state, index) => (
            <span
              key={index}
              data-progress-segment=""
              data-segment-state={state}
              data-filled={state === 'done' ? 'true' : 'false'}
              className={cn(
                'h-1.5 flex-1 rounded-[1px]',
                state === 'done' ? 'bg-state-applied' : 'bg-muted',
              )}
            />
          ))}
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        {t('steps.completed', { done: completion.done, total: completion.total })}
      </p>
    </div>
  )
}
