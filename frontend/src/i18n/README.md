# Localisation

German is the product's language, English is the second one. This directory
holds the whole localisation layer: the catalogues, the i18next factory, and the
one component that marks text which must never be translated.

The reasoning behind all of it is
[ADR 0014](../../../docs/decisions/0014-localisation-architecture-and-translation-contract.md).

## The translation contract

The cockpit shows two kinds of text, and confusing them is the one mistake this
layer exists to prevent.

**Translated — ours:**

- navigation and UI chrome, pane titles, buttons, menus, tooltips
- loading, error and empty states
- status vocabulary from a *closed* UI set (`planned`, `active`, …)
- help texts, accessible names, screen-reader-only text
- date, number, percentage and plural presentation (centralised in #40)

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

## Layout

```
locales/de/<namespace>.json   reference catalogue — a key exists once it exists here
locales/en/<namespace>.json   must describe exactly the same keys
```

`workspace`, `canvas`, `agents` and `inspector` exist but are still empty. Their
texts are migrated in #42; the namespaces are already here so that work only has
to fill files.

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
broken catalogues, so the check is known to go red.

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
