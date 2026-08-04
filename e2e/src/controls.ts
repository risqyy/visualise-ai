import type { Page } from '@playwright/test'

/**
 * Whether a primary control is actually operable, not merely present.
 *
 * "Not covered" is asked of the browser rather than of the DOM tree:
 * `elementFromPoint` at the control's own centre must land on the control or on
 * something inside it. A pane that overlaps it, a banner that grew over it or a
 * z-index accident therefore fails the check, which asserting `toBeVisible()`
 * alone would not.
 */

export interface ControlProbe {
  /** Human-readable name, used in the failure message. */
  name: string
  selector: string
}

export interface ControlReport {
  name: string
  selector: string
  found: boolean
  /** Rendered with a non-zero box and no `visibility`/`display` suppression. */
  rendered: boolean
  /** The whole box lies inside the 1920 × 1080 viewport. */
  insideViewport: boolean
  /** `elementFromPoint` at the centre resolves to the control itself. */
  unobstructed: boolean
  box: { x: number; y: number; width: number; height: number } | null
  /** What actually sits at the centre point, when something else does. */
  obstructedBy: string | null
}

export async function probeControls(
  page: Page,
  probes: readonly ControlProbe[],
): Promise<ControlReport[]> {
  return page.evaluate((list) => {
    const describe = (element: Element): string => {
      const testId = element.getAttribute('data-testid')
      const label = element.getAttribute('aria-label')
      return [
        element.tagName.toLowerCase(),
        testId === null ? '' : `[data-testid="${testId}"]`,
        label === null ? '' : `[aria-label="${label}"]`,
        element.className && typeof element.className === 'string'
          ? `.${element.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')}`
          : '',
      ].join('')
    }

    return list.map((probe) => {
      const element = document.querySelector(probe.selector)
      if (element === null) {
        return {
          name: probe.name,
          selector: probe.selector,
          found: false,
          rendered: false,
          insideViewport: false,
          unobstructed: false,
          box: null,
          obstructedBy: null,
        }
      }

      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      const rendered =
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity) > 0

      const insideViewport =
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight

      const centreX = rect.left + rect.width / 2
      const centreY = rect.top + rect.height / 2
      const top = document.elementFromPoint(centreX, centreY)
      const unobstructed =
        top !== null && (top === element || element.contains(top) || top.contains(element))

      return {
        name: probe.name,
        selector: probe.selector,
        found: true,
        rendered,
        insideViewport,
        unobstructed,
        box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        obstructedBy: unobstructed || top === null ? null : describe(top),
      }
    })
  }, [...probes])
}

/** Renders a report list for an assertion message. */
export function formatControlReports(reports: readonly ControlReport[]): string {
  return reports
    .map(
      (report) =>
        `  ${report.name} (${report.selector}): found=${report.found} rendered=${report.rendered} ` +
        `insideViewport=${report.insideViewport} unobstructed=${report.unobstructed}` +
        (report.obstructedBy === null ? '' : ` coveredBy=${report.obstructedBy}`) +
        (report.box === null
          ? ''
          : ` box=${Math.round(report.box.x)},${Math.round(report.box.y)} ` +
            `${Math.round(report.box.width)}×${Math.round(report.box.height)}`),
    )
    .join('\n')
}
