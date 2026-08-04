import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { WORK_STATES, WORK_STATE_DISCLAIMER } from '@/state/workStates'

/**
 * Accessible legend for the four v0 work states.
 *
 * Accessibility is structural here, not decorative: every entry carries a text
 * label and an icon **and** a line style, so the state is readable without any
 * colour perception at all. The disclaimer is part of the legend, not a
 * footnote — the colours describe a phase of work and must not be read as a
 * judgement of the agent's output.
 */
export function StatusLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      <span className="pane-heading">Arbeitszustände</span>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {WORK_STATES.map((state) => {
          const Icon = state.icon
          return (
            <li key={state.id} className="flex items-center gap-1.5">
              <Icon
                aria-hidden="true"
                className={cn('size-3.5 shrink-0', state.colorClass)}
              />
              <WorkStateLine
                dasharray={state.strokeDasharray}
                colorVar={state.colorVar}
              />
              <span className="text-xs">{state.label}</span>
            </li>
          )
        })}
      </ul>
      <StatusLegendDialog />
    </div>
  )
}

/** The colour-independent second channel: one distinct stroke pattern per state. */
function WorkStateLine({ dasharray, colorVar }: { dasharray: string; colorVar: string }) {
  return (
    <svg aria-hidden="true" width="22" height="6" viewBox="0 0 22 6" className="shrink-0">
      <line
        x1="0"
        y1="3"
        x2="22"
        y2="3"
        stroke={`var(${colorVar})`}
        strokeWidth="2"
        strokeDasharray={dasharray === '0' ? undefined : dasharray}
      />
    </svg>
  )
}

/** Full explanation, including what the colours explicitly do *not* mean. */
export function StatusLegendDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs">
          <Info className="size-3.5" aria-hidden="true" />
          Legende erklären
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Arbeitszustände der Agents</DialogTitle>
          <DialogDescription>{WORK_STATE_DISCLAIMER}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-3">
          {WORK_STATES.map((state) => {
            const Icon = state.icon
            return (
              <div key={state.id} className="flex gap-3">
                <Icon
                  aria-hidden="true"
                  className={cn('mt-0.5 size-4 shrink-0', state.colorClass)}
                />
                <div className="min-w-0">
                  <dt className="flex items-center gap-2 font-medium">
                    {state.label}
                    <WorkStateLine
                      dasharray={state.strokeDasharray}
                      colorVar={state.colorVar}
                    />
                  </dt>
                  <dd className="text-muted-foreground text-xs">{state.description}</dd>
                </div>
              </div>
            )
          })}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
