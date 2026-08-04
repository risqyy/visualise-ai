import { CircleAlert, CircleDashed, TriangleAlert } from 'lucide-react'

import type { ActiveChange, ReportedProblem, ReportedRisk, RiskSeverity } from '@/api/types'
import { EmptyState } from '@/components/AsyncState'
import { Badge } from '@/components/ui/badge'

import { formatTimestamp } from './formatting'

/**
 * Risks, problems and pending proposals of the selected run.
 *
 * All three are *statements of the reporting agent*. The contract is explicit:
 * "The system never derives, scores or aggregates risks; the human reviewer
 * judges." So severity is shown as the agent assessed it, with a label rather
 * than a colour ranking, and nothing here is sorted by how bad it looks.
 */

const SEVERITY_LABELS: Record<RiskSeverity, string> = {
  low: 'gering (vom Agenten eingeschätzt)',
  medium: 'mittel (vom Agenten eingeschätzt)',
  high: 'hoch (vom Agenten eingeschätzt)',
}

export function RiskList({ risks }: { risks: readonly ReportedRisk[] }) {
  if (risks.length === 0) {
    return (
      <EmptyState
        title="Keine Risiken gemeldet"
        description="Für diese Komponente wurde in diesem Run kein risk.reported gemeldet."
      />
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
            <h4 className="min-w-0 flex-1 truncate text-xs font-semibold">{risk.title}</h4>
            <Badge variant="outline" className="text-2xs shrink-0 font-normal">
              {risk.severity}
            </Badge>
          </div>
          <p className="sr-only">Schweregrad: {SEVERITY_LABELS[risk.severity]}</p>
          {risk.detail.trim() !== '' && <p className="mt-0.5 text-xs">{risk.detail}</p>}
          <p className="text-muted-foreground text-2xs mt-0.5">
            <span className="font-mono">{risk.agentId}</span>
            <span aria-hidden="true"> · </span>
            {formatTimestamp(risk.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  )
}

export function ProblemList({ problems }: { problems: readonly ReportedProblem[] }) {
  if (problems.length === 0) {
    return (
      <EmptyState
        title="Keine Probleme gemeldet"
        description="Für diese Komponente wurde in diesem Run kein problem.reported gemeldet."
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
              {problem.title}
            </h4>
          </div>
          {problem.detail.trim() !== '' && (
            <p className="mt-0.5 text-xs">{problem.detail}</p>
          )}
          <p className="text-muted-foreground text-2xs mt-0.5">
            <span className="font-mono">{problem.agentId}</span>
            <span aria-hidden="true"> · </span>
            {formatTimestamp(problem.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  )
}

export function ActiveChangeList({ changes }: { changes: readonly ActiveChange[] }) {
  if (changes.length === 0) {
    return (
      <EmptyState
        title="Keine offenen Vorschläge"
        description="Für diese Komponente ist in diesem Run keine Änderung angekündigt und noch nicht angewandt."
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
            <h4 className="min-w-0 flex-1 truncate font-mono text-xs">{change.changeId}</h4>
            <Badge variant="outline" className="text-2xs shrink-0 font-normal">
              {change.operation}
            </Badge>
          </div>
          <p className="text-muted-foreground text-2xs mt-0.5">
            {change.targetKind} <span className="font-mono">{change.targetId}</span>
            <span aria-hidden="true"> · </span>
            Zustand {change.state}
          </p>
          <p className="text-muted-foreground text-2xs mt-0.5">
            <span className="font-mono">{change.agentId}</span>
            <span aria-hidden="true"> · </span>
            geplant {formatTimestamp(change.plannedAt)}
          </p>
        </li>
      ))}
    </ul>
  )
}
