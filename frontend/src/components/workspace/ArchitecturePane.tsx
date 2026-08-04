import { useMemo } from 'react'

import { useArchitecture } from '@/api/queries'
import type { ComponentId, ProjectId } from '@/api/types'
import { ArchitectureCanvas } from '@/canvas/ArchitectureCanvas'
import { AsyncState } from '@/components/AsyncState'
import { StatusLegend } from '@/components/StatusLegend'
import { PaneHeader } from '@/components/workspace/PaneHeader'
import { RelationshipLegend } from '@/components/workspace/RelationshipLegend'
import { Badge } from '@/components/ui/badge'

export interface ArchitecturePaneProps {
  projectId: ProjectId
  /** Selection from the URL; the canvas mirrors it, it never owns it. */
  selectedComponentId?: ComponentId | undefined
  /** Writes the selection back into the `component` search param. */
  onSelectComponent: (componentId: ComponentId | null) => void
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
  onSelectComponent,
}: ArchitecturePaneProps) {
  const architecture = useArchitecture(projectId)

  const componentCount = architecture.data?.components.length ?? 0
  const relationshipCount = architecture.data?.relationships.length ?? 0
  const activeChangeCount = architecture.data?.activeChanges.length ?? 0

  // Kept stable across refetches: TanStack Query's structural sharing returns
  // the same arrays when nothing changed, so the canvas does not re-layout.
  const model = useMemo(
    () => ({
      components: architecture.data?.components ?? [],
      relationships: architecture.data?.relationships ?? [],
    }),
    [architecture.data?.components, architecture.data?.relationships],
  )

  return (
    <section
      className="pane-surface bg-canvas"
      aria-label="Architekturfläche"
      data-testid="pane-architecture"
    >
      <PaneHeader
        title="Architektur"
        subtitle={projectId}
        actions={
          architecture.isSuccess && (
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-2xs font-normal">
                {componentCount} Komponenten
              </Badge>
              <Badge variant="outline" className="text-2xs font-normal">
                {relationshipCount} Beziehungen
              </Badge>
              <Badge variant="outline" className="text-2xs font-normal">
                {activeChangeCount} aktive Änderungen
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
              emptyTitle="Noch kein Architekturmodell gemeldet"
              emptyDescription="Das Modell erscheint, sobald ein Agent architecture.snapshot_published sendet."
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
            onSelectComponent={onSelectComponent}
          />
        )}
      </div>

      <div className="border-border bg-card/80 shrink-0 space-y-1.5 border-t px-3 py-2">
        <RelationshipLegend />
        <StatusLegend />
      </div>
    </section>
  )
}
