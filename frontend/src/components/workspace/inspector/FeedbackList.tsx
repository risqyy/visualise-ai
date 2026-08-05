import { MessageSquareText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { FeedbackEntry } from '@/api/types'
import { EmptyState } from '@/components/AsyncState'
import { Badge } from '@/components/ui/badge'
import { ReportedText, ReportedTime } from '@/i18n'

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
  const { t } = useTranslation('inspector')

  if (feedback.length === 0) {
    return (
      <EmptyState
        title={t('feedback.emptyTitle')}
        description={t('feedback.emptyDescription')}
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
                {/* A reported title, or our sentence about its absence. */}
                {entry.title.trim() === '' ? (
                  t('feedback.untitled')
                ) : (
                  <ReportedText value={entry.title} />
                )}
              </h4>
              {/* `format` is a contract value and is shown as it arrived. */}
              <Badge variant="outline" className="text-2xs shrink-0 font-normal">
                <ReportedText value={entry.format} />
              </Badge>
            </div>
            <p className="text-muted-foreground text-2xs">
              <ReportedText value={entry.agentId} className="font-mono" />
              <span aria-hidden="true"> · </span>
              {t('meta.runPrefix')}{' '}
              <ReportedText value={entry.runId} className="font-mono" />
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
