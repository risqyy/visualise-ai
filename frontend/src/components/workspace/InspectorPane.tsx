import { Maximize2, Minimize2 } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'

import { useComponentHistory, useComponentInspector } from '@/api/queries'
import type { ComponentId, ProjectId, RunId } from '@/api/types'
import { AsyncState, EmptyState } from '@/components/AsyncState'
import { PaneHeader } from '@/components/workspace/PaneHeader'
import { ComponentContextCard } from '@/components/workspace/inspector/ComponentContextCard'
import { ComponentHistoryList } from '@/components/workspace/inspector/ComponentHistoryList'
import { DiffGroupList } from '@/components/workspace/inspector/DiffGroupList'
import { FeedbackList } from '@/components/workspace/inspector/FeedbackList'
import {
  ActiveChangeList,
  ProblemList,
  RiskList,
} from '@/components/workspace/inspector/FindingsList'
import { useStableScroll } from '@/components/workspace/inspector/scrollStability'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
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
 * Bound to the `component` search parameter, so a link reproduces exactly which
 * component is open and an incoming live event can never change the selection —
 * only the user and the URL do.
 *
 * The pane answers one question at a time and always says which run it is
 * answering for. **The current run is the default view**; older evidence lives
 * behind the history switch and comes from a different endpoint, not from a
 * filter (ADR 0005). The two views are mutually exclusive: a diff from last
 * week must never sit in the same list as one from the run being watched.
 *
 * Three details are load-bearing rather than cosmetic:
 *
 * * The body scrolls in a **plain container**, not in the Radix `ScrollArea`
 *   the other panes use. The inspector nests horizontally scrolling diff boxes,
 *   and `useStableScroll` needs the real scroll offset of the real element to
 *   pin the reader's place across a live update.
 * * Every entry carries a `data-scroll-anchor`; that is what the pinning
 *   anchors on.
 * * Deep focus hides the *other* sections instead of shrinking them, so the
 *   enlarged pane is spent on what is being read. The architecture keeps ~41 %
 *   of the width throughout (`DEEP_FOCUS_PANE_LAYOUT`).
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

  const pages = useMemo(() => inspector.data?.pages ?? [], [inspector.data])
  // Every page repeats the complete, non-paged collections; only `diffs`
  // continues. The first page is therefore the authoritative one.
  const head = pages[0]
  const diffs = useMemo(() => pages.flatMap((page) => page.diffs), [pages])
  const historyEntries = useMemo(
    () => history.data?.pages.flatMap((page) => page.entries) ?? [],
    [history.data],
  )

  // Changes exactly when something was inserted, removed or reordered — which
  // is when the reader's place has to be recovered, and never otherwise.
  const contentSignature = [
    historyMode ? 'history' : 'run',
    head?.runId ?? '',
    diffs.map((diff) => diff.diffId).join(','),
    (head?.feedback ?? []).map((entry) => entry.feedbackId).join(','),
    historyEntries.map((entry) => entry.serverEventId).join(','),
  ].join('|')
  const scrollProps = useStableScroll(contentSignature)

  const showFeedback = focus === undefined || focus === 'feedback'
  const showDiffs = focus === undefined || focus === 'diffs'
  const showSecondary = focus === undefined

  return (
    <section className="pane-surface" aria-label="Inspector" data-testid="pane-inspector">
      <PaneHeader
        title="Inspector"
        subtitle={head?.component?.name ?? componentId ?? 'keine Komponente ausgewählt'}
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

      {componentId && (
        <div
          role="tablist"
          aria-label="Belegquelle"
          className="border-border flex shrink-0 items-center gap-1 border-b px-3 py-1.5"
        >
          <ViewTab
            label="Aktueller Run"
            selected={!historyMode}
            onSelect={() => onSetHistoryMode(false)}
          />
          <ViewTab
            label="Historie"
            selected={historyMode}
            onSelect={() => onSetHistoryMode(true)}
          />
          <span className="text-muted-foreground text-2xs ml-auto truncate font-mono">
            {historyMode ? 'alle Runs' : (head?.runId ?? runId)}
          </span>
        </div>
      )}

      <div
        {...scrollProps}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        data-testid="inspector-scroll"
      >
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
              {head && (
                <ComponentContextCard
                  componentId={componentId}
                  component={head.component}
                  responsibleAgent={head.responsibleAgent}
                  currentWorkStep={head.currentWorkStep}
                  runId={head.runId}
                />
              )}

              {historyMode ? (
                <section
                  aria-label="Historie"
                  data-testid="inspector-history"
                  className="space-y-2"
                >
                  <span className="pane-heading">Historie über alle Runs</span>
                  <AsyncState
                    isPending={history.isPending}
                    isError={history.isError}
                    error={history.error}
                    emptyTitle="Keine älteren Belege"
                    onRetry={() => void history.refetch()}
                  >
                    <ComponentHistoryList
                      entries={historyEntries}
                      currentRunId={head?.runId ?? null}
                      hasNextPage={history.hasNextPage}
                      isFetchingNextPage={history.isFetchingNextPage}
                      onFetchNextPage={() => void history.fetchNextPage()}
                    />
                  </AsyncState>
                </section>
              ) : (
                <div className="space-y-4" data-testid="inspector-current-run">
                  {showSecondary && head && (
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-2xs font-normal">
                        {head.feedback.length} Feedback
                      </Badge>
                      <Badge variant="outline" className="text-2xs font-normal">
                        {diffs.length} Diffs
                      </Badge>
                      <Badge variant="outline" className="text-2xs font-normal">
                        {head.risks.length} Risiken
                      </Badge>
                      <Badge variant="outline" className="text-2xs font-normal">
                        {head.problems.length} Probleme
                      </Badge>
                    </div>
                  )}

                  {showFeedback && (
                    <InspectorSection
                      label="KI-Feedback"
                      target="feedback"
                      focus={focus}
                      onSetFocus={onSetFocus}
                    >
                      <FeedbackList feedback={head?.feedback ?? []} />
                    </InspectorSection>
                  )}

                  {showSecondary && <Separator />}

                  {showDiffs && (
                    <InspectorSection
                      label="Unified Diffs"
                      target="diffs"
                      focus={focus}
                      onSetFocus={onSetFocus}
                    >
                      <DiffGroupList
                        diffs={diffs}
                        hasNextPage={inspector.hasNextPage}
                        isFetchingNextPage={inspector.isFetchingNextPage}
                        onFetchNextPage={() => void inspector.fetchNextPage()}
                      />
                    </InspectorSection>
                  )}

                  {showSecondary && (
                    <>
                      <Separator />
                      <section aria-label="Risiken" data-testid="inspector-risks">
                        <span className="pane-heading">Risiken</span>
                        <div className="pt-2">
                          <RiskList risks={head?.risks ?? []} />
                        </div>
                      </section>

                      <section aria-label="Probleme" data-testid="inspector-problems">
                        <span className="pane-heading">Probleme</span>
                        <div className="pt-2">
                          <ProblemList problems={head?.problems ?? []} />
                        </div>
                      </section>

                      <section
                        aria-label="Offene Vorschläge"
                        data-testid="inspector-active-changes"
                      >
                        <span className="pane-heading">Offene Vorschläge</span>
                        <div className="pt-2">
                          <ActiveChangeList changes={head?.activeChanges ?? []} />
                        </div>
                      </section>
                    </>
                  )}
                </div>
              )}
            </AsyncState>
          )}
        </div>
      </div>
    </section>
  )
}

function ViewTab({
  label,
  selected,
  onSelect,
}: {
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'focus-visible:ring-ring rounded-md px-2 py-0.5 text-xs focus-visible:ring-2 focus-visible:outline-none',
        selected
          ? 'bg-accent text-accent-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/50',
      )}
    >
      {label}
    </button>
  )
}

function InspectorSection({
  label,
  target,
  focus,
  onSetFocus,
  children,
}: {
  label: string
  target: DeepFocusTarget
  focus: DeepFocusTarget | undefined
  onSetFocus: (target: DeepFocusTarget | undefined) => void
  children: ReactNode
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
      <div className="pt-2">{children}</div>
    </section>
  )
}
