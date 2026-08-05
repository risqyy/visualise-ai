import { useTranslation } from 'react-i18next'

import type { WorkStateCounts } from '@/canvas/changeOverlays'
import { cn } from '@/lib/utils'
import { WORK_STATES } from '@/state/workStates'

/**
 * The live counter of what the agents are currently doing to the model.
 *
 * Deliberately unexciting. It is read while an agent works and it changes
 * whenever an event arrives, so it must never draw the eye away from the
 * canvas:
 *
 * * no animation, no flashing, no counting-up — the number simply is what it is,
 * * the row does not reflow when a state appears or disappears, because a state
 *   with a count of zero keeps its place and only goes quiet,
 * * `aria-live` is off. A screen reader announcing every incoming event would be
 *   the auditory version of a camera that jumps.
 *
 * Each entry carries its icon and its label, so the counter is readable without
 * colour like everything else in this product.
 */
export interface ChangeCounterProps {
  counts: WorkStateCounts
  className?: string
}

export function ChangeCounter({ counts, className }: ChangeCounterProps) {
  const { t } = useTranslation('canvas')
  const total = WORK_STATES.reduce((sum, state) => sum + counts[state.id], 0)

  return (
    <span
      className={cn('flex items-center gap-2', className)}
      data-testid="change-counter"
      data-total={total}
      aria-label={
        total === 0
          ? t('counter.none')
          : WORK_STATES.filter((state) => counts[state.id] > 0)
              .map((state) => `${counts[state.id]} ${t(state.labelKey)}`)
              .join(', ')
      }
    >
      {WORK_STATES.map((state) => {
        const count = counts[state.id]
        const Icon = state.icon
        return (
          <span
            key={state.id}
            className={cn(
              'flex items-center gap-1 text-[11px] whitespace-nowrap',
              'transition-opacity duration-150',
              count === 0 ? 'text-muted-foreground/45' : 'text-muted-foreground',
            )}
            data-testid={`change-counter-${state.id}`}
            data-count={count}
            title={t(state.descriptionKey)}
          >
            <Icon
              className={cn('size-3.5 shrink-0', count > 0 && state.colorClass)}
              aria-hidden="true"
            />
            <span className="tabular-nums">{count}</span>
            <span>{t(state.labelKey)}</span>
          </span>
        )
      })}
    </span>
  )
}
