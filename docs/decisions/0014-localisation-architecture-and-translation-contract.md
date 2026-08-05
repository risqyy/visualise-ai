# 14. Localisation architecture, and the line between our words and the agent's

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #38 (part of the i18n epic #1); unblocks #40, #42, #36, #37
- **Builds on:** [0003 — Frontend state split and live updates](./0003-frontend-state-split-and-live-updates.md),
  [0009 — Generated frontend contract types](./0009-generated-frontend-contract-types.md),
  [0012 — Component inspector and Markdown safety](./0012-component-inspector-and-markdown-safety.md)

## Context

The cockpit is written in German. Not in catalogues — in the components: pane
titles, button labels, empty states and `aria-label`s are string literals spread
over some sixty files, and `src/lib/plural.ts` carries a hand-written German
plural table because German does not form plurals by appending an "s".

Adding English is therefore not a translation task first. It is a question of
*what may be translated at all*, and that question has an unusually sharp answer
here, because most of the text on screen is not ours.

The cockpit observes agents. What it shows is what an agent reported: task
descriptions, feedback, risks, problems, unified diffs, file paths, component
and run ids, NATS topics, event type names. ADR 0009 already had to correct a
frontend that displayed fields the API never sent; ADR 0012 already had to
decide that reported Markdown is rendered but never rewritten. The same
principle now meets a translation layer, and it gets sharper: a diff that has
been translated is not a diff, and translated agent feedback is a falsified
audit source. The user reads this surface to decide whether an agent did the
right thing. Editing the evidence to make it read better in English destroys the
only thing the cockpit is for.

Four issues follow this one — central formatting (#40), the full text migration
(#42), the persisted language switch (#36), the test and layout suite (#37). All
four build on decisions made here, so the foundation has to be right before any
of them starts, and it has to be small enough to still be right afterwards.

## Decision

### i18next and react-i18next, not a home-grown layer

`i18next` 25 with `react-i18next` 16. The alternatives were a hand-rolled
context with a lookup table, `react-intl`, and `lingui`.

A home-grown layer is the tempting one and the wrong one: the moment German
plurals, English plurals, ordinals, interpolation, namespace fallbacks and a
missing-key policy all have to be right, the "small" layer is a worse copy of
i18next with no test suite behind it. `src/lib/plural.ts` — a two-form German
table that cannot express the CLDR categories a third language would need — is
the proof in this repository that the small version does not stay small.

i18next was chosen over the other two for reasons that matter to *this*
codebase:

- **Synchronous initialisation with bundled catalogues.** Nothing is fetched, so
  `init()` completes before the first render. That is what makes "no visible
  language switch at start-up" a property of the architecture rather than a
  thing to be careful about.
- **A missing-key policy that is configuration, not convention** —
  `saveMissing`, `missingKeyHandler`, `parseMissingKeyHandler`,
  `returnEmptyString`. The behaviour below is four options, not four helpers
  somebody has to remember to call.
- **Typed keys through module augmentation.** `t()` accepts only keys that
  exist, which — see below — is what turns the translation contract from a
  documented rule into a compile error.
- **Namespaces as first-class units**, which the seven-way split this issue
  requires is built out of.
- **`Trans`**, for the cases in #42 where a reported value has to sit inside a
  translated clause with markup around it.

`react-intl` has no equivalent of typed keys against a resource shape, and
`lingui` is built around message extraction from source text — the opposite of
the semantic-key rule below, and it would need a compiler step in a container
build that ADR 0009 deliberately keeps free of code generation.

### The translation contract

**Translated:** navigation and UI chrome, buttons, menus, tooltips, loading,
error and empty states, status vocabulary from a *closed* UI set, help texts,
accessible names and screen-reader text, and the presentation of dates, numbers,
percentages and plurals.

**Never translated, never reformatted, never normalised:** agent feedback, agent
task descriptions, textual agent messages, code diffs, source code, file paths,
component ids, run and agent ids, repository data, NATS topics, technical event
names, and every other reported project value.

The line is between *our words about the data* and *the data*. Everything on the
second list arrives from the read API and leaves through the DOM unchanged.

### The contract is built, not only written down

A documented rule that nothing enforces is a rule that survives exactly until
the first busy afternoon. Three mechanisms hold it up, in decreasing strength:

**Typed keys make the violation a type error.** `src/i18n/i18next.d.ts` augments
`CustomTypeOptions` with the German catalogue, so the argument of `t()` is a
union of existing keys. `t(component.componentId)` does not compile. This is the
strongest of the three and it costs one file: the "typing is too much ceremony"
escape hatch was not needed, because the resources are plain JSON and the
augmentation is nine lines. It pays for itself twice over — it also catches a
typo, a renamed key and a key deleted from a catalogue but not from the code, at
`npm run typecheck` rather than in the browser.

**`<ReportedText>` marks the value at the render site.** A one-element component
that renders its `value` and nothing else. It was chosen over a `reported(value)`
helper for a reason that is not cosmetic: a function returning its argument is a
no-op, and a no-op is deleted by the first person who reads it. The component
does something a helper cannot — it emits `translate="no"`, which keeps the
browser's *own* page translation away from the value. Chrome will otherwise
happily translate agent feedback and code diffs on a page that declares
`lang="de"`, and the reader would never learn that the audit trail they are
looking at is machine output. It also carries `data-reported`, so "show me every
place reported data reaches the screen" is one `git grep` and one test query.

**Interpolation covers what markup cannot reach.** An `aria-label` holds a
string, not elements. There the reported value is interpolated into the
translated sentence — `t('projects:item.openLabel', { projectId })`. i18next
never translates an interpolated value, and `interpolation.escapeValue: false`
keeps it byte-identical; React still escapes on render, so nothing is lost by
switching it off. A test pins that a value containing `&`, `/` and spaces
survives both languages unchanged.

### Semantic keys, and German as the reference catalogue

Keys are `projects.empty.title`, never `"Keine Projekte gefunden"`. A key that
*is* the German source text has to change whenever the German wording is
polished, and that edit silently orphans every other language — the exact defect
the catalogue check below exists to find, introduced by the naming scheme
itself.

German is the reference: a key exists once it exists in `locales/de`. That makes
the type augmentation single-sourced and the parity check directional, and it
matches how the product is actually written.

The convention, `<namespace>/<area>.<element>[.<variant>]`, is written down in
`frontend/src/i18n/README.md` rather than here, because #42 will read it a
hundred times and an ADR is not a reference card.

### Seven namespaces, statically imported

`common`, `errors`, `projects`, `workspace`, `canvas`, `agents`, `inspector` —
the panes of the cockpit plus the two cross-cutting ones. Four of them are
committed empty: their texts are migrated in #42, and creating them now means
that issue fills files instead of inventing a structure.

The catalogues are `import`ed, not fetched. They are small, the cockpit is a
single desktop bundle served by Nginx, and a lazy namespace loader would buy a
few kilobytes at the price of the one property this issue must guarantee: the
first paint is already in the final language.

### The language is decided before the router exists

`main.tsx` calls `createI18n()` and `bindDocumentLanguage()` before
`createAppRouter()`. `createI18n` returns an *initialised* instance — bundled
resources plus `initImmediate: false` take the synchronous path — so there is no
tick in which a component could render bare keys or the wrong language and be
corrected afterwards. A test asserts that no `languageChanged` event fires while
the application starts up.

`createI18n` is a factory, not a module singleton, for the same reason
`createAppRouter` is one (ADR 0003): every test gets its own instance and cannot
leak a language into the next one.

Without a stored choice the language is German, and `Accept-Language` is
**not** consulted. Navigator sniffing is the conventional default and it is
wrong here: the requirement is that German is the language absent a stored
choice, and a sniff would hand English to a user who never asked for it. A
stored value that is no longer supported is treated as absent, not as an error —
the behaviour #36 has to preserve when it starts writing that key.

`<html lang>` is bound to the active language and follows every change, so the
switch in #36 gets it for free. It is not decoration: screen readers take their
pronunciation from it, and it is what tells a browser which language the page
claims to be in.

### Missing keys: two different failures, two different guards

**A key that resolves in no language** is a runtime concern:

| | behaviour |
| --- | --- |
| development | `console.error` from `missingKeyHandler`, rendered as `⟦projects:list.title⟧` |
| production | the key itself |

Never an empty slot. A blank is the only failure mode that nobody reports,
because there is nothing on screen to report; a visible key at least travels
into a bug ticket. `returnEmptyString: false` extends the same reasoning to an
accidentally emptied translation, which falls back instead of rendering nothing.

**A key that is missing in one language** never reaches the runtime at all:
`fallbackLng: 'de'` answers it, and the English reader silently reads German.
A `missingKeyHandler` cannot see this, so it is checked statically instead.
`npm run check:locales` compares every language against German and fails on a
missing key, an orphaned key, a namespace present in only one language, an empty
translation, and a translation that drops an interpolated value.

**The check was verified to fail.** `src/i18n/catalogues.test.ts` runs the script
against the real catalogues *and* against five deliberately broken ones, one per
finding. A guard that has only ever been green proves nothing — the same
argument, and the same arrangement, as the contract drift test in ADR 0009. The
script also takes a directory argument purely so that test can point it
somewhere broken.

### One area migrated, on purpose

Only the project list and its loading, error and empty states move onto the
catalogues here. It is the smallest area that exercises every part of the
foundation — a heading, a description, an empty state, a loading announcement
for screen readers, an error state, a translated accessible name, and three
reported values (project id, run id, timestamp) that must not move.

The rest of the application stays hard-coded until #42. A half-migrated surface
is worse than an un-migrated one, and doing it here would bury the architecture
in a diff nobody can review.

## Consequences

- **`t()` is typed, so a catalogue change is a compile error.** Deleting a key
  from `locales/de` fails `npm run typecheck` at every call site. This is the
  intended cost; it is also why the German catalogue is the single reference.
- **#42 inherits a convention, not a blank page**: semantic keys, seven
  namespaces, German as reference, `<ReportedText>` for reported values,
  interpolation for accessible names, alphabetically sorted files.
- **#42 has a specific piece of unfinished business.** `describeError()` in
  `src/api/problem.ts` is not a component and cannot call `useTranslation`. Most
  of what it returns is reported data — the backend's problem title and its
  stable code — and stays as it is; its two generic fallbacks ("Backend nicht
  erreichbar", "Unbekannter Fehler") are ours and need the `t` function threaded
  in. Left alone here rather than half-solved.
- **`src/lib/plural.ts` survives this issue unchanged** and is replaced by the
  locale-aware formatting service in #40. Rewriting it here would have meant
  building #40's service without #40's requirements.
- **`AsyncState` was migrated although it is shared.** It renders the project
  list's loading, error and empty states, which this issue must cover. Its
  `emptyTitle`/`emptyDescription` stay props: what "nothing here" means is the
  caller's sentence. Every other pane that uses it sees the same German text as
  before, now from the catalogue.
- **The test setup installs a German instance for every test.** react-i18next
  uses the most recently initialised instance as its default, so a component
  test that renders a translated component without a provider gets German rather
  than bare keys. `renderApp` overrides it through `I18nextProvider` and accepts
  a `language`, which is how #37 will run the same core path twice.
- **Two dependencies, ~50 kB gzipped, added to a bundle that already exceeds
  Vite's warning threshold** (ADR 0003). Acceptable for the same reason as
  before — a desktop cockpit served by Nginx on a local network — and the
  catalogues themselves are the part that grows in #42.
- **`npm run check:locales` is not yet a CI step.** It runs inside the Vitest
  suite, which CI already executes, so a catalogue mismatch fails CI today. #37
  adds it as its own step so the failure names itself.
