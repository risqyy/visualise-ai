import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

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
 * The collapsed text always has a line limit. Its actual overflow determines
 * whether a disclosure is needed, including after pane or font changes. A
 * short report in a narrow row can overflow just as a long report can.
 */

const CLAMP_CLASS = {
  1: 'line-clamp-1',
  2: 'line-clamp-2',
  3: 'line-clamp-3',
} as const

export interface ClippedReportedTextProps {
  /** The reported string, quoted verbatim. */
  text: string
  /** Already-translated name of *which* reported text this is. */
  subject: string
  /** Whose report it is; also part of the accessible name. */
  agentName: string
  /** Lines painted while clipped. */
  lines: 1 | 2 | 3
  testId: string
}

/**
 * Named `ClippedReportedText` since #42, so it cannot be confused with the
 * one-element `<ReportedText>` of `src/i18n`. Both mark reported data — this
 * one adds the clipping and the disclosure control, and it emits the same
 * `translate="no"` / `data-reported` pair, so a task description is out of
 * reach of a browser's own page translation as well.
 */
export function ClippedReportedText({
  text,
  subject,
  agentName,
  lines,
  testId,
}: ClippedReportedTextProps) {
  const { t } = useTranslation('agents')
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const textRef = useRef<HTMLSpanElement>(null)
  const textId = useId()

  useLayoutEffect(() => {
    const element = textRef.current
    // Retain the collapse action while expanded. Measure again after the
    // reader collapses, when the browser paints the line-limited box.
    if (!element || expanded) return
    const measure = () => setOverflowing(
      element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1,
    )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    document.fonts?.addEventListener('loadingdone', measure)
    return () => {
      observer.disconnect()
      document.fonts?.removeEventListener('loadingdone', measure)
    }
  }, [expanded, lines, text])

  const clipped = overflowing && !expanded

  return (
    <>
      <span
        ref={textRef}
        id={textId}
        data-testid={testId}
        data-clipped={clipped ? 'true' : 'false'}
        data-full-length={text.length}
        translate="no"
        data-reported=""
        className={cn('block [overflow-wrap:anywhere]', !expanded && CLAMP_CLASS[lines])}
      >
        {text}
      </span>
      {(overflowing || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          // Both the subject and the reported agent name are interpolated into
          // one sentence per language: the word order differs between them.
          aria-label={t(expanded ? 'row.textCollapse' : 'row.textExpand', {
            subject,
            agent: agentName,
          })}
          data-testid={`${testId}-toggle`}
          onClick={() => setExpanded((current) => !current)}
          className={cn(
            'text-muted-foreground hover:text-foreground focus-visible:ring-ring',
            'mt-0.5 rounded-sm text-xs underline underline-offset-2',
            'focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          {expanded ? t('row.showLess') : t('row.showFull')}
        </button>
      )}
    </>
  )
}
