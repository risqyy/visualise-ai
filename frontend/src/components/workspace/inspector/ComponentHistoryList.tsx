import { History, PencilLine, Undo2 } from 'lucide-react'

import type { ComponentHistoryEntry, RunId } from '@/api/types'
import { EmptyState } from '@/components/AsyncState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { formatTimestamp } from './formatting'
import {
  buildHistoryItems,
  EVENT_TYPE_LABELS,
  type HistoryItem,
} from './historyEntries'
import { SCROLL_ANCHOR_ATTRIBUTE } from './scrollStability'

/**
 * The run spanning history of one component.
 *
 * This is the *separate* view demanded by ADR 0005: "Current run and history are
 * different endpoints, not a flag … Conflating them would make it impossible to
 * tell whether a diff belongs to what the agent is doing now or to something it
 * did yesterday." So the history never appears inside the current-run evidence
 * and vice versa; the switch above chooses one of them.
 *
 * A corrected or retracted entry keeps its place and its content. It gains a
 * marker and the correction gains a back-reference, so both statements stay
 * readable and the reviewer can see what was claimed *and* what was taken back.
 */

export interface ComponentHistoryListProps {
  entries: readonly ComponentHistoryEntry[]
  /** Run the inspector is scoped to, so its own entries can be labelled. */
  currentRunId: RunId | null
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onFetchNextPage: () => void
}

export function ComponentHistoryList({
  entries,
  currentRunId,
  hasNextPage,
  isFetchingNextPage,
  onFetchNextPage,
}: ComponentHistoryListProps) {
  const items = buildHistoryItems(entries)

  if (items.length === 0) {
    return (
      <EmptyState
        title="Keine Historie"
        description="Zu dieser Komponente wurde noch kein Ereignis gemeldet."
      />
    )
  }

  return (
    <div className="space-y-2" data-testid="history-entries">
      <p className="text-muted-foreground text-2xs">
        Alle Runs, neueste zuerst. Korrekturen und Retraktionen stehen als eigene
        Einträge daneben — nichts wird überschrieben.
      </p>

      <ol className="space-y-1.5">
        {items.map((item) => (
          <li key={item.entry.serverEventId}>
            <HistoryRow item={item} isCurrentRun={item.entry.runId === currentRunId} />
          </li>
        ))}
      </ol>

      {hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={isFetchingNextPage}
          onClick={onFetchNextPage}
        >
          {isFetchingNextPage ? 'Lädt…' : 'Ältere Einträge laden'}
        </Button>
      )}
    </div>
  )
}

function HistoryRow({ item, isCurrentRun }: { item: HistoryItem; isCurrentRun: boolean }) {
  const { entry } = item

  return (
    <article
      className={cn(
        'border-border rounded-md border px-2 py-1.5',
        item.kind === 'correction' && 'border-state-planned/60',
        item.kind === 'retraction' && 'border-state-removed/60',
      )}
      data-testid="history-entry"
      data-entry-kind={item.kind}
      data-event-type={entry.type}
      data-client-event-id={entry.clientEventId}
      data-run-id={entry.runId}
      data-corrected={item.isCorrected ? 'true' : 'false'}
      data-retracted={item.isRetracted ? 'true' : 'false'}
      {...{ [SCROLL_ANCHOR_ATTRIBUTE]: `history:${entry.serverEventId}` }}
    >
      <div className="flex items-center gap-1.5">
        <HistoryIcon kind={item.kind} />
        <h4 className="min-w-0 flex-1 truncate text-xs font-semibold">
          {EVENT_TYPE_LABELS[entry.type]}
        </h4>
        <span className="text-muted-foreground text-2xs shrink-0 tabular-nums">
          #{entry.position}
        </span>
      </div>

      <p className="text-muted-foreground text-2xs">
        <span className="font-mono">{entry.agentId}</span>
        <span aria-hidden="true"> · </span>
        Run <span className="font-mono">{entry.runId}</span>
        {isCurrentRun && <span> (aktueller Run)</span>}
        <span aria-hidden="true"> · </span>
        {formatTimestamp(entry.occurredAt)}
      </p>

      {item.reason !== null && (
        <p className="mt-1 text-xs">
          <span className="text-muted-foreground">Begründung: </span>
          {item.reason}
        </p>
      )}

      {item.referencesClientEventId !== null && (
        <p className="text-muted-foreground text-2xs mt-0.5">
          {item.kind === 'correction' ? 'korrigiert' : 'zieht zurück'}{' '}
          <span className="font-mono">{item.referencesClientEventId}</span>
          {item.correctedType !== null && (
            <> — neuer Inhalt als {EVENT_TYPE_LABELS[item.correctedType]}</>
          )}
        </p>
      )}

      {(item.isCorrected || item.isRetracted) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {item.isCorrected && (
            <Badge variant="outline" className="text-2xs font-normal">
              später korrigiert — Eintrag bleibt bestehen
            </Badge>
          )}
          {item.isRetracted && (
            <Badge variant="outline" className="text-2xs font-normal">
              später zurückgezogen — Eintrag bleibt bestehen
            </Badge>
          )}
        </div>
      )}
    </article>
  )
}

function HistoryIcon({ kind }: { kind: HistoryItem['kind'] }) {
  if (kind === 'correction') {
    return <PencilLine className="text-state-planned size-3.5 shrink-0" aria-hidden="true" />
  }
  if (kind === 'retraction') {
    return <Undo2 className="text-state-removed size-3.5 shrink-0" aria-hidden="true" />
  }
  return <History className="size-3.5 shrink-0" aria-hidden="true" />
}
