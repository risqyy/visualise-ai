import { CircleAlert, CircleDashed, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ActiveChange, ReportedProblem, ReportedRisk } from '@/api/types'
import { EmptyState } from '@/components/AsyncState'
import { Badge } from '@/components/ui/badge'
import { ReportedText, ReportedTime } from '@/i18n'

import { RISK_SEVERITY_LABEL_KEY } from './formatting'

/**
 * Risks, problems and pending proposals of the selected run.
 *
 * All three are *statements of the reporting agent*. The contract is explicit:
 * "The system never derives, scores or aggregates risks; the human reviewer
 * judges." So severity is shown as the agent assessed it, with a label rather
 * than a colour ranking, and nothing here is sorted by how bad it looks.
 *
 * The badge shows the contract value (`low`, `medium`, `high`) unchanged; the
 * screen-reader line next to it spells out what that means, and *that* sentence
 * is the cockpit's own and translated.
 */

export function RiskList({ risks }: { risks: readonly ReportedRisk[] }) {
  const { t } = useTranslation('inspector')

  if (risks.length === 0) {
    return (
      <EmptyState title={t('risk.emptyTitle')} description={t('risk.emptyDescription')} />
    )
  }

  return (
    <ul className="space-y-1.5" data-testid="risk-entries">
      {risks.map((risk) => (
        <li
          key={risk.riskId}
          className="border-border rounded-md border px-2 py-1.5"
          data-testid="risk-entry"
        >
          <div className="flex items-center gap-1.5">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            <h4 className="min-w-0 flex-1 truncate text-xs font-semibold">
              <ReportedText value={risk.title} />
            </h4>
            <Badge variant="outline" className="text-2xs shrink-0 font-normal">
              <ReportedText value={risk.severity} />
            </Badge>
          </div>
          <p className="sr-only">
            {t('risk.severityLabel', {
              severity: t(RISK_SEVERITY_LABEL_KEY[risk.severity]),
            })}
          </p>
          {risk.detail.trim() !== '' && (
            <p className="mt-0.5 text-xs">
              <ReportedText value={risk.detail} />
            </p>
          )}
          <p className="text-muted-foreground text-2xs mt-0.5">
            <ReportedText value={risk.agentId} className="font-mono" />
            <span aria-hidden="true"> · </span>
            <ReportedTime value={risk.createdAt} />
          </p>
        </li>
      ))}
    </ul>
  )
}

export function ProblemList({ problems }: { problems: readonly ReportedProblem[] }) {
  const { t } = useTranslation('inspector')

  if (problems.length === 0) {
    return (
      <EmptyState
        title={t('problem.emptyTitle')}
        description={t('problem.emptyDescription')}
      />
    )
  }

  return (
    <ul className="space-y-1.5" data-testid="problem-entries">
      {problems.map((problem) => (
        <li
          key={problem.problemId}
          className="border-border rounded-md border px-2 py-1.5"
          data-testid="problem-entry"
        >
          <div className="flex items-center gap-1.5">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            <h4 className="min-w-0 flex-1 truncate text-xs font-semibold">
              <ReportedText value={problem.title} />
            </h4>
          </div>
          {problem.detail.trim() !== '' && (
            <p className="mt-0.5 text-xs">
              <ReportedText value={problem.detail} />
            </p>
          )}
          <p className="text-muted-foreground text-2xs mt-0.5">
            <ReportedText value={problem.agentId} className="font-mono" />
            <span aria-hidden="true"> · </span>
            <ReportedTime value={problem.createdAt} />
          </p>
        </li>
      ))}
    </ul>
  )
}

export function ActiveChangeList({ changes }: { changes: readonly ActiveChange[] }) {
  const { t } = useTranslation('inspector')

  if (changes.length === 0) {
    return (
      <EmptyState
        title={t('change.emptyTitle')}
        description={t('change.emptyDescription')}
      />
    )
  }

  return (
    <ul className="space-y-1.5" data-testid="active-change-entries">
      {changes.map((change) => (
        <li
          key={change.changeId}
          className="border-state-planned/60 rounded-md border px-2 py-1.5"
          data-testid="active-change-entry"
        >
          <div className="flex items-center gap-1.5">
            <CircleDashed className="text-state-planned size-3.5 shrink-0" aria-hidden="true" />
            <h4 className="min-w-0 flex-1 truncate font-mono text-xs">
              <ReportedText value={change.changeId} />
            </h4>
            {/* `operation`, `state` and `targetKind` are contract values. */}
            <Badge variant="outline" className="text-2xs shrink-0 font-normal">
              <ReportedText value={change.operation} />
            </Badge>
          </div>
          <p className="text-muted-foreground text-2xs mt-0.5">
            <ReportedText value={change.targetKind} />{' '}
            <ReportedText value={change.targetId} className="font-mono" />
            <span aria-hidden="true"> · </span>
            {t('change.stateLabel')} <ReportedText value={change.state} />
          </p>
          <p className="text-muted-foreground text-2xs mt-0.5">
            <ReportedText value={change.agentId} className="font-mono" />
            <span aria-hidden="true"> · </span>
            {t('change.plannedAt')} <ReportedTime value={change.plannedAt} />
          </p>
        </li>
      ))}
    </ul>
  )
}
