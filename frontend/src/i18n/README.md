# Localisation

German is the product's language, English is the second one. This directory
holds the whole localisation layer: the catalogues, the i18next factory, and the
one component that marks text which must never be translated.

The reasoning behind all of it is
[ADR 0014](../../../docs/decisions/0014-localisation-architecture-and-translation-contract.md)
and, for the migration of every text into it,
[ADR 0020](../../../docs/decisions/0020-ui-text-migration-and-the-technical-glossary.md).

## The translation contract

The cockpit shows two kinds of text, and confusing them is the one mistake this
layer exists to prevent.

**Translated — ours:**

- navigation and UI chrome, pane titles, buttons, menus, tooltips
- loading, error and empty states
- status vocabulary from a *closed* UI set (`planned`, `active`, …)
- help texts, accessible names, screen-reader-only text
- date, number, percentage and plural presentation — see *Formatting* below

**Never translated, never reformatted, never normalised — the agent's:**

- agent feedback, agent task descriptions, textual agent messages
- code diffs, source code, file paths
- component ids, run ids, agent ids, change ids
- repository data, NATS topics, technical event names
- every other reported project value

The cockpit shows reported facts. A translated piece of agent feedback is a
falsified audit source, and there is no user benefit that outweighs that.

### How the boundary is enforced, not just described

1. **Typed keys.** `i18next.d.ts` augments i18next with the German catalogue, so
   `t()` only accepts keys that exist. `t(component.componentId)` does not
   compile — passing reported data through the translation layer is a type
   error, not a review finding.
2. **`<ReportedText>`.** Reported values are rendered through it. It marks the
   call site, it is greppable, and it emits `translate="no"` so the browser's
   own page translation leaves the value alone.
3. **Interpolation, where markup cannot go.** An `aria-label` or a `title` has
   no room for an element, so the reported value is interpolated into the
   translated string: `t('projects:item.openLabel', { projectId })`. i18next
   never translates an interpolated value, and `escapeValue: false` keeps it
   byte-identical. React still escapes on render.
4. **A test that renders the workspace twice.**
   `src/routes/pages/WorkspacePage.i18n.test.tsx` collects every `data-reported`
   node in German and in English and compares the two arrays character for
   character — an assigned task that is a whole paragraph, the markdown
   feedback, four unified diffs with their file paths, component, run and agent
   ids. It also asserts that every marked node really carries `translate="no"`,
   because a value that is greppable but that Chrome still rewrites protects
   nothing.

### Two components, two shapes of reported data

`<ReportedText value={…} />` renders one string. Two places need something else
and set the same two attributes by hand, for a reason each:

- **`SafeMarkdown`** — agent feedback is a *tree* by the time it is rendered, so
  the marker goes on its container.
- **`UnifiedDiffView`** — the diff box carries `translate="no"` as a whole, but
  `data-reported` sits on each **line**, because the box also holds the
  screen-reader prefixes (`hinzugefügt:`, `added:`) and those are ours.
- **`ClippedReportedText`** (the run/agent pane) adds CSS clipping and a
  disclosure control around a reported text and emits both attributes itself.
  It is named apart from `<ReportedText>` so the two cannot be confused.

## Key naming

Semantic keys, never German source text. `projects.empty.title`, not
`"Keine Projekte gefunden"` — a key that *is* the German text has to be changed
whenever the German wording is polished, and every other language is orphaned by
the edit.

```
<namespace>/<area>.<element>[.<variant>]
```

- **namespace** — the file: `common`, `errors`, `projects`, `workspace`,
  `canvas`, `agents`, `inspector`.
- **area** — the screen region or concept: `list`, `empty`, `item`, `load`.
- **element** — what it is: `title`, `description`, `label`, `placeholder`.

Conventions:

- `lowerCamelCase` segments, at most three levels deep.
- `common` holds only what genuinely recurs everywhere (`action.retry`,
  `state.loading`). A string used in one place belongs to that place's
  namespace.
- Keys are sorted alphabetically inside a file, so a diff shows the change and
  not a reshuffle.
- Interpolation is named: `{{projectId}}`, never `{{0}}`.
- Where a reported value sits next to a label, split them and let
  `<ReportedText>` render the value, rather than interpolating it into the
  sentence. Use `<Trans>` only when the value truly has to sit inside a clause.

## Formatting

`formatting.ts` is the only place that turns an instant, a count or a percentage
into text. `ReportedTime.tsx` is the only place that renders an instant. The
reasoning is [ADR 0019](../../../docs/decisions/0019-locale-aware-formatting-and-the-utc-rule.md);
the rules a caller needs are these:

**Timestamps are UTC, and they say so.** Every rendering carries the `UTC` label
from the same `Intl` formatter that produced the digits, in both languages. The
cockpit never shows a reported instant in the reader's local zone.

```tsx
<ReportedTime value={risk.createdAt} />                      // 04.08.2026, 09:12:00 UTC
<ReportedTime value={agent.lastEventAt} display="relative" /> // vor 3 Minuten (+ exact UTC)
```

`display="relative"` is for "last reported" only — the places where the question
is *how long ago*. It keeps the exact instant in `title`, in the accessible name
and in `datetime`, so the approximation never stands alone. Both modes keep the
reported string byte-for-byte in `datetime`.

A value that was never reported renders `common:time.notReported`; a value that
does not parse is quoted verbatim through `<ReportedText>`. Nothing is repaired,
nothing becomes `Invalid Date`.

**Counted nouns are plural keys, never string concatenation.**

```tsx
t('common:count.plan', { count: run.counts.plans })   // 0 Pläne · 1 Plan · 2 Pläne
```

`Intl.PluralRules` picks the form and `{{count, number}}` formats the number, so
a language with more than two plural categories needs a catalogue entry and no
code. The hand-written German table this replaced (`src/lib/plural.ts`) is gone.

**Percentages and counters go through the service**, not through `${x} %`:
German writes `90 %` with a non-breaking space, English writes `90%`.

```tsx
const language = useFormattingLanguage()
formatPercent(progress.percent, language)
formatNumber(count, language)
```

## Layout

```
locales/de/<namespace>.json   reference catalogue — a key exists once it exists here
locales/en/<namespace>.json   must describe exactly the same keys
```

All seven namespaces are filled since #42. Which one a text belongs to follows
the surface it appears on, not the file it is written in:

| namespace   | what is in it                                                        |
| ----------- | -------------------------------------------------------------------- |
| `common`    | only what genuinely recurs: retry, loading, close, and the counted nouns and time phrases of #40 |
| `errors`    | the error boundary, the not-found page, the two generic failures      |
| `projects`  | the project list and the project without a run                        |
| `workspace` | the header, the three-pane layout, the live-connection badge          |
| `canvas`    | the architecture pane, the toolbar, detail levels, diagnostics, both legends, the component and relationship vocabularies, and every accessible name of the graph (`a11y.*`, `graph.*`) |
| `agents`    | the run selector, the run state, the agent tree, progress, plans, and the role/status/outcome vocabularies |
| `inspector` | the inspector, its tabs, feedback, diffs, risks, problems, proposals, the history and the event-type vocabulary |

A **closed vocabulary of the read model** — the four work states, the nine
component kinds, the six relationship kinds, the twenty event types, the agent
statuses — is a `Record` keyed by the *contract value* whose entries are
translation keys, and it lives next to the domain it describes
(`state/workStates.ts`, `canvas/relationshipKinds.ts`,
`components/workspace/inspector/historyEntries.ts`, …). What a work state *is*
— its icon, its stroke pattern, its border style — is not a translation
concern; only its words are. `src/i18n/keys.ts` types those maps per namespace,
so a wrong key fails `tsc` where the map is written.

Every helper that formats such a vocabulary takes the `t` of exactly one
namespace (`TFunction<'canvas'>`), and its callers obtain it with
`useTranslation('canvas')`. A component that needs two namespaces calls the hook
twice rather than passing an array, which keeps every key unprefixed and every
function type an exact match.

`canvas/canvasAccessibility.ts` is the one module that is pure and free of React
by design, so it can hold neither. It takes a **`CanvasVoice`** — `{ t, count }`
— from `useCanvasVoice()`, which is the single seam between the graph's
accessible names and the two catalogues they are built from.

## The technical glossary

Some words on screen are in neither catalogue and are the same in German and in
English. Each one is a deliberate decision, and this is the list of them. If a
term is not here and not in a catalogue, it is a bug.

### Contract values, shown exactly as they arrived

These are *reported data*. They travel through `<ReportedText>`, so they carry
`translate="no"` and are byte-identical in both languages.

| value                                   | where                                    |
| --------------------------------------- | ---------------------------------------- |
| `orchestrator`, `subagent`               | agent role in the inspector context card |
| `completed`, `failed`, `cancelled`       | `finishedOutcome` in the context card    |
| `low`, `medium`, `high`                  | risk severity badge                      |
| `markdown`, `plain`                      | feedback `format` badge                  |
| `add`, `modify`, `remove`                | operation of an open proposal            |
| `planned`, `applied`, `retracted`        | state of an open proposal                |
| `component`, `relationship`              | `targetKind` of an open proposal         |

The **display** of these values is translated wherever the cockpit owns a word
for them: the agent tree paints `working` as "arbeitet" / "working", and the
legend paints the work state `planned` as "geplant" / "planned". Mapping a
closed contract value onto a display word is not a change to the value. The
badge above shows the value itself, and the sentence next to it — "Schweregrad:
mittel (vom Agenten eingeschätzt)" — is ours and is translated.

### Identifiers of the contract, quoted as themselves

| term | where |
| ---- | ----- |
| `changeId` | "Ohne `changeId` gemeldet …" in the diff group header. A `<Trans>` slot, listed in `TECHNICAL_TERMS` in `scripts/check-ui-strings.mjs`. |
| `?component=` | the empty state of the inspector, which names the search parameter a selection is shareable through |
| `/api/v1/events` | the empty state of the project list |
| `architecture.snapshot_published`, `agent.started`, `plan.published`, `diff.reported`, `risk.reported`, `problem.reported`, `feedback.published` | event names inside empty states — they are what an agent has to send, so a translated one would be wrong advice |

### Protocol names and abbreviations

`HTTP`, `gRPC`, `NATS`, `DATA`, `ASYNC`, `DEP` — the badge on a relationship
edge and in the legend. The **label** behind each of them is translated
("NATS-Topic" / "NATS topic"); the badge is the token itself.

### Product vocabulary that stays English in German

`Inspector`, `Run`, `Runs`, `Agent`, `Subagent`, `Orchestrator`, `Deep Focus`,
`Unified Diffs`, `Diff`, `Snapshot`, `Root`, `Standard`, `Queue`, `Topic`, `UI`.
They are the words the product and its users already use for these things, and
inventing German ones would make the cockpit harder to talk about, not easier to
read. They still go through the catalogue — `agents:runs.title` is "Runs" in
both files — so a later decision to change one is a catalogue edit and not a
code change.

### Keyboard names that must not be translated

`Enter`, `Escape` and `Tab` appear inside the canvas instructions
(`canvas:graph.instructions`, `graph.nodeInstructions`,
`graph.edgeInstructions`). They are the labels physically printed on the keys,
so they stay as they are in both languages; German renames only `Space`
("Leertaste") and `Tab` ("Tabulatortaste"), which is what a German keyboard's
documentation calls them.

## Where the two halves meet

Number, date and plural *presentation* belong to `src/i18n/formatting.ts` and
`<ReportedTime>` (#40, ADR 0019); the sentences around them belong to the
catalogues (#42, ADR 0020). A text that carries both is written as one
catalogue string with the formatted value **interpolated into it**, never as
two concatenated fragments:

```tsx
// The count is formatted; the sentence around it is translated.
t('canvas:node.collapsed', { components: tCommon('count.component', { count }) })

// Label and instant stay separate, because the instant is an element.
{t('inspector:context.workStepOpen')} <ReportedTime value={startedAt} />
```

`ReportedTime` renders a `<time>` with the reported value in `dateTime`, so the
instant itself is still there byte-for-byte behind whatever the locale shows.
That is why timestamps satisfy the byte-identity test in both languages while
their *rendering* differs.

## Behaviour on missing keys

Two different failures, handled in two different places.

**A key that resolves in no language** — the runtime rule:

| | behaviour |
| --- | --- |
| development | `console.error("[i18n] missing translation key …")`, rendered as `⟦projects:list.title⟧` |
| production | the key itself is rendered |

Never an empty slot. An empty string is the one broken translation nobody
notices, which is also why `returnEmptyString: false` makes an accidentally
emptied translation fall back instead of rendering nothing.

**A key that is missing in one language** — invisible at runtime, because
`fallbackLng: 'de'` answers and the English reader silently reads German. That
is caught statically instead:

```
npm run check:locales
```

It fails on a missing key, an orphaned key, a namespace that exists in only one
language, an empty translation, and a translation that drops an interpolated
value. `src/i18n/catalogues.test.ts` runs it — including against deliberately
broken catalogues *and* against a copy of the real ones with a key removed, so
the check is known to go red on the catalogues it actually guards.

**A text that never reached a catalogue at all** is a third failure, and the
catalogue check is blind to it: German and English agree perfectly while a pane
title sits in the markup. That is checked separately:

```
npm run check:ui-strings
```

It scans `src/` for three things — a German literal outside a comment, a word
left in JSX text in any language, and a sentence handed to a text-bearing prop
(`aria-label`, `title`, `placeholder`, `emptyTitle`, …). Its `ALLOWED` list is
the reasoned exception list: the catalogues, the fixtures and
this README, each with the reason it is there. `src/i18n/uiStrings.test.ts` runs
it against the real sources and against six deliberately broken trees, one per
rule, one for the accessible names of the canvas, and one per exception.

## Start-up

The catalogues are statically imported, so `createI18n()` returns an
**initialised** instance synchronously. `main.tsx` decides the language and
binds `<html lang>` *before* the router is created, so the first paint is
already in the final language: no flash, no visible switch.

Without a stored choice the language is German. `Accept-Language` is
deliberately not consulted — German is the default, and a navigator sniff would
break exactly that for a user who never asked for English. The persisted
language switch itself is #36; `LANGUAGE_STORAGE_KEY` is defined here so the
reader and the future writer cannot drift apart.

## Using it

```tsx
import { useTranslation } from 'react-i18next'
import { ReportedText } from '@/i18n'

function Example({ project }: { project: ProjectSummary }) {
  const { t } = useTranslation('projects')
  return (
    <p>
      {t('item.lastReported')} <ReportedText value={project.lastEventAt} />
    </p>
  )
}
```

In tests, `renderApp('/projects', { language: 'en' })` renders the real
application in English. A component test that renders a translated component
directly needs no provider: `src/test/setup.ts` installs a German instance for
every test.
