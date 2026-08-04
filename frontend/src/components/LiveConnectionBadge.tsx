import { Radio, RefreshCw, WifiOff } from 'lucide-react'

import type { LiveConnectionState } from '@/api/liveStream'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useLiveConnectionStore } from '@/state/liveConnectionStore'

const PRESENTATION: Record<
  LiveConnectionState,
  { label: string; icon: typeof Radio; className: string; hint: string }
> = {
  connecting: {
    label: 'verbindet',
    icon: RefreshCw,
    className: 'text-live-reconnecting',
    hint: 'Die Live-Verbindung wird aufgebaut.',
  },
  live: {
    label: 'live',
    icon: Radio,
    className: 'text-live-connected',
    hint: 'Ereignisse treffen in Echtzeit ein.',
  },
  reconnecting: {
    label: 'verbindet neu',
    icon: RefreshCw,
    className: 'text-live-reconnecting',
    hint:
      'Die Live-Verbindung ist unterbrochen und wird ab der zuletzt gesehenen Position ' +
      'fortgesetzt. Die angezeigten Daten bleiben erhalten.',
  },
  offline: {
    label: 'offline',
    icon: WifiOff,
    className: 'text-live-offline',
    hint:
      'Keine Live-Verbindung. Angezeigt wird der zuletzt geladene Stand — er wird ' +
      'nicht mehr aktualisiert.',
  },
}

/**
 * Shows the state of the SSE stream, strictly separate from the data.
 *
 * A reconnect changes this badge and nothing else: the panes keep rendering the
 * last loaded snapshot, which is what the acceptance criteria require.
 */
export function LiveConnectionBadge({ className }: { className?: string }) {
  const state = useLiveConnectionStore((store) => store.state)
  const lastEventPosition = useLiveConnectionStore((store) => store.lastEventPosition)
  const presentation = PRESENTATION[state]
  const Icon = presentation.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn('gap-1.5 font-normal', className)}
          data-testid="live-connection-state"
          data-state={state}
          aria-label={`Live-Verbindung: ${presentation.label}`}
        >
          <Icon
            aria-hidden="true"
            className={cn(
              'size-3',
              presentation.className,
              state === 'reconnecting' || state === 'connecting' ? 'animate-spin' : '',
            )}
          />
          {presentation.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{presentation.hint}</p>
        {lastEventPosition !== null && (
          <p className="mt-1 opacity-80">
            Zuletzt verarbeitete Position: {lastEventPosition}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
