import { MessageSquareText } from 'lucide-react'

import type { FeedbackEntry } from '@/api/types'
import { EmptyState } from '@/components/AsyncState'
import { Badge } from '@/components/ui/badge'
import { ReportedTime } from '@/i18n'

import { orNotReported } from './formatting'
import { SafeMarkdown } from './SafeMarkdown'
import { SCROLL_ANCHOR_ATTRIBUTE } from './scrollStability'

/**
 * Component scoped feedback of the selected run, newest first.
 *
 * Every body goes through `SafeMarkdown`. Nothing here decides whether a body
 * is trustworthy — it is agent output, so it never is, and there is no code
 * path that renders one without sanitising it.
 */

export interface FeedbackListProps {
  feedback: readonly FeedbackEntry[]
}

export function FeedbackList({ feedback }: FeedbackListProps) {
  if (feedback.length === 0) {
    return (
      <EmptyState
        title="Kein Feedback gemeldet"
        description="Für diese Komponente wurde in diesem Run kein feedback.published gemeldet."
      />
    )
  }

  return (
    <div className="space-y-3" data-testid="feedback-entries">
      {feedback.map((entry) => (
        <article
          key={entry.feedbackId}
          className="border-border rounded-md border"
          data-testid="feedback-entry"
          data-feedback-id={entry.feedbackId}
          {...{ [SCROLL_ANCHOR_ATTRIBUTE]: `feedback:${entry.feedbackId}` }}
        >
          <header className="border-border bg-muted/40 space-y-1 border-b px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <MessageSquareText className="size-3.5 shrink-0" aria-hidden="true" />
              <h4 className="min-w-0 flex-1 truncate text-xs font-semibold">
                {orNotReported(entry.title, 'Ohne Titel gemeldet')}
              </h4>
              <Badge variant="outline" className="text-2xs shrink-0 font-normal">
                {entry.format}
              </Badge>
            </div>
            <p className="text-muted-foreground text-2xs">
              <span className="font-mono">{entry.agentId}</span>
              <span aria-hidden="true"> · </span>
              Run <span className="font-mono">{entry.runId}</span>
              <span aria-hidden="true"> · </span>
              <ReportedTime value={entry.createdAt} />
            </p>
          </header>

          <div className="px-2 py-1.5">
            <SafeMarkdown>{entry.body}</SafeMarkdown>
          </div>
        </article>
      ))}
    </div>
  )
}
