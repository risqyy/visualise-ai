import { Outlet } from '@tanstack/react-router'

import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Application shell. Holds exactly the providers that must exist for every
 * route and nothing else — the routes own their own chrome.
 */
export function RootLayout() {
  return (
    <TooltipProvider delayDuration={300}>
      {/* `overflow-hidden` here is what keeps the page free of an unintended
          horizontal scrollbar at 1920 × 1080: wide content scrolls inside its
          own container instead. */}
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
        <Outlet />
      </div>
    </TooltipProvider>
  )
}
