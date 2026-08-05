import type { Page } from '@playwright/test'

/**
 * Two layout questions the acceptance run has to be able to ask at more than
 * one window width.
 *
 * `08-viewport.spec.ts` asks both of them at exactly 1920 × 1080, in the
 * arithmetic of that resolution, because that is the mandatory acceptance
 * surface (ADR 0013). The i18n check (#37) has to ask them again at 1280 and
 * 1440, in two languages and once more with 35 % longer text, which is nine
 * combinations — so the questions are asked here as functions of the width
 * instead of being written out nine times.
 *
 * Nothing in this file weakens check 8. It stays exactly as it was, with its
 * own assertions, at its own resolution.
 */

export interface PageOverflow {
  innerWidth: number
  documentScrollWidth: number
  documentClientWidth: number
  bodyScrollWidth: number
  bodyClientWidth: number
  /** Elements sticking out past the right edge without a clipping container. */
  offenders: string[]
}

/**
 * Whether the page itself scrolls sideways, and what pushed it if it does.
 *
 * The "contained by its own scroller" exception is the same one check 8 makes,
 * and for the same reason: a diff box, a markdown table and the React Flow
 * canvas are all wider than their box on purpose. Content sticking out of the
 * *page* is the defect; content sticking out of a scroll container is a
 * feature.
 */
export async function readPageOverflow(page: Page, width: number): Promise<PageOverflow> {
  return page.evaluate((limit) => {
    const containedByItsOwnScroller = (element: Element): boolean => {
      let ancestor = element.parentElement
      while (ancestor !== null && ancestor !== document.body) {
        const style = window.getComputedStyle(ancestor)
        if (style.overflowX !== 'visible' || style.overflow !== 'visible') {
          if (ancestor.getBoundingClientRect().right <= limit + 1) return true
        }
        ancestor = ancestor.parentElement
      }
      return false
    }

    const offenders: string[] = []
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.right <= limit + 1) continue
      if (containedByItsOwnScroller(element)) continue
      const testId = element.getAttribute('data-testid')
      offenders.push(
        `${element.tagName.toLowerCase()}${testId === null ? '' : `[${testId}]`} right=${Math.round(rect.right)}`,
      )
    }

    return {
      innerWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      offenders: offenders.slice(0, 12),
    }
  }, width)
}

export interface TextProbe {
  name: string
  selector: string
}

export interface TextReport {
  name: string
  selector: string
  found: boolean
  /** What the element says, shortened for the failure message. */
  text: string
  /** Wider than its box **and** the excess is unreachable. */
  clippedHorizontally: boolean
  /** Taller than its box and the excess is unreachable. */
  clippedVertically: boolean
  /** The whole box lies inside the viewport. */
  insideViewport: boolean
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
}

/**
 * Whether a text is cut off — as the browser lays it out, not as the DOM
 * describes it.
 *
 * "Cut off" is `scrollWidth > clientWidth` **and** an `overflow` that hides the
 * rest. An element with `overflow-x: auto` is wider than its box and perfectly
 * readable, because the reader can scroll it; an element with
 * `overflow: hidden` or `text-overflow: ellipsis` is wider than its box and the
 * rest is gone. Only the second is a defect, and only the second is reported
 * here — which is what keeps this check from going red on the diff view that is
 * *designed* to scroll sideways.
 */
export async function probeTexts(
  page: Page,
  probes: readonly TextProbe[],
): Promise<TextReport[]> {
  return page.evaluate((list) => {
    return list.map((probe) => {
      const element = document.querySelector(probe.selector)
      if (element === null) {
        return {
          name: probe.name,
          selector: probe.selector,
          found: false,
          text: '',
          clippedHorizontally: false,
          clippedVertically: false,
          insideViewport: false,
          scrollWidth: 0,
          clientWidth: 0,
          scrollHeight: 0,
          clientHeight: 0,
        }
      }

      const style = window.getComputedStyle(element)
      const hides = (value: string) => value === 'hidden' || value === 'clip'
      const rect = element.getBoundingClientRect()

      return {
        name: probe.name,
        selector: probe.selector,
        found: true,
        text: (element.textContent ?? '').trim().slice(0, 80),
        clippedHorizontally:
          element.scrollWidth > element.clientWidth + 1 &&
          (hides(style.overflowX) || style.textOverflow === 'ellipsis'),
        clippedVertically:
          element.scrollHeight > element.clientHeight + 1 && hides(style.overflowY),
        insideViewport:
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= window.innerWidth + 1 &&
          rect.bottom <= window.innerHeight + 1,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }
    })
  }, [...probes])
}

/** Renders a report list for an assertion message. */
export function formatTextReports(reports: readonly TextReport[]): string {
  return reports
    .map(
      (report) =>
        `  ${report.name} (${report.selector}): found=${report.found} ` +
        `clippedX=${report.clippedHorizontally} clippedY=${report.clippedVertically} ` +
        `inside=${report.insideViewport} ` +
        `${report.scrollWidth}/${report.clientWidth}px × ${report.scrollHeight}/${report.clientHeight}px ` +
        `"${report.text}"`,
    )
    .join('\n')
}

/** Every reported value on screen, in document order and byte for byte. */
export async function readReportedValues(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-reported]')).map(
      (node) => node.textContent ?? '',
    ),
  )
}
