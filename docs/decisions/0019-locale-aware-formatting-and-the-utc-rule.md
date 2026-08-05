# 19. Locale-aware formatting, and why UTC stays on the screen

- **Status:** accepted
- **Date:** 2026-08-05
- **Context issue:** #40 (part of the i18n epic #1); depends on #38
- **Builds on:** [0005 — Read API shape and run scoping](./0005-read-api-shape-and-run-scoping.md),
  [0011 — Run and agent hierarchy](./0011-run-and-agent-hierarchy.md),
  [0014 — Localisation architecture and translation contract](./0014-localisation-architecture-and-translation-contract.md)

## Context

Three areas of the cockpit rendered the same kind of fact three different ways.
`runAgents/reporting.ts` built `04.08.2026, 09:06:31 UTC` out of `Date.getUTC*`.
`inspector/formatting.ts` built `04.08.26, 09:12:00 UTC` out of a hard-wired
`de-DE` `Intl` formatter with a two-digit year. The project list showed
`2026-08-04T09:12:00Z` — the raw reported string, with a comment saying that
making it readable was this issue's job.

Plurals had the same shape of problem one level down: `src/lib/plural.ts` was a
two-form German table, because German does not form plurals by appending an "s".
It knew no English at all, so the second language could not have been rendered
from the same components. ADR 0014 named it as the proof that a home-grown
localisation layer does not stay small, and left it in place deliberately —
rewriting it there would have meant building this issue's service without this
issue's requirements.

Percentages were written `${percent} %` in four places. That string is correct in
German and wrong in English, where the sign is not preceded by a space, and it is
the kind of defect nobody reports because it looks like a font problem.

None of this is cosmetic on this particular surface. The cockpit exists so a
reviewer can check what an agent actually did. Two renderings of one timestamp
invite the reader to believe there are two timestamps.

## Decision

### One service, and no second one

`src/i18n/formatting.ts` owns `Intl.DateTimeFormat`, `Intl.NumberFormat` and
`Intl.RelativeTimeFormat`; plural selection is `Intl.PluralRules` through
i18next's own plural keys. `src/i18n/ReportedTime.tsx` is the only component that
renders an instant. The two older `formatTimestamp` functions are gone rather
than delegating: a helper that still exists is a helper somebody will still call.

Plurals are catalogue entries, not a table in code:

```json
"plan_one":   "{{count, number}} Plan",
"plan_other": "{{count, number}} Pläne"
```

i18next selects the form with `Intl.PluralRules` for the active language, and
`{{count, number}}` formats the number itself — so `1.234 Komponenten` in German
and `1,234 components` in English come out of the same call site. A third
language with more than two CLDR categories needs catalogue entries and no code,
which is exactly what `lib/plural.ts` could not offer. Typed keys carry over: the
base key `common:count.plan` is what `t()` accepts, and a missing `_other` form
is a `check:locales` failure.

Only the nouns that are actually counted on screen moved into the catalogue.
`relationship`, `step` and `run` were in the old table with no call site and were
not carried over.

### UTC stays the displayed zone, and it is labelled

**This is the decision the issue turns on, and it is a product rule rather than a
formatting preference.**

Every timestamp in the system is a reported fact in UTC: the read API normalises
them on the way in (ADR 0005). There were two defensible options — render in UTC
and label it, or render in the reader's local zone and keep the UTC origin
reachable. We kept UTC on the screen.

The reason is what the alternative costs. Rendering `10:12` for a report made at
`09:12 UTC` is not a formatting choice; it is the cockpit stating that the agent
reported at a time it did not. The user's next step is often to correlate what
they see with a log, a CI run or a colleague's screen — and those are in UTC. A
local rendering would be right only for readers in one zone, silently wrong for
everyone else, and wrong in a way that produces no visible symptom until someone
builds a timeline out of it. The previous code wrote `UTC` next to every
timestamp for this reason; that was not incidental, and it is preserved.

Concretely:

- `timeZone: 'UTC'` and `timeZoneName: 'short'` on the shared formatter, so the
  zone label comes out of the same `Intl` call as the digits and cannot drift
  away from them. It is `UTC` in both languages.
- `hour12: false`, so both languages use a 24-hour clock. An `AM`/`PM` reading
  next to a `UTC` label is one more thing to decode on a surface meant to be
  checked quickly.
- `translate="no"` on the rendered element. The rendering is a deliberate,
  locale-aware one; letting the browser's own page translation reformat it
  afterwards would insert a second, unaccountable translator between the agent's
  report and the reader — the same argument `<ReportedText>` makes in ADR 0014.
- The reported string stays in the DOM byte-for-byte as `datetime`, so the exact
  reported fact is present even where the visible text is a relative phrase.

`en` maps to `en-GB` rather than to ICU's `en` default. German renders
`04.08.2026` and `en-US` renders `08/04/2026` for the same instant, so a reader
switching language would see the day and the month change places with nothing to
signal it. Day-first in both languages keeps one instant looking like one
instant. The cost is that an American reader sees a British date order; on an
audit surface that is the cheaper of the two mistakes.

### "Last reported" is relative, and never only relative

Two places ask *how long ago* rather than *when*: the project list and the
`Zuletzt gemeldet` row of an agent. Both render `vor 3 Minuten` / `3 minutes ago`
and keep the exact UTC instant with it — in `title` for the mouse, in
`aria-label` for a screen reader (`vor 3 Minuten, gemeldet 04.08.2026,
09:12:00 UTC`), and in `datetime` for anything machine-readable. Everything else
— a diff, a risk, a plan revision, a run's start — is filed under the moment it
was reported and keeps the absolute rendering.

This is presentation and not inference, and the distinction matters because ADR
0011 forbids the other thing. The clock is read to phrase a distance; it is never
compared against a reported timestamp to produce a verdict. Nothing becomes
`stalled`, `stale`, `inactive` or `overdue` with age, no styling changes with
age, and the existing test that scans the run/agent pane for derived verdicts
still passes unchanged.

The clock is a `useSyncExternalStore` source rounded down to 30 seconds. Rounding
is what makes it a legal snapshot — the same value for every render inside an
interval — while still reading the real clock rather than one cached at module
load. One shared interval for the whole application, and none at all while
nothing is subscribed. A relative phrase is the one rendering on this surface
that goes wrong by standing still: `vor 3 Minuten` left on screen for an hour is
not stale styling, it is a false statement.

### Missing and invalid values are two different statements

| the report | rendering |
| --- | --- |
| no value (`null`, `''`) | `nicht gemeldet` / `not reported` |
| a value that is not an instant | the reported text, verbatim, through `<ReportedText>` |
| an instant | the localised UTC rendering |

The middle row preserves the `NaN` guard the old `reporting.ts` already had, and
the reasoning behind it: a broken report is evidence *about the report*.
Rewriting it as `Invalid Date` hides that something is wrong, and rewriting it as
a plausible date hides what is wrong. It is quoted instead, marked as reported
data, and left for someone to investigate.

## Consequences

- **`src/lib/plural.ts` and its test are deleted.** Their five cases live on in
  `src/i18n/formatting.test.ts`, which now asserts zero/one/many in *both*
  languages including `Feedback`, whose German plural equals its singular.
- **Two visible formats changed.** The inspector's two-digit year became four
  (`04.08.26` → `04.08.2026`, adopting the run/agent pane's format), and the
  project list stopped showing a raw ISO string. Both were the defect the issue
  names. The German rendering of the run/agent pane is byte-identical to what it
  produced before, which is why most of the existing suite needed no change.
- **Two existing assertions were rewritten, not weakened.** The agent row's last
  reported time is now relative, so the two tests that pinned its text now pin
  its `title`, `datetime` and accessible name — a stricter statement than the one
  they replaced. `ProjectsPage.i18n.test.tsx` gained a case proving the reported
  instant survives byte-for-byte in `datetime` in both languages, which is what
  the removed `data-reported` assertion used to cover.
- **A rendered instant is now its own element, and the density rule of #39
  applies to it.** The run/agent pane may only use 11 px type for bounded,
  monospaced metadata, and the acceptance suite walks every element that owns
  text to check it. Where a timestamp used to be a text node inside a
  `pane-meta` span it is now a `<time>` of its own, so it carries `pane-meta`
  itself at those four call sites. The rendering is unchanged; what changed is
  which element the class has to sit on.
- **`<time>` elements are now the anchor for timestamp assertions.** A test that
  wants the exact instant reads `title` or the element text; both are one string
  per element and both are asserted to agree across areas.
- **Language-dependent whitespace is real.** German percentages carry U+00A0.
  Tests write it as the escape `\u00a0` rather than as a character that
  looks like a space in an editor and is not one in the DOM.
- **`common` grew a `count` and a `time` area.** Counted nouns cross namespaces —
  the canvas counts components, the inspector counts risks, the agent pane counts
  plans — so they belong to the shared namespace rather than being duplicated
  three times.
- **#42 inherits fewer strings, not more.** Every hard-wired plural and every
  `${x} %` is gone from the components it will migrate; what is left there is
  ordinary prose.
- **Nothing outside formatting was touched.** Hard-coded German text at the call
  sites was deliberately left in place; it is #42's, and this diff would have
  collided with it.
