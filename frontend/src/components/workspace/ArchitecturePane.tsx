import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useArchitecture } from '@/api/queries'
import type { ComponentId, Identifier, ProjectId } from '@/api/types'
import {
  ArchitectureCanvas,
  type ArchitectureCanvasMetrics,
} from '@/canvas/ArchitectureCanvas'
import { useChangeOverlays } from '@/canvas/useChangeOverlays'
import { AsyncState } from '@/components/AsyncState'
import { StatusLegend } from '@/components/StatusLegend'
import { ChangeCounter } from '@/components/workspace/ChangeCounter'
import { PaneHeader } from '@/components/workspace/PaneHeader'
import { RelationshipLegend } from '@/components/workspace/RelationshipLegend'
import { Badge } from '@/components/ui/badge'
import { ReportedText } from '@/i18n'
import type { GraphOrientation } from '@/canvas/graphOrientation'

export interface ArchitecturePaneProps {
  projectId: ProjectId
  /** Selection from the URL; the canvas mirrors it, it never owns it. */
  selectedComponentId?: ComponentId | undefined
  /** Selection from the URL for one reported relationship. */
  selectedRelationshipId?: Identifier | null | undefined
  /** Writes the selection back into the `component` search param. */
  onSelectComponent: (componentId: ComponentId | null) => void
  orientation: GraphOrientation
  onOrientationChange: (orientation: GraphOrientation) => void
  /** Writes a relationship selection to the `relationship` search param. */
  onSelectRelationship: (relationshipId: Identifier | null) => void
}

/**
 * Centre pane: the architecture surface.
 *
 * It stays the visually dominant area at 1920 × 1080 — it gets the largest
 * default share of the layout, the brightest surface and the only unbounded
 * region of the workspace. The pane itself only owns the read model, the
 * loading/error/empty states and the two legends; the interactive graph lives
 * in `src/canvas`.
 */
export function ArchitecturePane({
  projectId,
  selectedComponentId,
  selectedRelationshipId,
  onSelectComponent,
  orientation,
  onOrientationChange,
  onSelectRelationship,
}: ArchitecturePaneProps) {
  const { t } = useTranslation('canvas')
  const architecture = useArchitecture(projectId)
  const overlay = useChangeOverlays(projectId, architecture.data)

  const componentCount = architecture.data?.components.length ?? 0
  const relationshipCount = architecture.data?.relationships.length ?? 0
  const proposalComponentCount = overlay.extraComponents.filter(
    (entry) => entry.overlay.presence === 'proposal',
  ).length
  const evidenceComponentCount = overlay.extraComponents.filter(
    (entry) => entry.overlay.presence === 'ghost',
  ).length
  const [canvasMetrics, setCanvasMetrics] = useState<ArchitectureCanvasMetrics | null>(null)
  const onCanvasMetricsChange = useCallback(
    (metrics: ArchitectureCanvasMetrics) => setCanvasMetrics(metrics),
    [],
  )

  // Ignore a metric from the previous snapshot for the one render between a
  // refetch and the next canvas effect. A count is only meaningful when it
  // describes the same reported model and the same element inventory.
  const currentMetrics =
    canvasMetrics !== null &&
    canvasMetrics.reportedRelationshipCount === relationshipCount &&
    canvasMetrics.totalElementCount === componentCount + overlay.extraComponents.length
      ? canvasMetrics
      : null

  // The legend is a key to what is drawn, so it lists only the kinds actually
  // reported. Deriving it here keeps the legend and the canvas reading from the
  // same model instead of from the contract's full catalogue.
  const presentKinds = useMemo(
    () => [...new Set((architecture.data?.relationships ?? []).map((r) => r.kind))],
    [architecture.data?.relationships],
  )

  // Kept stable across refetches: TanStack Query's structural sharing returns
  // the same arrays when nothing changed, so the canvas does not re-layout.
  // The overlay travels alongside the applied model, never inside it — a
  // proposal must not turn into a component of the reported architecture.
  const model = useMemo(
    () => ({
      components: architecture.data?.components ?? [],
      relationships: architecture.data?.relationships ?? [],
      overlay,
    }),
    [architecture.data?.components, architecture.data?.relationships, overlay],
  )

  return (
    <section
      className="pane-surface bg-canvas"
      aria-label={t('pane.label')}
      data-testid="pane-architecture"
    >
      <PaneHeader
        title={t('pane.title')}
        subtitle={<ReportedText value={projectId} />}
        // The architecture counters are intentionally allowed to wrap inside
        // the pane. Keeping them in one unbreakable row makes the title lose
        // all available width as soon as a locale has longer count labels.
        className="h-auto min-h-10 items-start py-1 [&>div:first-child]:shrink-0"
        actionsClassName="min-w-0 flex-1 shrink"
        actions={
          architecture.isSuccess && (
            <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2">
              <ChangeCounter counts={overlay.counts} className="shrink-0" />
              <span className="bg-border h-4 w-px" aria-hidden="true" />
              {/*
                The grammatical plural of these two counts is #40's, not this
                issue's: the words moved into the catalogue, the `_one`/`_other`
                forms follow with the locale-aware formatting service.
              */}
              <Badge
                variant="outline"
                className="text-2xs font-normal"
                data-testid="architecture-model-count"
              >
                {t('pane.modelComponents', { count: componentCount })}
              </Badge>
              {proposalComponentCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-2xs font-normal"
                  data-testid="architecture-proposal-count"
                >
                  {t('pane.proposedComponents', { count: proposalComponentCount })}
                </Badge>
              )}
              {evidenceComponentCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-2xs font-normal"
                  data-testid="architecture-evidence-count"
                >
                  {t('pane.evidenceComponents', { count: evidenceComponentCount })}
                </Badge>
              )}
              <Badge
                variant="outline"
                className="text-2xs font-normal"
                title={t('pane.relationshipSummaryHint')}
                data-testid="architecture-relationship-count"
              >
                {t('pane.reportedRelationships', { count: relationshipCount })}
                {currentMetrics !== null && (
                  <>
                    {' · '}
                    {t('pane.renderedConnections', {
                      count: currentMetrics.visibleConnectionCount,
                    })}
                  </>
                )}
              </Badge>
            </div>
          )
        }
      />

      {/* The canvas region owns its own overflow: a wide graph pans inside the
          React Flow viewport, the page itself never gets a scrollbar. */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {architecture.isPending || architecture.isError || componentCount === 0 ? (
          <div className="flex h-full items-center justify-center p-4">
            <AsyncState
              isPending={architecture.isPending}
              isError={architecture.isError}
              error={architecture.error}
              isEmpty={componentCount === 0}
              emptyTitle={t('pane.emptyTitle')}
              emptyDescription={t('pane.emptyDescription')}
              onRetry={() => void architecture.refetch()}
              skeletonRows={5}
              className="w-full max-w-2xl"
            >
              {null}
            </AsyncState>
          </div>
        ) : (
          <ArchitectureCanvas
            projectId={projectId}
            model={model}
            selectedComponentId={selectedComponentId}
            selectedRelationshipId={selectedRelationshipId}
            onSelectComponent={onSelectComponent}
            orientation={orientation}
            onOrientationChange={onOrientationChange}
            onSelectRelationship={onSelectRelationship}
            onMetricsChange={onCanvasMetricsChange}
          />
        )}
      </div>

      <div className="border-border bg-card/80 shrink-0 space-y-1.5 border-t px-3 py-2">
        <RelationshipLegend kinds={presentKinds} />
        <StatusLegend />
      </div>
    </section>
  )
}
