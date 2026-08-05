import { useId, useState } from 'react'

import { cn } from '@/lib/utils'

import { AGENT_PANE_TEXT, textToggleLabel } from './paneText'

/**
 * A reported text that is **clipped, never shortened**.
 *
 * Assigned tasks and status messages are agent reports: a root orchestrator's
 * task can be a whole paragraph, and a subagent's task can be three issue titles
 * chained with `·`. Painted in full, a handful of those rows push everything
 * else out of a 346 px pane. Painted with an ellipsis produced in JavaScript,
 * the cockpit would be storing a shortened version of what an agent said.
 *
 * So the clipping is done by CSS `line-clamp` only, and the rule that follows
 * from it is the point of this module:
 *
 * * the **complete** string is always in the DOM and always in the accessibility
 *   tree — it is selectable, copyable, findable with the browser's own search,
 *   and read out in full by a screen reader, whether the control was used or not;
 * * the control changes how many lines are painted and nothing else;
 * * no substring is ever computed, so there is no code path on which a report
 *   could reach the user altered.
 *
 * The control appears only when the text is long enough to be clipped. That is
 * decided by a character budget rather than by measuring the rendered box: the
 * budget is deterministic, it does not depend on the current pane width, and it
 * is therefore the same in the browser and in a test.
 */

/**
 * Characters above which a reported text gets a disclosure control.
 *
 * The left pane is ~346 px wide at the acceptance resolution, which carries
 * roughly 45 characters per line at 12 px. Two clamped lines are therefore
 * around 90 characters — the point from which a text starts being cut off.
 */
export const CLAMP_CHARS = 90

const CLAMP_CLASS = {
  1: 'line-clamp-1',
  2: 'line-clamp-2',
  3: 'line-clamp-3',
} as const

export interface ReportedTextProps {
  /** The reported string, quoted verbatim. */
  text: string
  /** Names the reported text in the control's accessible name. */
  subject: string
  /** Whose report it is; also part of the accessible name. */
  agentName: string
  /** Lines painted while clipped. */
  lines: 1 | 2 | 3
  testId: string
}

export function ReportedText({
  text,
  subject,
  agentName,
  lines,
  testId,
}: ReportedTextProps) {
  const [expanded, setExpanded] = useState(false)
  const textId = useId()

  const clampable = text.length > CLAMP_CHARS
  const clipped = clampable && !expanded

  return (
    <>
      <span
        id={textId}
        data-testid={testId}
        data-clipped={clipped ? 'true' : 'false'}
        data-full-length={text.length}
        className={cn('block', clipped && CLAMP_CLASS[lines])}
      >
        {text}
      </span>
      {clampable && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          aria-label={textToggleLabel(subject, agentName, expanded)}
          data-testid={`${testId}-toggle`}
          onClick={() => setExpanded((current) => !current)}
          className={cn(
            'text-muted-foreground hover:text-foreground focus-visible:ring-ring',
            'mt-0.5 rounded-sm text-xs underline underline-offset-2',
            'focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          {expanded ? AGENT_PANE_TEXT.showLessText : AGENT_PANE_TEXT.showFullText}
        </button>
      )}
    </>
  )
}
