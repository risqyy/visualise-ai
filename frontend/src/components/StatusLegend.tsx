import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
import { WORK_STATES, WORK_STATE_DISCLAIMER_KEY } from '@/state/workStates'

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
  const { t } = useTranslation('canvas')

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      <span className="pane-heading">{t('legend.workStateTitle')}</span>
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
              <span className="text-xs">{t(state.labelKey)}</span>
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
  const { t } = useTranslation('canvas')
  const { t: tCommon } = useTranslation('common')

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs">
          <Info className="size-3.5" aria-hidden="true" />
          {t('legend.explain')}
        </Button>
      </DialogTrigger>
      {/* shadcn ships the close control with a hard-coded English "Close";
          `closeLabel` is what replaces it with the catalogue's word (#42). */}
      <DialogContent className="sm:max-w-xl" closeLabel={tCommon('action.close')}>
        <DialogHeader>
          <DialogTitle>{t('legend.dialogTitle')}</DialogTitle>
          <DialogDescription>{t(WORK_STATE_DISCLAIMER_KEY)}</DialogDescription>
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
                    {t(state.labelKey)}
                    <WorkStateLine
                      dasharray={state.strokeDasharray}
                      colorVar={state.colorVar}
                    />
                  </dt>
                  <dd className="text-muted-foreground text-xs">
                    {t(state.descriptionKey)}
                  </dd>
                </div>
              </div>
            )
          })}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
