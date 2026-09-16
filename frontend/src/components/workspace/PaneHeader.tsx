import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface PaneHeaderProps {
  title: string
  headingId?: string
  /** Short, neutral subtitle — usually the id the pane is bound to. */
  subtitle?: ReactNode
  actions?: ReactNode
  actionsClassName?: string
  className?: string
}

/** Shared header row of the three panes. Keeps the panes visually identical. */
export function PaneHeader({
  title,
  headingId,
  subtitle,
  actions,
  actionsClassName,
  className,
}: PaneHeaderProps) {
  return (
    <div
      className={cn(
        'border-border flex h-10 shrink-0 items-center gap-2 border-b px-3',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col">
        <h2
          id={headingId}
          tabIndex={headingId ? -1 : undefined}
          className="pane-heading focus-visible:outline-ring truncate focus-visible:outline-2"
        >{title}</h2>
        {subtitle !== undefined && (
          <span className="text-muted-foreground truncate text-xs">{subtitle}</span>
        )}
      </div>
      {actions && (
        <div className={cn('ml-auto flex shrink-0 items-center gap-1', actionsClassName)}>
          {actions}
        </div>
      )}
    </div>
  )
}
