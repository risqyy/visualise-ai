import { RELATIONSHIP_KIND_STYLES } from '@/canvas/relationshipKinds'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Legend for the six relationship kinds of the contract.
 *
 * The canvas encodes a kind through its stroke pattern, its arrow head and a
 * text badge — never through colour, because the accent hues belong to the work
 * states. This legend shows exactly those three channels, so it stays readable
 * in greyscale and matches what is drawn on the canvas one for one.
 */
export function RelationshipLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      <span className="pane-heading">Beziehungsarten</span>
      <ul
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
        data-testid="relationship-legend"
      >
        {RELATIONSHIP_KIND_STYLES.map((style) => (
          <li key={style.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="flex items-center gap-1.5"
                  data-testid={`relationship-legend-${style.id}`}
                  data-dasharray={style.strokeDasharray}
                  data-marker={style.marker}
                >
                  <RelationshipLine
                    dasharray={style.strokeDasharray}
                    marker={style.marker}
                  />
                  <span className="font-mono text-[11px]">{style.abbreviation}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">{style.label}</p>
                <p className="text-xs">{style.description}</p>
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The two colour-independent line channels, drawn at legend size. */
function RelationshipLine({
  dasharray,
  marker,
}: {
  dasharray: string
  marker: 'arrow' | 'arrowclosed'
}) {
  const markerId = `legend-marker-${marker}`
  return (
    <svg
      aria-hidden="true"
      width="30"
      height="8"
      viewBox="0 0 30 8"
      className="text-muted-foreground shrink-0"
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX={marker === 'arrow' ? 8 : 9}
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          {marker === 'arrowclosed' ? (
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          ) : (
            <path
              d="M 1 1 L 9 5 L 1 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          )}
        </marker>
      </defs>
      <line
        x1="0"
        y1="4"
        x2="24"
        y2="4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray={dasharray === '0' ? undefined : dasharray}
        markerEnd={`url(#${markerId})`}
      />
    </svg>
  )
}
