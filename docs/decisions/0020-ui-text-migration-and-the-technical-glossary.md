# 20. Migrating every UI text, and proving that nothing was left behind

- **Status:** accepted
- **Date:** 2026-08-05
- **Context issue:** #42 (part of the i18n epic #1); unblocks #36, #37
- **Builds on:** [0014 — Localisation architecture and translation contract](./0014-localisation-architecture-and-translation-contract.md),
  [0019 — Locale-aware formatting and the UTC rule](./0019-locale-aware-formatting-and-the-utc-rule.md),
  [0018 — Accessible architecture nodes](./0018-accessible-architecture-nodes.md),
  [0011 — Run and agent hierarchy](./0011-run-and-agent-hierarchy.md),
  [0012 — Component inspector and Markdown safety](./0012-component-inspector-and-markdown-safety.md)

## Context

ADR 0014 built the foundation and migrated one area — the project list — on
purpose, so that #42 would fill files instead of inventing a structure. What was
left is the rest of the cockpit: the workspace header and its three panes, the
canvas toolbar and its two legends, the run selector, the agent tree, the
inspector with feedback, diffs, risks, problems, proposals and history, plus
every tooltip, placeholder, dialog, `aria-label` and screen-reader line in
between, plus the accessible names of the architecture graph that #35 collected
in `CANVAS_A11Y_TEXT` and left for this issue. Around 300 texts in some sixty
files.

The interesting part of that is not the volume. It is that most of what is on
screen is **not ours**: an assigned task that is a whole paragraph, markdown
feedback, a unified diff with its file path, component ids, NATS topics,
technical event names. ADR 0014 drew the line; this issue is where the line is
actually walked, several hundred times, and where getting it wrong once would
falsify the audit source the cockpit exists to show.

Two acceptance criteria of #42 are therefore about *proof* rather than about
translation: "an automated check finds missing or orphaned keys", and "outside
the catalogues there are no visible hard-coded German or English UI texts left".
The first one already existed (`npm run check:locales`, #38). The second one had
nothing behind it at all.

## Decision

### German stays byte-identical; English is the new text

Every migrated German string was moved into the catalogue **unchanged**,
including its typography (`—`, `„…“`, `…`). That is what made a change of this
size reviewable: the 393 tests of `develop` — and the mandatory end-to-end
acceptance run of ADR 0013, which drives the cockpit in German — kept passing
without a single assertion being rewritten to fit. A test that had to be
adjusted would have hidden a behavioural change inside a translation diff.

The exception is where a *sibling* issue had already written a German assertion
in anticipation of this one: #35's bilingual canvas tests asserted
"Container mit 2 components", the half-migrated state it documented at the time.
Those expectations became "container holding 2 components" — the assertion did
not weaken, the thing it describes was finished.

Where a German literal did have to change shape, it was because the *sentence*
could not be split for English. `{label} {action}` produced "Inspector
ausklappen" by concatenation; English needs "Expand the inspector", so the pane
name is now interpolated into one whole sentence per language
(`workspace:pane.expand`). The German output is the same string it always was.

### A closed vocabulary keeps its home; only its words move

`WORK_STATES`, `COMPONENT_KIND_STYLES`, `RELATIONSHIP_KIND_STYLES`,
`AGENT_STATUS_LABEL_KEY`, `EVENT_TYPE_LABEL_KEY` and their siblings stay where
they are — next to the icon, the stroke pattern and the border style they belong
to. What changed is their values: a German string became a **translation key**,
typed per namespace through `src/i18n/keys.ts` (`CanvasKey`, `AgentsKey`,
`InspectorKey`).

The alternative was to move these tables into the catalogues. It was rejected
because it splits one concept across two files: `planned` is a colour *and* a
dash pattern *and* a glyph *and* a word, and only the last of those is a
translation concern. Typing the key instead keeps the table exhaustive against
the contract (`Record<EventType, InspectorKey>` still fails `tsc` when the
contract grows a type) and adds a second failure — a key that is not in the
catalogue — at the place the table is written.

### A helper takes the `t` of exactly one namespace

`overlayLabel(overlay, t)`, `overlayTitle(overlay, t)`,
`componentKindLabel(kind, t)`, `relationshipTitle(relationship, t)` and
`diagnosticLines(diagnostics, t)` are not components and cannot call
`useTranslation`. They take `TFunction<'canvas'>` — bound to one namespace, not
to a union of all seven — and their callers obtain exactly that with
`useTranslation('canvas')`. A component that needs two namespaces calls the hook
twice.

This is a small rule with a large payoff: the function type is an exact match,
so nothing has to be cast, and every key stays unprefixed and short. The
alternative — one `t` over all namespaces and `ns:key` everywhere — types
poorly across function boundaries and would have produced casts at precisely the
places the contract is enforced.

### `describeError` returns the distinction, not the sentence

ADR 0014 named this as #42's piece of unfinished business: `describeError()` is
in `src/api`, cannot call `useTranslation`, and most of what it returns is the
backend's own words. Threading a `t` into it would have put a translation
concern into the API layer.

It now returns a small discriminated union — `reported`, `backendUnreachable`,
`unknown` — and a new one-element component `<ErrorDescription>` renders it. The
backend's problem title and its stable code go through `<ReportedText>`, so they
are marked `translate="no"` like every other reported value; only the two
generic fallbacks come from the catalogue. `src/api` is left without a word of
German in it.

### Where a text meets a formatted value, the catalogue owns the sentence

ADR 0019 (#40) landed in parallel and moved every instant, count and percentage
into `src/i18n/formatting.ts` and `<ReportedTime>`. The two issues meet in about
twenty places, and the rule that settles all of them is one sentence: **the
formatter owns the value, the catalogue owns the words around it.**

In practice that is two shapes and no third:

```tsx
// The formatted value is interpolated into one translated sentence.
t('canvas:node.collapsed', { components: tCommon('count.component', { count }) })

// …unless the value is an element, in which case label and value stay apart.
{t('inspector:context.workStepOpen')} <ReportedTime value={startedAt} />
```

Two catalogue entries changed shape because of the second case:
`context.workStepCompleted` and `context.workStepOpen` lost their `{{time}}`,
because `<ReportedTime>` is a `<time>` element carrying `dateTime`, `title` and
an accessible name — none of which survive being flattened into a string. That
is the same rule the README already gave for reported values, arriving from the
other direction.

`progress.meterLabel` lost its literal ` %` for the opposite reason:
`formatPercent` writes `90 %` in German and `90%` in English, so the sign
belongs to the formatter and not to the sentence.

### The accessible names of the canvas come along

ADR 0018 (#35) gave every node and edge an accessible name and collected the
strings in one `CANVAS_A11Y_TEXT` object, hard-coded in German, explicitly for
this issue to pull. They are now catalogue keys like everything else.

The interesting part is *how* they are reached. `canvasAccessibility.ts` is pure
and free of React by design — that is what lets its uniqueness and disclosure
rules be tested without rendering a canvas — so it can hold neither a `t` nor a
plural table. #35 had already solved half of it by injecting a `CountText`; this
issue widens that seam by one field rather than adding a second one:

```ts
export interface CanvasVoice {
  t: TFunction<'canvas'>   // the sentences  (#42)
  count: CountText         // the numbers    (#40)
}
```

`useCanvasVoice()` builds it, memoised per language, so the accessible names
follow a language switch without invalidating the label memos on every render.
The alternative — two positional parameters — was rejected because every one of
the eight exported functions would have grown one, and the test file with it.

React Flow's own English defaults are replaced by `canvasAriaLabelConfig(t)`,
a function now rather than a constant. That is not only a translation: React
Flow offers "press delete to remove it" and "use the arrow keys to move the node
around", and neither is true of a read-only canvas.

### shadcn's "Close" becomes a required prop

`DialogContent` shipped `<span className="sr-only">Close</span>` hard-coded —
the one English string the cockpit rendered inside a German page.
`closeLabel` is now a **required** prop rather than a defaulted one: a default
would be a literal in that file again, and the point is that a design-system
component has no words of its own. There is one dialog in v0, so the cost is one
call site.

### The reported-data marker follows the shape of the data

`<ReportedText>` renders one string. Two surfaces are not one string, and each
sets `translate="no"` and `data-reported` itself:

- **`SafeMarkdown`** marks its container. Agent feedback is a rendered tree by
  the time it reaches the DOM. This is the single most important instance of the
  marker in the product: Chrome will otherwise translate agent feedback on a
  page that declares `lang="de"`, and the reader would never learn that the
  audit trail they are judging is machine output.
- **`UnifiedDiffView`** marks the box `translate="no"` but puts `data-reported`
  on each **line**, not on the box. The box also contains the screen-reader
  prefixes (`hinzugefügt:` / `added:`), which are ours and *do* change with the
  language — marking the box would have made the byte-identity test below fail
  for a correct reason and, worse, would have taught the next reader that
  reported and translated text may share a marker.

The run/agent pane's clipping component was renamed `ClippedReportedText`, so
the two `ReportedText`s in the codebase can no longer be confused.

### The second check: `npm run check:ui-strings`

The catalogue check proves the two languages agree. It cannot prove that a text
ever reached a catalogue: a pane title left in the markup keeps both files in
perfect agreement. So a second script scans `src/` for what is left, with three
rules of deliberately different strength:

| rule | finds |
| --- | --- |
| `german-literal` | an umlaut, an "ß" or a German function word in a string or JSX text |
| `jsx-text` | **any** word left in a JSX text node, in any language |
| `ui-attribute` | a sentence literal on `aria-label`, `title`, `placeholder`, `emptyTitle`, … |

`jsx-text` is the one that matters and the one that is easy to get wrong. A
naive `>…<` scan reads `new Map<A, B>()` as a text node, so the scanner skips
`.ts` files entirely, rejects any segment containing an operator or a bracket,
and rejects a segment that begins with a statement keyword. `german-literal`
alone would have been comfortable and insufficient: "Architektur" carries
neither an umlaut nor a function word, and an English literal is invisible to it
by construction.

Comments are blanked before scanning, with the line numbers preserved. This
repository documents its decisions at length, much of it quoting German UI text;
a checker that cannot tell documentation from a label is a checker that gets
switched off.

The exception list is per file and carries a reason per entry: the catalogues,
the test fixtures (which quote reported German project data on purpose),
`src/lib/plural.ts` (#40's), and this README. A separate `TECHNICAL_TERMS` map
is the executable half of the glossary — currently one entry, `changeId`,
because a contract field name is the same token in both languages.

### Both checks are known to go red

`catalogues.test.ts` gained two cases that damage a **copy of the real
catalogues** rather than a synthetic one: removing `agents:status.working`, and
dropping `{{runId}}` from an English sentence that interpolates it. It also
asserts the reference catalogue is no longer nearly empty, which is what would
be true if #42 had quietly translated only part of the surface.

`uiStrings.test.ts` runs the new scanner against the real sources and against
six deliberately broken trees — one per rule, one for German prose in a comment,
one for the exception list, one for the `zustand` import that is also a German
word. Same arrangement, and the same argument, as ADR 0009: a check that has
only ever been green proves nothing.

### The proof that reported data did not move

`WorkspacePage.i18n.test.tsx` renders the whole workspace twice, collects every
`data-reported` node in German and in English, and asserts the two arrays are
equal — same strings, same order, character for character. It covers whatever is
on screen rather than a list somebody has to keep up to date, and the fixtures
are the ones the simulator actually reports: a paragraph-long assigned task,
a task chained from three issue titles, markdown feedback with a fenced Go
block, four unified diffs with their file paths, component, run and agent ids.

A second assertion pins that every `data-reported` node also carries
`translate="no"`. A marker that is greppable but that the browser still rewrites
protects nothing, and the two attributes drifting apart is the realistic way
this could rot.

## Consequences

- **The four empty namespaces are full**: 366 keys per language across seven
  namespaces, up from 8 before this issue and from 36 after #40 added its
  counted nouns and time phrases.
- **`npm run check:ui-strings` is the standing guard** against the next
  hard-coded label, and it is a `package.json` script so #37 can lift it into
  CI as its own step alongside `check:locales`.
- **English is grammatically complete.** `canvas:pane.components` still
  interpolates `{{count}}` for the two pane badges, but every counted noun the
  cockpit paints now goes through `common:count.*` and `Intl.PluralRules`, so a
  single component reads "1 component" and not "1 components". That is #40's
  work; what #42 added is that the *sentence* around each count comes from the
  catalogue too, which is what let the two land in one place instead of
  competing for the same line.
- **The inspector shows some contract values verbatim** — an agent's `role`, its
  `finishedOutcome`, a risk `severity`, a feedback `format`, a proposal's
  `operation` and `state`. That was already true before this issue; it is now a
  documented decision with a glossary entry and a `<ReportedText>` around it
  rather than an accident.
- **`inspector/formatting.ts` has no words left at all.** #40 removed its
  timestamp formatter; #42 removed its status vocabulary and made
  `orNotReported` take the caller's already-translated sentence. What remains is
  `formatDiffStat`, which produces `+12 / −3` and no language.
- **#36 gets a switchable application for free.** Every text now comes from the
  instance, so a `languageChanged` re-renders the whole cockpit; what #36 has to
  solve is state preservation, not coverage.
- **#37 inherits two red-provable checks and a two-language render path.** The
  pseudo-locale and the desktop screenshots it adds can reuse
  `renderApp(path, { language })` and the `data-reported` query unchanged.
