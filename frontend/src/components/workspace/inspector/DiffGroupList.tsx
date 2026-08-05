import { FileDiff, GitCommitVertical } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

import type { ReportedDiff } from '@/api/types'
import { EmptyState } from '@/components/AsyncState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ReportedText, ReportedTime } from '@/i18n'

import { groupDiffs, type DiffGroup } from './diffGroups'
import { SCROLL_ANCHOR_ATTRIBUTE } from './scrollStability'
import { UnifiedDiffView } from './UnifiedDiffView'

/**
 * The unified diffs of the selected component, grouped by logical change.
 *
 * The list reads as "one change, these files", never as "these files, by the
 * way from the same change". That is the whole reason `changeId` exists in the
 * contract, and it is what lets a reviewer see that a new module, its test and
 * the caller that now uses it were one act of work.
 */

export interface DiffGroupListProps {
  diffs: readonly ReportedDiff[]
  /** `true` while a further page of diffs can be fetched. */
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onFetchNextPage: () => void
}

export function DiffGroupList({
  diffs,
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
}: DiffGroupListProps) {
  const { t } = useTranslation('inspector')
  const { t: tCommon } = useTranslation('common')
  const groups = groupDiffs(diffs)

  if (groups.length === 0) {
    return (
      <EmptyState title={t('diff.emptyTitle')} description={t('diff.emptyDescription')} />
    )
  }

  return (
    <div className="space-y-3" data-testid="diff-groups">
      {groups.map((group) => (
        <DiffGroupCard key={group.key} group={group} />
      ))}

      {hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={isFetchingNextPage}
          onClick={onFetchNextPage}
        >
          {isFetchingNextPage ? tCommon('state.loadingMore') : t('diff.loadMore')}
        </Button>
      )}
    </div>
  )
}

function DiffGroupCard({ group }: { group: DiffGroup }) {
  const { t } = useTranslation('inspector')
  const { t: tCommon } = useTranslation('common')
  const isAttributed = group.changeId !== null
  // The heading names *our* concept and quotes the reported id. The id has to
  // sit inside the phrase, so it is interpolated — i18next never translates an
  // interpolated value.
  const heading = isAttributed
    ? t('diff.changeHeading', { changeId: group.changeId })
    : t('diff.singleHeading', { diffId: group.files[0]?.diff.diffId ?? '' })

  return (
    <article
      className="border-border rounded-md border"
      data-testid="diff-group"
      data-change-id={group.changeId ?? ''}
      data-agent-id={group.agentId}
      data-run-id={group.runId}
      data-file-count={group.files.length}
      {...{ [SCROLL_ANCHOR_ATTRIBUTE]: `diff-group:${group.key}` }}
    >
      <header className="border-border bg-muted/40 space-y-1 border-b px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          {isAttributed ? (
            <GitCommitVertical className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <FileDiff className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <h4 className="min-w-0 flex-1 truncate font-mono text-xs" title={heading}>
            {heading}
          </h4>
          <Badge variant="outline" className="text-2xs shrink-0 font-normal tabular-nums">
            {tCommon('count.file', { count: group.files.length })}
          </Badge>
        </div>
        <p className="text-muted-foreground text-2xs">
          {/*
            Agent and run are part of the grouping key, so they are named on the
            group rather than repeated on every file: the files below are, by
            construction, the work of this agent in this run.
          */}
          <ReportedText value={group.agentId} className="font-mono" />
          <span aria-hidden="true"> · </span>
          {t('meta.runPrefix')} <ReportedText value={group.runId} className="font-mono" />
          <span aria-hidden="true"> · </span>
          <ReportedTime value={group.reportedAt} />
          <span aria-hidden="true"> · </span>
          <span className="text-state-applied">+{group.additions}</span>
          <span> / </span>
          <span className="text-state-removed">−{group.removals}</span>
        </p>
        {!isAttributed && (
          <p className="text-muted-foreground text-2xs">
            {/*
              `changeId` is a contract field name and appears as itself in every
              language, so it is a `<Trans>` slot rather than catalogue text.
            */}
            <Trans
              ns="inspector"
              i18nKey="diff.withoutChangeId"
              components={{ field: <code className="font-mono">changeId</code> }}
            />
          </p>
        )}
      </header>

      <div className="space-y-2 p-2">
        {group.files.map((file) => (
          <UnifiedDiffView
            key={file.diff.diffId}
            filePath={file.diff.filePath}
            unifiedDiff={file.diff.unifiedDiff}
          />
        ))}
      </div>
    </article>
  )
}
