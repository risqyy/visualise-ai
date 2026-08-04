import { Boxes } from 'lucide-react'

import { useArchitecture } from '@/api/queries'
import type { ProjectId } from '@/api/types'
import { AsyncState } from '@/components/AsyncState'
import { StatusLegend } from '@/components/StatusLegend'
import { PaneHeader } from '@/components/workspace/PaneHeader'
import { Badge } from '@/components/ui/badge'

export interface ArchitecturePaneProps {
  projectId: ProjectId
}

/**
 * Centre pane: the architecture surface.
 *
 * It stays the visually dominant area at 1920 × 1080 — it gets the largest
 * default share of the layout, the brightest surface and the only unbounded
 * region of the workspace. The interactive React Flow canvas with the ELK layout
 * is built in #9; this pane provides the named, correctly sized region, the
 * loading/error/empty states of the architecture read model and the accessible
 * work-state legend the overlays (#10) will use.
 */
export function ArchitecturePane({ projectId }: ArchitecturePaneProps) {
  const architecture = useArchitecture(projectId)

  const componentCount = architecture.data?.components.length ?? 0
  const relationshipCount = architecture.data?.relationships.length ?? 0
  const activeChangeCount = architecture.data?.activeChanges.length ?? 0

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

      {/* The canvas region owns its own overflow: wide graphs scroll here, the
          page itself never gets a horizontal scrollbar. */}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-auto p-4">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          aria-hidden="true"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--canvas-grid) 1px, transparent 1px),' +
              'linear-gradient(to bottom, var(--canvas-grid) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="relative flex h-full min-h-64 items-center justify-center">
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
            <div
              className="border-border/70 bg-card/60 text-muted-foreground max-w-2xl rounded-lg border border-dashed p-6 text-center"
              data-testid="architecture-canvas-placeholder"
            >
              <Boxes className="mx-auto mb-2 size-6" aria-hidden="true" />
              <p className="text-foreground/80 font-medium">
                Interaktiver Architekturcanvas folgt
              </p>
              <p className="mt-1 text-xs">
                Der hierarchische React-Flow-Canvas mit deterministischem ELK-Layout wird in
                einem eigenen Arbeitspaket ergänzt. Das Modell wird hier bereits geladen und
                bei Live-Ereignissen gezielt invalidiert.
              </p>
              <p className="mt-3 font-mono text-xs">
                {componentCount} Komponenten · {relationshipCount} Beziehungen ·{' '}
                {activeChangeCount} aktive Änderungen
              </p>
            </div>
          </AsyncState>
        </div>
      </div>

      <div className="border-border bg-card/80 shrink-0 border-t px-3 py-2">
        <StatusLegend />
      </div>
    </section>
  )
}
