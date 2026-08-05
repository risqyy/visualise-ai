import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { WORK_STATE_BY_ID } from '@/state/workStates'

import { overlayLabel, overlayTitle, type ChangeOverlay } from './changeOverlays'

/**
 * The visible mark of a work state, on a node or on an edge.
 *
 * **Colour is never the only channel here, and the mark is the reason.** It
 * always renders
 *
 * 1. the state's **icon** (a distinct glyph per state),
 * 2. the state's **label as text** — `geplant`, `aktiv`, `kürzlich angewandt`,
 *    `entfernt` — extended by the operation, so `geplant · entfernen` and
 *    `geplant · hinzufügen` are told apart by words rather than by hue, and
 * 3. a border in the state's **line style** (dashed, double, solid, dotted),
 *
 * with the colour on top of all three. A greyscale screenshot of the canvas
 * loses nothing, and `data-work-state-label`, `data-border-style` and
 * `data-operation` make that testable without looking at a single colour.
 *
 * When more than one agent reported for the same element, the count is shown
 * next to the label and every single contribution is listed in the `title`.
 * Nothing is merged away: two agents working on one component must be visible
 * as two.
 */
export interface ChangeOverlayMarkProps {
  overlay: ChangeOverlay
  /** Drops the label text when the surrounding box is too small for it. */
  compact?: boolean
  className?: string
}

export function ChangeOverlayMark({
  overlay,
  compact = false,
  className,
}: ChangeOverlayMarkProps) {
  const { t } = useTranslation('canvas')
  const definition = WORK_STATE_BY_ID[overlay.state]
  const Icon = definition.icon
  const label = overlayLabel(overlay, t)
  const agentCount = overlay.agentIds.length

  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1 rounded-sm border px-1 py-px text-[10px] leading-tight',
        'bg-card/90',
        className,
      )}
      style={{
        borderColor: `var(${definition.colorVar})`,
        borderStyle: definition.borderStyle,
        color: `var(${definition.colorVar})`,
      }}
      title={overlayTitle(overlay, t)}
      data-testid={`overlay-mark-${overlay.targetKind}-${overlay.targetId}`}
      data-work-state={overlay.state}
      data-work-state-label={t(definition.labelKey)}
      data-border-style={definition.borderStyle}
      data-dasharray={definition.strokeDasharray}
      data-operation={overlay.operation ?? 'none'}
      data-presence={overlay.presence}
      data-agent-count={agentCount}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {compact ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="truncate">{label}</span>
      )}
      {agentCount > 1 && (
        <span className="inline-flex shrink-0 items-center gap-0.5 font-medium">
          <Users className="size-3" aria-hidden="true" />
          {agentCount}
          <span className="sr-only"> {t('overlay.agentsReporting')}</span>
        </span>
      )}
    </span>
  )
}
