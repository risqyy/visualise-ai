import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { MAIN_PROJECT, MAIN_RUN } from '../src/config.js'
import { formatControlReports, probeControls, type ControlProbe } from '../src/controls.js'
import {
  formatTextReports,
  probeTexts,
  readPageOverflow,
  readReportedValues,
  type TextProbe,
} from '../src/layout.js'
import { applyPseudoLocale, pseudoLocaleStillApplied } from '../src/pseudoLocale.js'

/**
 * Check 9 — translations may not break the desktop layout (#37).
 *
 * Checks 1–8 are the v0 acceptance run and are untouched: they still run first,
 * still in German, still at exactly 1920 × 1080, still with the same
 * assertions. This file runs last and adds the three axes the localisation
 * epic introduced.
 *
 * **Three widths.** 1920 is the mandatory acceptance surface (ADR 0013) and
 * stays that. 1440 and 1280 are the two other ordinary desktop situations ADR
 * 0015 names — an unmaximised window, and 1920 at 150 % browser zoom, which is
 * an accessibility setting rather than a different device. The pane minimums
 * add up to 1100 px, so 1280 is the width at which the layout has the least
 * room and therefore the width at which a longer word first hurts.
 *
 * **Two languages.** German and English go through the same path, at the same
 * three widths, with language-independent selectors — a check written against
 * `aria-label="Agents filtern"` would only ever have run in German.
 *
 * **One artificial third.** Every word the cockpit owns, 35 % longer. See
 * `src/pseudoLocale.ts` for why that is a DOM transformation here and a
 * generated catalogue in the frontend suite.
 *
 * ## Screenshots are artefacts, not baselines
 *
 * The issue asks for desktop screenshots at the three widths. They are
 * **attached to the report**, and nothing is compared against a committed
 * image.
 *
 * `toHaveScreenshot()` compares rendered pixels, and rendered pixels depend on
 * the font stack, on hinting and on subpixel positioning — a baseline recorded
 * on a Linux container disagrees with the same build on a developer's Windows
 * machine over text that is perfectly correct. This is the release gate of the
 * whole epic; a gate that reports "the letters are 0.4 px wider here" as a
 * failure gets ignored, and an ignored gate is worse than none (ADR 0013).
 *
 * What the issue actually asks for — no cut-off pane titles, buttons, legends
 * or status values — is measured instead, by the browser, on the elements it is
 * asked about: `scrollWidth` against `clientWidth` with an `overflow` that
 * hides the rest. That answer is a number and it is the same number on every
 * machine. The screenshots are what a human looks at afterwards.
 */

const WORKSPACE_URL = `/projects/${MAIN_PROJECT}/runs/${MAIN_RUN}?component=${encodeURIComponent(
  'shop-platform.orders.domain.tax',
)}`

const HEIGHT = 1080

/** 1920 is the acceptance surface; 1440 and 1280 are ADR 0015's other two. */
const WIDTHS = [1920, 1440, 1280] as const

/**
 * The elements the acceptance criteria of #37 name: pane titles, buttons,
 * legends and status values.
 *
 * Every selector is language-independent. That is not tidiness — a probe list
 * written with German accessible names is a probe list that silently finds
 * nothing in the English run and reports "no clipped text" about a screen it
 * never looked at.
 */
const TEXTS: TextProbe[] = [
  { name: 'pane title · run and agents', selector: '[data-testid="pane-run-agents"] h2' },
  { name: 'pane title · architecture', selector: '[data-testid="pane-architecture"] h2' },
  { name: 'pane title · inspector', selector: '[data-testid="pane-inspector"] h2' },
  { name: 'tab · selected', selector: '[role="tab"][aria-selected="true"]' },
  { name: 'tab · unselected', selector: '[role="tab"][aria-selected="false"]' },
  { name: 'button · fit view', selector: '[data-testid="canvas-fit-view"]' },
  { name: 'button · top-down layout', selector: '[data-testid="canvas-layout-top-down"]' },
  { name: 'button · left-to-right layout', selector: '[data-testid="canvas-layout-left-right"]' },
  { name: 'button · minimap', selector: '[data-testid="canvas-toggle-minimap"]' },
  { name: 'button · detail level', selector: '[data-testid="canvas-detail-level"]' },
  { name: 'status value · live connection', selector: '[data-testid="live-connection-state"]' },
  { name: 'status value · run openness', selector: '[data-testid="run-openness"]' },
  { name: 'status value · run state', selector: '[data-testid="run-state"]' },
  { name: 'legend · relationships', selector: '[data-testid="relationship-legend"]' },
  { name: 'legend entry · HTTP', selector: '[data-testid="relationship-legend-http"]' },
  { name: 'legend entry · NATS', selector: '[data-testid="relationship-legend-async"]' },
  { name: 'change counter', selector: '[data-testid="change-counter"]' },
  { name: 'language switch', selector: '[data-testid="language-switcher"]' },
]

/** The primary controls, again with language-independent selectors. */
const CONTROLS: ControlProbe[] = [
  { name: 'run selection (current run)', selector: `[data-testid="run-option-${MAIN_RUN}"]` },
  { name: 'canvas control · fit view', selector: '[data-testid="canvas-fit-view"]' },
  { name: 'canvas control · top-down layout', selector: '[data-testid="canvas-layout-top-down"]' },
  { name: 'canvas control · left-to-right layout', selector: '[data-testid="canvas-layout-left-right"]' },
  { name: 'canvas control · minimap toggle', selector: '[data-testid="canvas-toggle-minimap"]' },
  { name: 'canvas control · zoom in', selector: '.react-flow__controls-zoomin' },
  { name: 'canvas control · zoom out', selector: '.react-flow__controls-zoomout' },
  { name: 'inspector tab · selected', selector: '[role="tab"][aria-selected="true"]' },
  { name: 'inspector tab · unselected', selector: '[role="tab"][aria-selected="false"]' },
  { name: 'live connection badge', selector: '[data-testid="live-connection-state"]' },
  { name: 'pane toggle', selector: 'button[aria-expanded]' },
  { name: 'language switch · German', selector: '[data-testid="language-option-de"]' },
  { name: 'language switch · English', selector: '[data-testid="language-option-en"]' },
]

/** The cockpit, loaded and finished laying out. */
async function openWorkspace(page: Page): Promise<void> {
  await page.goto(WORKSPACE_URL)
  await expect(page.getByTestId('architecture-canvas')).toBeVisible()
  await expect(page.getByTestId('diff-groups')).toBeVisible()
  await expect(page.getByTestId('architecture-canvas')).toHaveAttribute(
    'data-layouting',
    'false',
  )
}

/**
 * Switches the language the way a user does — through the switch #36 added,
 * which is also what proves the switch itself survives every width.
 */
async function chooseLanguage(page: Page, language: 'de' | 'en'): Promise<void> {
  await page.getByTestId(`language-option-${language}`).click()
  await expect(page.locator('html')).toHaveAttribute('lang', language)
  await expect(page.getByTestId(`language-option-${language}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  )
}

/** Everything asserted about one window width, in one place. */
async function assertLayoutHolds(page: Page, width: number, label: string): Promise<void> {
  const geometry = await readPageOverflow(page, width)

  expect(geometry.innerWidth, `${label}: viewport width`).toBe(width)
  expect(
    geometry.documentScrollWidth,
    `${label}: the page must not scroll horizontally`,
  ).toBe(geometry.documentClientWidth)
  expect(geometry.bodyScrollWidth, `${label}: the body must not scroll horizontally`).toBe(
    geometry.bodyClientWidth,
  )
  expect(
    geometry.offenders,
    `${label}: element past the right edge without a clipping container`,
  ).toEqual([])

  const texts = await probeTexts(page, TEXTS)
  const missing = texts.filter((report) => !report.found).map((report) => report.name)
  expect(missing, `${label}: probe found nothing — the check would pass vacuously`).toEqual(
    [],
  )

  const clipped = texts.filter(
    (report) => report.clippedHorizontally || report.clippedVertically,
  )
  expect(
    clipped.length === 0,
    `${label}: text is cut off\n${formatTextReports(clipped)}`,
  ).toBe(true)

  const controls = await probeControls(page, CONTROLS)
  const broken = controls.filter(
    (report) =>
      !report.found || !report.rendered || !report.insideViewport || !report.unobstructed,
  )
  expect(
    broken.length === 0,
    `${label}: primary controls are not operable\n${formatControlReports(controls)}`,
  ).toBe(true)
}

/** Keeps the rendering next to the report, for a human to look at. */
async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  await testInfo.attach(`workspace-${label}.png`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
}

for (const language of ['de', 'en'] as const) {
  test(`9 · the desktop layout holds in ${language} at 1920, 1440 and 1280`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT })
    await openWorkspace(page)
    await chooseLanguage(page, language)

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHT })
      // The ELK layout is keyed on the model and the collapsed set, not on the
      // width (ADR 0021), so a resize does not normally start one. Waiting
      // anyway costs nothing and rules out measuring a canvas mid-layout if a
      // later change makes the width part of that key.
      await expect(page.getByTestId('architecture-canvas')).toHaveAttribute(
        'data-layouting',
        'false',
      )
      await assertLayoutHolds(page, width, `${language} @ ${width}`)
      await attachScreenshot(page, testInfo, `${language}-${width}`)
    }
  })
}

test('9 · a translation 35 per cent longer keeps the layout at 1920, 1440 and 1280', async ({
  page,
}, testInfo) => {
  for (const width of WIDTHS) {
    // Reloaded per width rather than expanded once and resized: the expansion
    // is a DOM edit and React owns this DOM, so a re-render triggered by the
    // resize could quietly restore the short texts.
    await page.setViewportSize({ width, height: HEIGHT })
    await openWorkspace(page)

    const applied = await applyPseudoLocale(page)
    expect(
      applied.textNodes,
      `${width}: nothing was lengthened — the check would pass vacuously`,
    ).toBeGreaterThan(30)
    expect(applied.attributes, `${width}: no accessible name was lengthened`).toBeGreaterThan(
      10,
    )
    expect(
      applied.keptReported,
      `${width}: no reported value was recognised — the exclusion is not working`,
    ).toBeGreaterThan(0)

    await assertLayoutHolds(page, width, `pseudo @ ${width}`)

    // The measurement above is only worth anything if the long text was still
    // on screen while it was taken.
    expect(
      await pseudoLocaleStillApplied(page),
      `${width}: React re-rendered over the lengthened text`,
    ).toBe(true)

    await attachScreenshot(page, testInfo, `pseudo-${width}`)
  }
})

test('9 · reported project data is identical in German, English and the pseudo-locale', async ({
  page,
}) => {
  await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT })
  await openWorkspace(page)

  await chooseLanguage(page, 'de')
  const german = await readReportedValues(page)

  await chooseLanguage(page, 'en')
  const english = await readReportedValues(page)

  await chooseLanguage(page, 'de')
  await applyPseudoLocale(page)
  const pseudo = await readReportedValues(page)

  // The same strings, in the same order, character for character — this time
  // against the real deployment rather than against a fixture, and against a
  // rendering in which *every* translated string on screen differs from both
  // catalogues. A reported value that had accidentally been routed through
  // `t()` could not survive that unchanged.
  expect(english, 'English changed a reported value').toEqual(german)
  expect(pseudo, 'the pseudo-locale changed a reported value').toEqual(german)
  expect(
    german.length,
    'no reported value was found — the comparison would be vacuous',
  ).toBeGreaterThan(100)

  // …and every one of them is still marked untranslatable for the browser.
  const unmarked = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-reported]'))
      .filter((node) => node.closest('[translate="no"]') === null)
      .map((node) => node.tagName.toLowerCase()),
  )
  expect(unmarked, 'a reported value is not marked translate="no"').toEqual([])
})
