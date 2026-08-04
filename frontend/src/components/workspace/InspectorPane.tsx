import { Maximize2, Minimize2 } from 'lucide-react'

import { useComponentHistory, useComponentInspector } from '@/api/queries'
import type { ComponentId, ProjectId, RunId } from '@/api/types'
import { AsyncState, EmptyState } from '@/components/AsyncState'
import { PaneHeader } from '@/components/workspace/PaneHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { DeepFocusTarget } from '@/routes/searchParams'

export interface InspectorPaneProps {
  projectId: ProjectId
  runId: RunId
  componentId: ComponentId | undefined
  focus: DeepFocusTarget | undefined
  historyMode: boolean
  onSetFocus: (target: DeepFocusTarget | undefined) => void
  onSetHistoryMode: (enabled: boolean) => void
}

/**
 * Right pane: the component inspector.
 *
 * The pane is bound to the `component` search parameter, so a link reproduces
 * exactly which component is open. Rendering the markdown feedback and the
 * grouped unified diffs is #12; this pane provides the named regions, the
 * current-run/history switch and the deep-focus entry points, all wired to the
 * real read models.
 */
export function InspectorPane({
  projectId,
  runId,
  componentId,
  focus,
  historyMode,
  onSetFocus,
  onSetHistoryMode,
}: InspectorPaneProps) {
  const inspector = useComponentInspector(projectId, componentId, runId)
  const history = useComponentHistory(projectId, componentId, { enabled: historyMode })

  const feedbackCount = inspector.data?.feedback.length ?? 0
  const diffCount = inspector.data?.diffs.length ?? 0
  const riskCount = inspector.data?.risks.length ?? 0
  const problemCount = inspector.data?.problems.length ?? 0
  const historyEntries = history.data?.pages.flatMap((page) => page.entries) ?? []

  return (
    <section className="pane-surface" aria-label="Inspector" data-testid="pane-inspector">
      <PaneHeader
        title="Inspector"
        subtitle={componentId ?? 'keine Komponente ausgewählt'}
        actions={
          componentId && (
            <Button
              variant={historyMode ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              aria-pressed={historyMode}
              onClick={() => onSetHistoryMode(!historyMode)}
            >
              Historie
            </Button>
          )
        }
      />

      {focus && (
        <div
          className="border-border bg-accent/40 flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
          data-testid="deep-focus-banner"
        >
          <Maximize2 className="size-3.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-xs">
            Deep Focus: {focus === 'feedback' ? 'KI-Feedback' : 'Unified Diffs'} — die
            Architektur bleibt links sichtbar.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onSetFocus(undefined)}
          >
            <Minimize2 className="size-3" aria-hidden="true" />
            Beenden
          </Button>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {!componentId ? (
            <EmptyState
              title="Keine Komponente ausgewählt"
              description="Wählen Sie eine Komponente auf der Architekturfläche aus. Die Auswahl steht als ?component= in der Adresse und ist damit direkt verlinkbar."
            />
          ) : (
            <AsyncState
              isPending={inspector.isPending}
              isError={inspector.isError}
              error={inspector.error}
              emptyTitle="Keine Daten zu dieser Komponente"
              onRetry={() => void inspector.refetch()}
              skeletonRows={6}
            >
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-2xs font-normal">
                  {feedbackCount} Feedback
                </Badge>
                <Badge variant="outline" className="text-2xs font-normal">
                  {diffCount} Diffs
                </Badge>
                <Badge variant="outline" className="text-2xs font-normal">
                  {riskCount} Risiken
                </Badge>
                <Badge variant="outline" className="text-2xs font-normal">
                  {problemCount} Probleme
                </Badge>
              </div>

              <InspectorSection
                label="KI-Feedback"
                target="feedback"
                count={feedbackCount}
                focus={focus}
                onSetFocus={onSetFocus}
                emptyDescription="Für diese Komponente wurde in diesem Run kein feedback.published gemeldet."
              />

              <Separator />

              <InspectorSection
                label="Unified Diffs"
                target="diffs"
                count={diffCount}
                focus={focus}
                onSetFocus={onSetFocus}
                emptyDescription="Für diese Komponente wurde in diesem Run kein diff.reported gemeldet."
              />

              {historyMode && (
                <>
                  <Separator />
                  <section aria-label="Historie" data-testid="inspector-history">
                    <span className="pane-heading">Historie</span>
                    <div className="pt-2">
                      <AsyncState
                        isPending={history.isPending}
                        isError={history.isError}
                        error={history.error}
                        isEmpty={historyEntries.length === 0}
                        emptyTitle="Keine älteren Belege"
                        emptyDescription="Zu dieser Komponente liegen außerhalb des aktuellen Runs keine Ereignisse vor."
                        onRetry={() => void history.refetch()}
                      >
                        <EmptyState
                          title="Historienansicht folgt"
                          description={`${historyEntries.length} Einträge geladen. Korrekturen und Retraktionen bleiben dabei als eigene Einträge sichtbar; die Darstellung wird in einem eigenen Arbeitspaket ergänzt.`}
                        />
                        {history.hasNextPage && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 w-full"
                            disabled={history.isFetchingNextPage}
                            onClick={() => void history.fetchNextPage()}
                          >
                            {history.isFetchingNextPage ? 'Lädt…' : 'Ältere Einträge laden'}
                          </Button>
                        )}
                      </AsyncState>
                    </div>
                  </section>
                </>
              )}
            </AsyncState>
          )}
        </div>
      </ScrollArea>
    </section>
  )
}

function InspectorSection({
  label,
  target,
  count,
  focus,
  onSetFocus,
  emptyDescription,
}: {
  label: string
  target: DeepFocusTarget
  count: number
  focus: DeepFocusTarget | undefined
  onSetFocus: (target: DeepFocusTarget | undefined) => void
  emptyDescription: string
}) {
  const isFocused = focus === target

  return (
    <section aria-label={label} data-testid={`inspector-${target}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="pane-heading">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs"
          aria-pressed={isFocused}
          onClick={() => onSetFocus(isFocused ? undefined : target)}
        >
          {isFocused ? (
            <Minimize2 className="size-3" aria-hidden="true" />
          ) : (
            <Maximize2 className="size-3" aria-hidden="true" />
          )}
          {isFocused ? 'Deep Focus beenden' : 'Deep Focus'}
        </Button>
      </div>
      <div className="pt-2">
        {count === 0 ? (
          <EmptyState title={`Kein ${label} gemeldet`} description={emptyDescription} />
        ) : (
          <EmptyState
            title={`${label}: Darstellung folgt`}
            description={`${count} Einträge geladen. Die gerenderte Darstellung wird in einem eigenen Arbeitspaket ergänzt.`}
          />
        )}
      </div>
    </section>
  )
}
