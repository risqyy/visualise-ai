import { Radio, RefreshCw, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { LiveConnectionState } from '@/api/liveStream'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ReportedText, type WorkspaceKey } from '@/i18n'
import { cn } from '@/lib/utils'
import { useLiveConnectionStore } from '@/state/liveConnectionStore'

/**
 * The four connection states, as icon, colour and **translation keys**.
 *
 * `connecting`, `live`, `reconnecting` and `offline` on the left are the states
 * of the SSE client and never change; the words on the right are the cockpit's
 * own vocabulary and come from the catalogue (#42).
 */
const PRESENTATION: Record<
  LiveConnectionState,
  { labelKey: WorkspaceKey; icon: typeof Radio; className: string; hintKey: WorkspaceKey }
> = {
  connecting: {
    labelKey: 'live.connectingLabel',
    icon: RefreshCw,
    className: 'text-live-reconnecting',
    hintKey: 'live.connectingHint',
  },
  live: {
    labelKey: 'live.liveLabel',
    icon: Radio,
    className: 'text-live-connected',
    hintKey: 'live.liveHint',
  },
  reconnecting: {
    labelKey: 'live.reconnectingLabel',
    icon: RefreshCw,
    className: 'text-live-reconnecting',
    hintKey: 'live.reconnectingHint',
  },
  offline: {
    labelKey: 'live.offlineLabel',
    icon: WifiOff,
    className: 'text-live-offline',
    hintKey: 'live.offlineHint',
  },
}

/**
 * Shows the state of the SSE stream, strictly separate from the data.
 *
 * A reconnect changes this badge and nothing else: the panes keep rendering the
 * last loaded snapshot, which is what the acceptance criteria require.
 */
export function LiveConnectionBadge({ className }: { className?: string }) {
  const { t } = useTranslation('workspace')
  const state = useLiveConnectionStore((store) => store.state)
  const lastEventPosition = useLiveConnectionStore((store) => store.lastEventPosition)
  const presentation = PRESENTATION[state]
  const Icon = presentation.icon
  const label = t(presentation.labelKey)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn('gap-1.5 font-normal', className)}
          data-testid="live-connection-state"
          data-state={state}
          aria-label={t('live.label', { state: label })}
        >
          <Icon
            aria-hidden="true"
            className={cn(
              'size-3',
              presentation.className,
              state === 'reconnecting' || state === 'connecting' ? 'animate-spin' : '',
            )}
          />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p>{t(presentation.hintKey)}</p>
        {lastEventPosition !== null && (
          <p className="mt-1 opacity-80">
            {/* The position is the server's own event number — reported data. */}
            {t('live.lastPositionLabel')}{' '}
            <ReportedText value={String(lastEventPosition)} />
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
