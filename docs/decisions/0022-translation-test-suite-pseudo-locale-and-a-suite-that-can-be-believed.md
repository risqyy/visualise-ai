# 22. The translation test suite: the flake before the coverage, a third language nobody can choose, and screenshots that are evidence rather than a gate

- **Status:** accepted
- **Date:** 2026-08-05
- **Context issue:** #37 (last of the i18n epic #1)
- **Builds on:** [0013 — Mandatory end-to-end acceptance](./0013-mandatory-end-to-end-acceptance.md),
  [0014 — Localisation architecture and the translation contract](./0014-localisation-architecture-and-translation-contract.md),
  [0015 — Desktop viewport and absolute pane minimums](./0015-desktop-viewport-and-absolute-pane-minimums.md),
  [0018 — Accessible architecture nodes](./0018-accessible-architecture-nodes.md),
  [0019 — Locale-aware formatting and the UTC rule](./0019-locale-aware-formatting-and-the-utc-rule.md),
  [0020 — UI text migration and the technical glossary](./0020-ui-text-migration-and-the-technical-glossary.md),
  [0021 — Persistent language switch and state preservation](./0021-persistent-language-switch-and-state-preservation.md)

## Context

Four issues built the localisation layer, and each of them brought its own
tests: the plural, date and percentage service with both languages and its edge
cases (#40), the byte-identity proof for reported data across German and English
(#42), the language switch that must not lose work context (#36). The suite
stood at 429 tests, `npm run check:locales` and `npm run check:ui-strings`
existed and were known to fail on broken catalogues.

This issue is the one that asks whether all of that is *true* — and the first
thing it found was that the suite could not be believed. Three consecutive full
runs on a 22-core developer machine:

```
run 1:  9 failed | 420 passed
run 2: 46 failed | 383 passed
run 3:  1 failed | 428 passed
```

The same commit, no code changes in between. CI was green throughout, because a
four-core runner with nothing else on it does not reproduce it. That is the
worst shape a test suite can have: it reports a reliability it does not have,
and it reports it *to CI*, which is the audience that decides whether something
ships.

Everything else in this issue — plural coverage, accessible names, a
pseudo-locale, layout at three widths — is worth exactly nothing on top of a
suite that fails one run in three for reasons unrelated to the product. The
flake is therefore the first decision here, not an aside.

## Decision

### The flake, part one: the tests were never given the time they ask for

The failures all read `Test timed out in 5000ms`, and they concentrated in the
four files that render the **real** application inside jsdom — router, query
client, React Flow and a full ELK layout: `WorkspacePage.i18n.test.tsx`,
`ArchitectureZoom.test.tsx`, `ArchitectureCanvas.test.tsx`,
`ChangeOverlays.test.tsx`.

The obvious reading — "raise the timeout" — is the wrong instinct, and the
question it skips is the only one that matters: *is the work actually being
done, or is something waiting for an event that never arrives?* One measurement
answers it. The whole suite, run once with `--testTimeout=60000` and nothing
else changed:

```
43 files, 429 tests, all passed.
Slowest single test: 1451 ms.
```

Nothing hangs. Every one of those tests finishes, and the slowest of them costs
about a second and a half of work. A 5 s budget for a 1.5 s job is a factor of
three, and a factor of three does not survive a machine that has something else
to do.

There is a second, sharper fact. The canvas files already say what they think
they need — `CANVAS_TIMEOUT = 15_000` on their `waitFor` calls, written by
whoever knew an ELK layout is not instant. **That number was never reachable.** A
`waitFor` cannot outlive the test that awaits it, so Vitest's 5 s default
silently overruled every one of them. The configuration and the tests disagreed
about what "long enough" means, and the configuration won without saying so.

`testTimeout: 20_000` and `hookTimeout: 20_000` are therefore not a concession.
They are the file-level intention, plus room for the assertion around it, moved
to the place that actually decides. A test that really hangs still fails — 15 s
later, with the same message.

### The flake, part two: twenty-one workers do not run twenty-one tests

Vitest defaults to one worker per core. Each worker is a fork with its own
jsdom, its own React and its own ELK, and on a 22-core machine 21 of them do not
share the machine — they contend for it. Measured over the whole suite, on the
machine that produced the three runs above:

| max forks | wall  | test CPU | jsdom setup |
| --------- | ----- | -------- | ----------- |
| 21 (default) | 24 s | 135 s | 130 s |
| 12        | 30 s  | 143 s   |  90 s |
| 6         | 34 s  |  80 s   |  55 s |
| 4         | 44 s  |  64 s   |  51 s |

Ten seconds of wall time buy back 40 % of the CPU time each individual test
needs, and it is the *individual* test that has a deadline. Under load the
uncapped run needed 945 s of test CPU and failed 46 tests; the same suite capped
needs 80 s and fails none.

`maxForks: max(2, min(6, availableParallelism() - 1))` is an upper bound rather
than a floor: a four-core CI runner keeps the three workers it would have chosen
anyway, so nothing about CI changes. The cap exists for the machines that are
big enough to hurt themselves.

### The flake, part three: one assertion was genuinely racing

Raising the budget would have hidden a third defect, which is the reason the
measurement above had to come first. One failure was not a timeout:

```
ChangeOverlays.test.tsx > draws a new proposal without moving zoom, pan or selection
AssertionError: expected '0' to be '1'
  expect(canvas.getAttribute('data-fit-view-count')).toBe('1')
```

`data-layouting: false` says that ELK is done. It does **not** say that the
automatic camera placement has run: `fitView` happens in an effect *after* the
layout, so `data-fit-view-count`, the viewport transform and the stored camera
are all one commit away when the flag flips. Ten assertions across four files
read one of the three synchronously at exactly that moment. On a quiet machine
React has committed by then; on a busy one it has not.

The fix is in the four `waitForCanvas` helpers, which now wait for the initial
fit as well as for the layout. It is a fix to the *test's* idea of when the
canvas is ready, not a widened tolerance: the assertions that follow are
unchanged, and they still say `'1'`.

`renderWorkspaceScene` waits for the same thing, and for one more reason: while
ELK runs, the architecture pane carries a `canvas-layouting` element that is
gone a moment later. A test that compares two renderings element by element —
German against English, German against the pseudo-locale — would otherwise
report *the progress of a layout* as a difference between two languages.

### What was already there, and was not written again

Most of what issue #37 lists had been built by the issues it depends on. Writing
it a second time would have produced a suite that is longer and no stronger, so
this issue only added what was missing:

| the issue asks for | state on arrival |
| --- | --- |
| unit tests for plurals, dates, percentages | `i18n/formatting.test.ts` — both languages, zero/one/many, UTC labelling, invalid and unreported instants, the German non-breaking space (#40) |
| unit tests for fallbacks and missing keys | `i18n/i18n.test.ts` — `fallbackLng`, the development marker, the production key, an emptied translation, a dropped stored language (#38) |
| component tests for the central German and English surfaces | `ProjectsPage.i18n.test.tsx`, `WorkspacePage.i18n.test.tsx`, `LanguageSwitch.i18n.test.tsx` (#42, #36) |
| translated `aria-label`s and screen-reader text | asserted per surface: the graph in `ArchitectureAccessibility.test.tsx` (#35), the chrome in `WorkspacePage.i18n.test.tsx` (#42) |
| code diffs and agent messages unchanged | the `data-reported` comparison across both languages, character for character (#42) |
| key parity of the catalogues | `npm run check:locales`, verified against five deliberately broken catalogues (#38) |

Four gaps were left, and they are what this issue adds.

**Counted nouns are now read out of the catalogue.** The existing plural tests
name the nouns they check, which is what makes them readable and what makes them
incomplete: the noun added next week is covered by none of them. A second block
derives the list from `common.count` and asserts zero, one, many, eleven and
1 234 in both languages for every one of them — so `count.proposal` is checked
the day it is added.

**The accessible names are swept rather than enumerated.** `aria-label`,
`title`, `placeholder` and `sr-only` text are the four places a translation can
be forgotten without anybody seeing it: a visible pane title that stayed German
shows up in the first English screenshot, an `aria-label` that stayed German
shows up when a blind user files a bug. `i18n/accessibleNames.test.tsx` walks
both surfaces in both languages and asserts three properties that hold for names
nobody has written yet — nothing resolves to a key or to the `⟦…⟧` marker,
every operable control has a name, and the two languages really differ.

**Two `Intl` units and two percentage edge cases were unchecked.** Weeks and
months exist in `Intl.RelativeTimeFormat` and were never selected by a test;
a percentage above 100 or below 0 is an agent's claim about its own progress and
had no test saying it is passed through rather than clamped.

**And the layout was only ever measured in the two languages that exist.**

### A third language that nobody can choose

Issue #37 asks for "a pseudo-locale or artificially 30–40 % lengthened texts".
German is already a long language, so a layout that survives German survives
most translations — *most*. The question no real catalogue can ask today is what
happens when a translation is longer than anything either catalogue currently
contains. A pane title that fits at 100 % and is cut at 135 % is a defect that
exists **now**, and it would otherwise be found by the first translator rather
than by the suite.

Three things it deliberately is not:

- **Not a supported language.** `SUPPORTED_LANGUAGES` stays `['de', 'en']`, so
  it cannot appear in the switch, in `<html lang>` or in a stored preference.
  The product speaks two languages and the switch shows two segments.
- **Not a directory under `locales/`.** `npm run check:locales` compares every
  language against German; a generated third catalogue would be a second thing
  to keep in parity by hand and a new way to go red for a reason nobody cares
  about.
- **Not in the bundle.** A shipped language that the switch deliberately hides
  is a feature nobody asked for, sitting in production forever so that a test
  can look at it.

It is a **pure function of the German catalogue**, so it cannot drift: a key
added tomorrow is lengthened the day it is added. The German original stays at
the front of every string — a test that fails on a pseudo rendering has to be
debuggable from the screenshot — and the padding is appended, which is what
keeps `{{interpolations}}` and the `<agent/>`, `<run/>`, `<field/>` slots of
`<Trans>` intact. Both properties are asserted rather than assumed.

**The clone in `createPseudoI18n` is not defensive style.** `i18next.init({
resources })` keeps a *reference* to the object it is given, and
`addResourceBundle` writes through it — verified, not assumed. Installing the
pseudo catalogue without cloning the instance's store first replaces the German
catalogue of `src/i18n/resources.ts` for the rest of the worker process, and the
failure then surfaces in an unrelated test three files later. A test asserts
that a plain `createI18n()` built afterwards still answers in real German, so
the guard is known to hold.

**It is implemented twice, on purpose.** The frontend suite derives a longer
catalogue and hands it to i18next; that answers whether anything gets *lost* —
a pane that stops rendering its legend, an `aria-label` that falls back to
German, a control that disappears. It cannot answer whether anything gets *cut
off*, because jsdom has no layout engine. The acceptance run therefore lengthens
the text of the running page in the browser instead, with the same 35 % and the
same filler, and measures. They are two implementations of one rule, and each
asserts the rule for itself.

Both leave `[data-reported]` and everything inside `translate="no"` alone. That
is what makes the third rendering a third *proof* rather than a repetition: in
it, every translated string on screen differs from both catalogues, so a
reported value that had accidentally been routed through `t()` could not come
out unchanged.

### Screenshots are evidence, not a gate

The issue asks for desktop screenshots at 1280, 1440 and 1920. They are
**attached to the Playwright report**, and nothing is compared against a
committed image.

`toHaveScreenshot()` compares rendered pixels, and rendered pixels depend on the
font stack, on hinting and on subpixel positioning. A baseline recorded in a
Linux container disagrees with the same build on a developer's Windows machine
over text that is perfectly correct, and the disagreement is reported as a
failure of the release gate. ADR 0013 already decided what happens then: a gate
that reports noise gets ignored, and an ignored gate is worse than none.

What the issue actually asks for is not "the picture is identical" but "no pane
titles, buttons, legends or status values are cut off". That is measurable
without an image, by the browser, on the elements it is asked about:
`scrollWidth` against `clientWidth`, with an `overflow` that hides the rest. An
element with `overflow-x: auto` is wider than its box and perfectly readable —
the diff view is designed that way — and is not a defect; an element with
`overflow: hidden` or `text-overflow: ellipsis` is wider than its box and the
rest is gone. Only the second is reported, and the answer is a number that is
the same on every machine.

The screenshots are what a human looks at afterwards, which is exactly what an
artefact is for.

### The one thing the check found, and why it is reported rather than fixed

The measurement immediately found a clipped text, and it is worth writing down
because the first reading of it was wrong.

`[data-testid="pane-architecture"] h2`, needed / available in pixels:

| rendering | 1920      | 1440         | 1280        |
| --------- | --------- | ------------ | ----------- |
| German    | 88 / 88   | 88 / 88      | 88 / **78** |
| English   | 96 / 96   | 96 / 96      | 96 / **92** |
| pseudo    | 122 / 122 | 122 / **87** | 122 / **0** |

The architecture pane's header carries the four-state change counter and the two
count badges — about 550 px, `shrink-0` — and the pane is 690 px wide at 1280.
The heading is the only thing in that row that can give way, and it does.

**German is already clipped at 1280.** This is therefore not a defect that
translation introduced; it is a layout defect of the architecture header at
narrow widths — the subject of ADR 0015 and issue #41 — which English makes
marginally worse (4 px) and a 35 % longer translation makes severe (the title
disappears entirely at 1280).

It is reported and not fixed. The remedy is a decision about what that header
shows when it runs out of room — condense the counter, drop the badges, wrap the
title, reserve a minimum for the heading — and each of those is a design choice
about the pane, made by whoever owns it. Fixing it inside a test issue would
mean choosing one of them in a commit whose diff nobody reviews for that.

The exception in the check is bounded in two directions so it cannot rot into a
blanket permission: it names one probe, and it applies only **below 1920**,
where the assertion stays strict for all three renderings. Every run that hits
it writes the measurement into the Playwright report as an annotation, so a
known defect that nobody has fixed keeps saying so.

### Three widths, and why those three

1920 × 1080 remains **the** acceptance surface. Checks 1–8 are untouched: same
resolution, same assertions, same German. Check 9 runs after them and adds 1440
and 1280.

The two extra widths are not a device matrix; ADR 0015 already named them as
ordinary desktop situations — a window that is not maximised, and 1920 at 150 %
browser zoom, which is an accessibility setting rather than a different device.
1280 is the interesting one: the three pane minimums add up to 1100 px, so it is
the width at which the layout has the least room and therefore the width at
which a longer word first hurts.

Every selector in check 9 is language-independent. That is not tidiness — a
probe list written against `aria-label="Agents filtern"` finds nothing in the
English run and then reports "no clipped text" about a screen it never looked
at. Every probe list in check 9 therefore asserts that it found what it was
looking for before it asserts anything about it.

### The two catalogue guards become named CI steps

`npm run check:locales` and `npm run check:ui-strings` were already executed by
the Vitest suite, which is what proves they *work*: `catalogues.test.ts` and
`uiStrings.test.ts` run them against deliberately broken trees as well, and a
guard that has only ever been green proves nothing.

What a named step adds is the failure being readable. "check locale catalogues"
in red says a key is missing in one language; "frontend (react)" in red says
that something among 455 tests went wrong. The issue asks for catalogue parity
to be validated in CI, and a validation nobody can read the result of is only
half a validation. They run before lint and typecheck, because a catalogue
mismatch is cheaper to find than a type error and both are cheaper than the
suite.

## Consequences

- **The frontend suite is slower and reliable, in that order.** ~34 s instead of
  ~24 s on a 22-core machine, and five consecutive full runs green on the
  machine that previously failed one in three. On CI nothing changes: the fork
  cap is above what a four-core runner would have used anyway.
- **`testTimeout: 20_000` is now the budget for everything.** A genuinely hung
  test takes 20 s to report instead of 5. That is the price of the canvas files
  being able to wait as long as they always said they needed to.
- **`waitForCanvas` means more than it did.** Four canvas suites and the shared
  workspace scene now wait for the initial camera placement, not only for ELK. A
  test that wants to observe the canvas *before* the first fit has to say so
  explicitly — no test does today.
- **The workspace fixture is shared.** `src/test/workspaceScene.ts` is the one
  place the three-pane scene is wired up; `WorkspacePage.i18n.test.tsx`,
  `WorkspacePage.pseudo.test.tsx` and `accessibleNames.test.tsx` all look at the
  same screen, which is the point — three suites drifting onto three slightly
  different fixtures is how they stop testing the same thing.
- **The pseudo-locale is a maintenance obligation of two files, not of a
  catalogue.** `frontend/src/test/pseudoLocale.ts` and `e2e/src/pseudoLocale.ts`
  have to agree on the expansion and on the filler. They are duplicated across a
  package boundary on purpose — the e2e project has its own `package.json` and
  `tsconfig.json` and does not import from the frontend — and each asserts the
  30–40 % band for itself.
- **The acceptance run grew from 21 checks to 25**, and by about six seconds:
  the four new checks measured 1.3 s, 1.3 s, 1.8 s and 1.1 s against a two-minute
  run whose cost is dominated by the Compose build and the two 30-second
  simulator sequences. It still runs one worker, no retries, no fixed sleeps.
- **Screenshots accumulate in the report artefact.** Nine images per run
  (three widths × German, English, pseudo), retained for 14 days by the existing
  upload step. Nothing fails because of them, and nothing has to be regenerated
  when a colour changes.
- **`check:ui-strings` does not see the pseudo-locale.** It lives under
  `src/test/`, which the script already treats as test code, and its only
  German-looking literal is the filler.
