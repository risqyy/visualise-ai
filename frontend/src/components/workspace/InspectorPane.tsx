import { Maximize2, Minimize2 } from 'lucide-react'
import { useCallback, useMemo, useRef, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { useArchitecture, useComponentHistory, useComponentInspector } from '@/api/queries'
import type { AppliedRelationship, ComponentId, Identifier, ProjectId, Relationship, RunId } from '@/api/types'
import { bundleEdgeId, overlayEdgeId } from '@/canvas/graphProjection'
import { useChangeOverlays } from '@/canvas/useChangeOverlays'
import { contributionDetail } from '@/canvas/changeOverlays'
import { AsyncState, EmptyState } from '@/components/AsyncState'
import { PaneHeader } from '@/components/workspace/PaneHeader'
import { ComponentContextCard } from '@/components/workspace/inspector/ComponentContextCard'
import { RelationshipContextCard } from '@/components/workspace/inspector/RelationshipContextCard'
import { ComponentHistoryList } from '@/components/workspace/inspector/ComponentHistoryList'
import { DiffGroupList } from '@/components/workspace/inspector/DiffGroupList'
import { FeedbackList } from '@/components/workspace/inspector/FeedbackList'
import {
  ActiveChangeList,
  ProblemList,
  RiskList,
} from '@/components/workspace/inspector/FindingsList'
import { useStableScroll } from '@/components/workspace/inspector/scrollStability'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ReportedText } from '@/i18n'
import { cn } from '@/lib/utils'
import type { DeepFocusTarget } from '@/routes/searchParams'

export interface InspectorPaneProps {
  projectId: ProjectId
  runId: RunId
  componentId: ComponentId | undefined
  relationshipId: Identifier | undefined
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
  relationshipId,
  focus,
  historyMode,
  onSetFocus,
  onSetHistoryMode,
}: InspectorPaneProps) {
  const { t } = useTranslation('inspector')
  const { t: tWorkspace } = useTranslation('workspace')
  const { t: tCommon } = useTranslation('common')
  const { t: tCanvas } = useTranslation('canvas')
  const architecture = useArchitecture(projectId)
  const overlay = useChangeOverlays(projectId, architecture.data, runId)
  const contributions = overlay.evidence?.get(relationshipId ? `relationship:${relationshipId}` : `component:${componentId}`) ?? []
  const inspector = useComponentInspector(
    projectId,
    relationshipId ? undefined : componentId,
    runId,
  )
  const history = useComponentHistory(projectId, relationshipId ? undefined : componentId, {
    enabled: historyMode,
  })

  const selectedRelationship = useMemo<AppliedRelationship | Relationship | null>(() => {
    if (!relationshipId) return null
    const applied = architecture.data?.relationships.find(
      (entry) => entry.relationshipId === relationshipId,
    )
    if (applied) return applied
    return overlay.extraRelationships.find(
      (entry) => entry.relationship.relationshipId === relationshipId,
    )?.relationship ?? null
  }, [architecture.data?.relationships, overlay.extraRelationships, relationshipId])
  const relationshipBundle = useMemo(() => {
    if (!selectedRelationship) return []
    const appliedRelationshipIds = new Set(
      architecture.data?.relationships.map((entry) => entry.relationshipId) ?? [],
    )
    const all = [
      ...(architecture.data?.relationships ?? []),
      ...overlay.extraRelationships.map((entry) => entry.relationship),
    ]
    const edgeIdOf = (entry: AppliedRelationship | Relationship) =>
      appliedRelationshipIds.has(entry.relationshipId)
        ? bundleEdgeId(entry.sourceComponentId, entry.targetComponentId)
        : overlayEdgeId(entry.sourceComponentId, entry.targetComponentId)
    const selectedEdgeId = edgeIdOf(selectedRelationship)
    return all.filter(
      (entry) => edgeIdOf(entry) === selectedEdgeId,
    )
  }, [architecture.data?.relationships, overlay.extraRelationships, selectedRelationship])
  const componentNames = useMemo(
    () =>
      new Map([
        ...(architecture.data?.components ?? []).map((entry) => [entry.componentId, entry.name] as const),
        ...overlay.extraComponents.map((entry) => [entry.component.componentId, entry.component.name] as const),
      ]),
    [architecture.data?.components, overlay.extraComponents],
  )
  const selectedRelationshipOverlay = relationshipId
    ? overlay.relationships.get(relationshipId) ??
      overlay.extraRelationships.find((entry) => entry.relationship.relationshipId === relationshipId)
        ?.overlay
    : undefined

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
  const scrollViewport = useRef<HTMLDivElement>(null)
  const rememberScrollViewport = scrollProps.ref
  const setScrollViewport = useCallback((element: HTMLDivElement | null) => {
    scrollViewport.current = element
    rememberScrollViewport(element)
  }, [rememberScrollViewport])
  const feedbackHeading = useRef<HTMLHeadingElement>(null)
  const diffsHeading = useRef<HTMLHeadingElement>(null)
  const risksHeading = useRef<HTMLHeadingElement>(null)
  const problemsHeading = useRef<HTMLHeadingElement>(null)

  const showFeedback = focus === undefined || focus === 'feedback'
  const showDiffs = focus === undefined || focus === 'diffs'
  const showSecondary = focus === undefined

  return (
    <section
      className="pane-surface"
      aria-label={tWorkspace('pane.rightLabel')}
      data-testid="pane-inspector"
    >
      <PaneHeader
        title={tWorkspace('pane.rightLabel')}
        subtitle={
          // The component's reported name — or, failing that, its reported id.
          // Only the "nothing is selected" case is the cockpit's own sentence.
          relationshipId && selectedRelationship ? (
            <ReportedText value={relationshipId} />
          ) : head?.component?.name !== undefined ? (
            <ReportedText value={head.component.name} />
          ) : componentId !== undefined ? (
            <ReportedText value={componentId} />
          ) : (
            t('pane.subtitleEmpty')
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
            {t('deepFocus.banner', {
              section: focus === 'feedback' ? t('feedback.label') : t('diff.label'),
            })}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onSetFocus(undefined)}
          >
            <Minimize2 className="size-3" aria-hidden="true" />
            {t('deepFocus.exit')}
          </Button>
        </div>
      )}

      {componentId && !relationshipId && (
        <div
          role="tablist"
          aria-label={t('source.label')}
          className="border-border flex shrink-0 items-center gap-1 border-b px-3 py-1.5"
        >
          <ViewTab
            label={t('source.selectedRun')}
            selected={!historyMode}
            onSelect={() => onSetHistoryMode(false)}
          />
          <ViewTab
            label={t('source.history')}
            selected={historyMode}
            onSelect={() => onSetHistoryMode(true)}
          />
          <span className="text-muted-foreground text-2xs ml-auto truncate font-mono">
            {historyMode ? (
              t('source.allRuns')
            ) : (
              <ReportedText value={head?.runId ?? runId} />
            )}
          </span>
        </div>
      )}

      {componentId && !relationshipId && !historyMode && showSecondary && inspector.isSuccess && head && (
        <nav
          aria-label={t('navigation.label')}
          data-testid="inspector-section-navigation"
          className="border-border flex shrink-0 flex-wrap gap-1 border-b px-3 py-1.5"
        >
          {[
            {
              target: 'feedback', heading: feedbackHeading,
              label: tCommon('count.feedback', { count: head.feedback.length }),
            },
            {
              target: 'diffs', heading: diffsHeading,
              label: tCommon('count.diff', { count: diffs.length }),
            },
            {
              target: 'risks', heading: risksHeading,
              label: tCommon('count.risk', { count: head.risks.length }),
            },
            {
              target: 'problems', heading: problemsHeading,
              label: tCommon('count.problem', { count: head.problems.length }),
            },
          ].map(({ target, heading, label }) => (
            <Button
              key={target}
              variant="outline"
              size="xs"
              className="font-normal"
              data-testid={`inspector-jump-${target}`}
              aria-controls={`inspector-${target}-section`}
              onClick={() => {
                const viewport = scrollViewport.current
                const targetHeading = heading.current
                if (!viewport || !targetHeading) return
                // scrollIntoView also moves overflow-hidden outer ancestors.
                // Only this pane should move when navigating its evidence.
                viewport.scrollTop += targetHeading.getBoundingClientRect().top -
                  viewport.getBoundingClientRect().top
                targetHeading.focus({ preventScroll: true })
                scrollProps.onScroll()
              }}
            >
              {label}
            </Button>
          ))}
        </nav>
      )}

      <div
        {...scrollProps}
        ref={setScrollViewport}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        data-testid="inspector-scroll"
      >
        <div className="space-y-4 p-3">
          {contributions.length > 0 && (
            <section aria-label={t('contributions.label')} data-testid="element-contributions" className="border-border space-y-2 rounded-md border p-2">
              <h3 className="pane-heading">{t('contributions.label')}</h3>
              <p className="text-muted-foreground text-xs">{t('contributions.note')}</p>
              <ul className="space-y-2 text-xs">
                {contributions.map((entry, index) => (
                  <li key={`${entry.runId}:${entry.agentId}:${entry.position}:${entry.source}:${index}`} data-agent-id={entry.agentId} data-source={entry.source}>
                    <ReportedText value={entry.agentId} /> · <ReportedText value={entry.runId} />
                    <p>{contributionDetail(entry, tCanvas)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {relationshipId ? (
            <RelationshipContextCard
              relationshipId={relationshipId}
              relationship={selectedRelationship}
              sourceName={
                selectedRelationship
                  ? componentNames.get(selectedRelationship.sourceComponentId) ??
                    selectedRelationship.sourceComponentId
                  : ''
              }
              targetName={
                selectedRelationship
                  ? componentNames.get(selectedRelationship.targetComponentId) ??
                    selectedRelationship.targetComponentId
                  : ''
              }
              {...(selectedRelationshipOverlay
                ? { overlay: selectedRelationshipOverlay }
                : {})}
              bundle={relationshipBundle}
            />
          ) : !componentId ? (
            <EmptyState title={t('empty.title')} description={t('empty.description')} />
          ) : (
            <AsyncState
              isPending={inspector.isPending}
              isError={inspector.isError}
              error={inspector.error}
              emptyTitle={t('component.emptyTitle')}
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
                  aria-label={t('history.label')}
                  data-testid="inspector-history"
                  className="space-y-2"
                >
                  <span className="pane-heading">{t('history.title')}</span>
                  <AsyncState
                    isPending={history.isPending}
                    isError={history.isError}
                    error={history.error}
                    emptyTitle={t('history.emptyTitle')}
                    onRetry={() => void history.refetch()}
                  >
                    <ComponentHistoryList
                      entries={historyEntries}
                      selectedRunId={head?.runId ?? null}
                      hasNextPage={history.hasNextPage}
                      isFetchingNextPage={history.isFetchingNextPage}
                      onFetchNextPage={() => void history.fetchNextPage()}
                    />
                  </AsyncState>
                </section>
              ) : (
                <div className="space-y-4" data-testid="inspector-current-run">
                  {showFeedback && (
                    <InspectorSection
                      label={t('feedback.label')}
                      target="feedback"
                      headingRef={feedbackHeading}
                      focus={focus}
                      onSetFocus={onSetFocus}
                    >
                      <FeedbackList feedback={head?.feedback ?? []} />
                    </InspectorSection>
                  )}

                  {showSecondary && <Separator />}

                  {showDiffs && (
                    <InspectorSection
                      label={t('diff.label')}
                      target="diffs"
                      headingRef={diffsHeading}
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
                      <section
                        id="inspector-risks-section"
                        aria-label={t('risk.label')}
                        data-testid="inspector-risks"
                      >
                        <h3
                          id="inspector-risks-heading"
                          ref={risksHeading}
                          tabIndex={-1}
                          className="pane-heading focus-visible:outline-ring focus-visible:outline-2"
                        >
                          {t('risk.label')}
                        </h3>
                        <div className="pt-2">
                          <RiskList risks={head?.risks ?? []} />
                        </div>
                      </section>

                      <section
                        id="inspector-problems-section"
                        aria-label={t('problem.label')}
                        data-testid="inspector-problems"
                      >
                        <h3
                          id="inspector-problems-heading"
                          ref={problemsHeading}
                          tabIndex={-1}
                          className="pane-heading focus-visible:outline-ring focus-visible:outline-2"
                        >
                          {t('problem.label')}
                        </h3>
                        <div className="pt-2">
                          <ProblemList problems={head?.problems ?? []} />
                        </div>
                      </section>

                      <section
                        aria-label={t('change.label')}
                        data-testid="inspector-active-changes"
                      >
                        <span className="pane-heading">{t('change.label')}</span>
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
  headingRef,
  focus,
  onSetFocus,
  children,
}: {
  label: string
  target: DeepFocusTarget
  headingRef: Ref<HTMLHeadingElement>
  focus: DeepFocusTarget | undefined
  onSetFocus: (target: DeepFocusTarget | undefined) => void
  children: ReactNode
}) {
  const { t } = useTranslation('inspector')
  const isFocused = focus === target

  return (
    <section
      id={`inspector-${target}-section`}
      aria-label={label}
      data-testid={`inspector-${target}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id={`inspector-${target}-heading`}
          ref={headingRef}
          tabIndex={-1}
          className="pane-heading focus-visible:outline-ring focus-visible:outline-2"
        >
          {label}
        </h3>
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
          {isFocused ? t('deepFocus.leave') : t('deepFocus.enter')}
        </Button>
      </div>
      <div className="pt-2">{children}</div>
    </section>
  )
}
