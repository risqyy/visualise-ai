import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_LANGUAGE, type Language, isSupportedLanguage } from './languages'

/**
 * The one place the cockpit turns a reported instant, a count or a percentage
 * into text.
 *
 * Before this module there were three of them — `runAgents/reporting.ts` built a
 * timestamp out of `Date.getUTC*`, `inspector/formatting.ts` built a different
 * one out of `Intl`, and the project list showed the raw ISO value — so the same
 * point in time read differently depending on which pane it appeared in. That is
 * a defect on an audit surface: two renderings of one fact invite the reader to
 * believe there are two facts.
 *
 * Everything here follows one rule, in three parts:
 *
 * * **The presentation is localised, the value is not.** ADR 0014 puts date,
 *   number, percentage and plural *presentation* on the translated side of the
 *   contract and every reported value on the other. Formatting a timestamp is
 *   allowed; moving it is not.
 * * **UTC is what is shown, and it says so.** The read API normalises every
 *   timestamp to UTC (ADR 0005), and so does every rendering below —
 *   `timeZone: 'UTC'` plus `timeZoneName: 'short'`, so the zone label comes out
 *   of the same formatter as the digits and cannot drift away from them. A
 *   local-time rendering of an agent report is a different claim than the one
 *   the agent made, and the difference is invisible exactly when it matters.
 * * **Nothing is invented and nothing is hidden.** A value that does not parse
 *   is handed back verbatim rather than turned into "Invalid Date", and a value
 *   that was never reported is named as missing rather than defaulted.
 */

/** Reported instants are UTC (ADR 0005) and are rendered as UTC. */
export const REPORTING_TIME_ZONE = 'UTC'

/**
 * The BCP-47 tag each language formats with.
 *
 * `en` maps to `en-GB` rather than to the `en` default, which ICU resolves to
 * US conventions. The reason is not taste: German renders `04.08.2026` and
 * `en-US` renders `08/04/2026` for the same instant, so a reader who switches
 * language sees the day and the month swap places without being told. Day-first
 * in both languages keeps one instant looking like one instant. `hour12` is off
 * below for the same reason — an `AM`/`PM` clock next to a `UTC` label is one
 * more thing to decode on a surface that exists to be checked quickly.
 */
const LOCALE: Record<Language, string> = {
  de: 'de-DE',
  en: 'en-GB',
}

/**
 * `04.08.2026, 09:12:00 UTC` in German, `04/08/2026, 09:12:00 UTC` in English.
 *
 * Explicit field options rather than `dateStyle`/`timeStyle`, because those two
 * cannot be combined with `timeZoneName` — and the zone label is the one part of
 * this format that is not negotiable.
 */
const ABSOLUTE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: REPORTING_TIME_ZONE,
  timeZoneName: 'short',
}

/** `Intl` constructors are expensive; there are two languages and few formats. */
function perLanguage<T>(build: (locale: string) => T): (language: Language) => T {
  const cache = new Map<Language, T>()
  return (language: Language) => {
    const cached = cache.get(language)
    if (cached !== undefined) return cached
    const built = build(LOCALE[language])
    cache.set(language, built)
    return built
  }
}

const absoluteFormat = perLanguage(
  (locale) => new Intl.DateTimeFormat(locale, ABSOLUTE_OPTIONS),
)
const relativeFormat = perLanguage(
  (locale) => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
)
const numberFormat = perLanguage((locale) => new Intl.NumberFormat(locale))
const percentFormat = perLanguage(
  (locale) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }),
)

// ---------------------------------------------------------------------------
// Reported instants
// ---------------------------------------------------------------------------

/**
 * What a reported timestamp turned out to be.
 *
 * Three cases, kept apart because they are three different statements:
 * `absent` — the report did not contain the value; `invalid` — it did, but the
 * value is not a point in time; `instant` — it is.
 */
export type ReportedInstantKind = 'absent' | 'invalid' | 'instant'

export interface ReportedInstant {
  kind: ReportedInstantKind
  /** The reported value byte-for-byte. Empty only when nothing was reported. */
  raw: string
  /** Localised absolute rendering, always carrying `UTC`. Empty unless `instant`. */
  absolute: string
  /** Milliseconds since the epoch. `NaN` unless `instant`. */
  epochMs: number
}

/**
 * Reads a reported timestamp and formats it, without ever repairing it.
 *
 * An unparsable value comes back as `invalid` carrying the original text, which
 * is what the previous `NaN` guard in `runAgents/reporting.ts` did and what the
 * acceptance criterion asks for: a broken report is evidence about the report,
 * and rewriting it as `Invalid Date` — or worse, as a plausible date — destroys
 * the only thing that could be investigated.
 */
export function readReportedInstant(
  value: string | null | undefined,
  language: Language,
): ReportedInstant {
  if (value === null || value === undefined || value.trim() === '') {
    return { kind: 'absent', raw: '', absolute: '', epochMs: Number.NaN }
  }

  const epochMs = new Date(value).getTime()
  if (Number.isNaN(epochMs)) {
    return { kind: 'invalid', raw: value, absolute: '', epochMs: Number.NaN }
  }

  return {
    kind: 'instant',
    raw: value,
    absolute: absoluteFormat(language).format(epochMs),
    epochMs,
  }
}

/**
 * The absolute UTC rendering of a reported instant, or `null` when there is
 * none to render.
 *
 * The string half of `readReportedInstant`, for the places that need the text
 * rather than the case distinction — an `aria-label`, a `title`, a test.
 */
export function formatReportedInstant(
  value: string | null | undefined,
  language: Language,
): string | null {
  const instant = readReportedInstant(value, language)
  return instant.kind === 'instant' ? instant.absolute : null
}

/** Largest first: the loop below takes the first unit the distance fills. */
const RELATIVE_UNITS: readonly { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: 'year', ms: 31_556_952_000 },
  { unit: 'month', ms: 2_629_746_000 },
  { unit: 'week', ms: 604_800_000 },
  { unit: 'day', ms: 86_400_000 },
  { unit: 'hour', ms: 3_600_000 },
  { unit: 'minute', ms: 60_000 },
  { unit: 'second', ms: 1_000 },
]

/** Below this the phrase is "jetzt" / "now" instead of a count of seconds. */
const JUST_NOW_MS = 5_000

/**
 * How long ago — or how far ahead — a reported instant lies, in words.
 *
 * Two decisions worth naming:
 *
 * * **`Math.trunc`, not `Math.round`.** The phrase never claims more elapsed
 *   time than actually elapsed, and it can never round a unit past its own
 *   boundary ("vor 60 Sekunden"). It is an approximation either way, which is
 *   why `ReportedInstant` keeps the exact UTC value one hover away.
 * * **`now` is a parameter.** The clock is an input, so a test can state one,
 *   and no caller can consult a hidden global.
 *
 * A future instant is not an error here: an agent may report a planned time, and
 * `Intl.RelativeTimeFormat` says "in 3 Minuten" for it without any extra code.
 * This is presentation and never a verdict — nothing in the cockpit turns an old
 * timestamp into `stalled`, `failed` or `inactive` (ADR 0011).
 */
export function formatRelativeInstant(
  epochMs: number,
  language: Language,
  now: number,
): string {
  const format = relativeFormat(language)
  const delta = epochMs - now
  const distance = Math.abs(delta)

  if (!Number.isFinite(delta) || distance < JUST_NOW_MS) return format.format(0, 'second')

  for (const { unit, ms } of RELATIVE_UNITS) {
    if (distance >= ms) return format.format(Math.trunc(delta / ms), unit)
  }
  return format.format(0, 'second')
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** `1234` -> `1.234` in German, `1,234` in English. */
export function formatNumber(value: number, language: Language): string {
  return numberFormat(language).format(value)
}

/**
 * A reported percentage, as a percentage of the reader's language.
 *
 * The contract reports `percent` on a 0–100 scale while `Intl` works on a ratio,
 * hence the division. German puts a non-breaking space before the sign and
 * English does not — which is precisely the kind of detail a hand-written
 * `${percent} %` gets wrong in one of the two languages.
 *
 * `NaN` formats as `NaN`: a percentage the agent did not report as a number is
 * not silently turned into `0 %`.
 */
export function formatPercent(percent: number, language: Language): string {
  return percentFormat(language).format(percent / 100)
}

// ---------------------------------------------------------------------------
// The React-facing half
// ---------------------------------------------------------------------------

/** Narrows whatever i18next currently resolves to onto a supported language. */
export function resolveFormattingLanguage(value: string | null | undefined): Language {
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE
}

/**
 * The language every formatter above should be called with.
 *
 * Reads the active i18next language rather than taking a prop, so a component
 * cannot format in one language while it translates in another, and re-renders
 * with the rest of the tree when #36 switches languages.
 */
export function useFormattingLanguage(): Language {
  const { i18n } = useTranslation()
  return resolveFormattingLanguage(i18n.resolvedLanguage ?? i18n.language)
}

/**
 * How coarse the shared clock is, and therefore how far a relative phrase may
 * lag behind the truth. Half a minute is below the resolution of every phrase
 * the cockpit prints ("vor 1 Minute" is the finest one that lasts).
 */
const CLOCK_RESOLUTION_MS = 30_000

const clockListeners = new Set<() => void>()
let clockTimer: ReturnType<typeof setInterval> | undefined

function subscribeToClock(listener: () => void): () => void {
  clockListeners.add(listener)
  clockTimer ??= setInterval(() => {
    for (const notify of clockListeners) notify()
  }, CLOCK_RESOLUTION_MS)

  return () => {
    clockListeners.delete(listener)
    if (clockListeners.size === 0 && clockTimer !== undefined) {
      clearInterval(clockTimer)
      clockTimer = undefined
    }
  }
}

/**
 * The current time, rounded down to `CLOCK_RESOLUTION_MS`.
 *
 * Rounding is what makes this a legal `getSnapshot`: it returns the *same*
 * number for every render inside one interval, so React has a stable value to
 * compare, while still reading the real clock rather than a cached one that was
 * taken when this module first loaded.
 */
function clockSnapshot(): number {
  return Math.floor(Date.now() / CLOCK_RESOLUTION_MS) * CLOCK_RESOLUTION_MS
}

/**
 * The clock a relative phrase is measured against.
 *
 * A relative rendering is the one thing on this surface that goes wrong by
 * standing still: "vor 3 Minuten" left on screen for an hour is not stale
 * styling, it is a false statement. So the clock is an external store the
 * components subscribe to, and the phrase re-renders with it.
 *
 * One shared interval for the whole application, not one timer per row, and no
 * timer at all while nothing is subscribed. Reading the clock is presentation
 * only: nothing anywhere compares it against a reported timestamp to produce a
 * verdict (ADR 0011).
 */
export function useClock(): number {
  return useSyncExternalStore(subscribeToClock, clockSnapshot, clockSnapshot)
}
