# 21. The persistent language switch, and preserving state by not touching it

- **Status:** accepted
- **Date:** 2026-08-05
- **Context issue:** #36 (part of the i18n epic #1); unblocks #37
- **Builds on:** [0014 — Localisation architecture and translation contract](./0014-localisation-architecture-and-translation-contract.md),
  [0020 — UI text migration and the technical glossary](./0020-ui-text-migration-and-the-technical-glossary.md),
  [0008 — Architecture canvas layout and edge bundling](./0008-architecture-canvas-layout-and-edge-bundling.md),
  [0017 — Readable entry zoom and progressive disclosure](./0017-readable-entry-zoom-and-progressive-disclosure.md),
  [0003 — Frontend state split and live updates](./0003-frontend-state-split-and-live-updates.md)

## Context

Everything the language switch needs already existed. ADR 0014 decided the
language before the router is built and bound `<html lang>` to it; ADR 0019
routed every date, number and percentage through one language-aware service;
ADR 0020 moved all 366 texts into the catalogues, so a `languageChanged` event
already re-renders the whole cockpit in the other language. `localStorage` was
already read under `visualise-ai.language`, and #38 wrote the key down precisely
so that this issue would not invent a second one.

What was missing was a control — and the guarantee that using it does not cost
the user their place.

That guarantee is the whole of this issue, because the cockpit's state is
unusually easy to lose. It sits in four places at once:

- the **URL** carries the selection (`?component=`, `?focus=`, `?history=`) and
  is the only shareable form of a view (ADR 0003);
- the **persisted half of the UI store** carries the pane split and the collapse
  flags;
- the **transient half** carries the canvas camera, the drag positions, the
  container disclosure and the selection — deliberately *not* persisted,
  because they describe one concrete architecture snapshot;
- **React Flow** carries the rendered viewport.

A `location.reload()` — the obvious implementation, and the one most language
switches ship — destroys the third of those four completely. The user would come
back to the same URL with the camera thrown back to the entry picture and every
container they opened closed again. And the canvas has a second, subtler failure
mode: a language changes text lengths, and if that were allowed to reach ELK or
`fitView`, the picture would jump even without a reload. The camera policy knows
exactly three reasons to move (ADR 0008, ADR 0017) and a language is none of
them.

## Decision

### The switch changes the language and nothing else

`useLanguagePreference().choose(language)` writes the preference and calls
`i18n.changeLanguage`. That is the entire implementation, and every property
this issue promises follows from what it does *not* do:

| what is preserved | how |
| --- | --- |
| the URL, byte for byte | nothing navigates — the router is never called |
| pane sizes and collapse flags | nothing writes the UI store |
| camera, disclosure, selection, drag positions | nothing unmounts, so the transient half of the store is never re-initialised |
| the rendered viewport | ELK is keyed on the projection signature and the collapsed set, neither of which is language-dependent, so no re-layout happens and `fitView` is never called |
| reported project data | it never went through the translation layer in the first place (ADR 0014) |

This is preservation by **omission**, and that is the point. The alternative —
saving state before the switch and restoring it afterwards — has to enumerate
what state exists, and an enumeration is wrong the moment somebody adds a
fifth thing. There is no list here to fall out of date.

`<html lang>` is the one thing that does follow, and it already did:
`bindDocumentLanguage` subscribes to `languageChanged` and was written in #38
for exactly this moment.

### Where the switch lives, and why not everywhere

Two places, one component:

- **the workspace header**, in its right-hand cluster next to the live badge and
  the pane toggle — the controls that are about *how* the cockpit is looked at
  rather than about the data. It is the cockpit's only persistent chrome, and
  it is where the state-preservation requirement actually bites.
- **the project list**, next to its heading. It is the entry point and the page
  every other screen links back to, so choosing a language before opening a
  workspace is possible.

The error and not-found pages deliberately do **not** carry it. They are dead
ends with a single action ("back to projects"), and a preference control next to
a failure is noise at the worst moment; the page it sends the reader to has the
switch. A global bar above the router was rejected for a harder reason: it would
cost vertical pixels on every screen, and the desktop budget of ADR 0015 is
already spent on three panes and a 44 px header.

The control is 59 × 30 px and fits inside the existing header without changing
its height — which is also why it cannot move the canvas: the drawing surface
is measured, and a header that grew would have resized it and, through
`onLayoutReady`, been a legitimate reason to fit.

### Two segments, not a dropdown

There are two languages. A menu would hide both options behind a trigger and
cost a click to answer "what can I even choose"; two segments show the options
and the current one at the same time, in the width of a badge. The architecture
surface stays the widest thing on screen (ADR 0008), which a settings menu with
a panel would not have threatened either — but a third header control would
have.

The segments are `aria-pressed` toggle buttons inside a `role="group"` with a
translated accessible name, not a `radiogroup`. A radio group is the textbook
mapping for "one of n" and it comes with a roving `tabindex` and arrow-key
handling that a correct implementation has to write itself; this repository has
no shadcn toggle group to inherit one from, and writing a keyboard model for two
options would be more code than the feature. Both segments are ordinary tab
stops, `Enter` and `Space` activate them, and the pressed state is what a screen
reader announces.

**Each segment is named in its own language** — "Deutsch" and "English",
identical in both catalogues. A reader who ended up in a language they cannot
read has to be able to find their way out, and translating the exit is exactly
the wrong help. The group's name and the tooltips are translated normally.

### Focus stays on the segment that was used

The click is not a navigation and causes no remount, so the button keeps the
focus it received. That is the deliberate answer to "where should focus land":
on the control the user just operated, whose `aria-pressed` has just flipped —
rather than on a heading somebody chose to move it to, and certainly not on
`<body>`, which is where a reload would have left it.

### A stored language that is no longer supported is discarded, not just ignored

#38 already treated an unsupported stored value as absent. #36 adds that
`resolveInitialLanguage` also **removes** it.

Leaving it costs nothing today and is wrong in two ways tomorrow. The switch
would paint German while storage claims `fr`, so the persisted preference and
the visible one disagree with no way for the user to see it; and a later release
that reintroduced `fr` would silently resurrect a choice made before it was
dropped.

The removal lives inside the resolver rather than in a separate clean-up step at
start-up, because there is exactly one moment at which the cockpit compares a
stored value against the supported set, and a second implementation of that
comparison is a second chance to get it wrong. It only fires for a value that
is really there: "nothing stored" is the normal case and must not cause a write.

Every storage access — read, write, remove — is individually guarded. A
private-mode browser that throws on any of them still gets a cockpit; a
preference that could not be *remembered* is not a reason to refuse the language
the user just asked for.

### The proof is a before/after inside one rendering

`WorkspacePage.i18n.test.tsx` (#42) already renders the workspace twice and
compares the reported data. That test cannot see this issue's failure modes,
because all of them — a fit, a navigation, a remount — only exist on the
*transition*.

`LanguageSwitch.i18n.test.tsx` therefore measures one rendering before and after
a real click: the router's `location.href` as a string, the UI store's pane and
camera fields, `data-fit-view-count`, the `.react-flow__viewport` transform, and
every `[data-reported]` text content in document order. It waits for the
workspace to stop moving on its own first — ELK finishing, the initial
disclosure being written down, the one automatic camera movement landing —
because measuring earlier would charge the switch for a change it did not cause
and, worse, hide one it did.

## Consequences

- **`resolveInitialLanguage` now has a side effect**, which its name does not
  advertise. It is documented at the function and here, and it is the price of
  having exactly one place that decides whether a stored language is usable.
- **`storeLanguage` is the only writer of `visualise-ai.language`.** The UI
  store's `visualise-ai.ui` is untouched by this issue; the two preferences stay
  separate because one of them is a property of the reader and the other is a
  property of this browser tab's view of one project.
- **The switch's texts live in `common`**, not in `workspace`. It appears on two
  surfaces, so it belongs to neither of them — which is the rule `common` was
  given in ADR 0014.
- **#37 inherits a transition to test.** The pseudo-locale and the desktop
  screenshots it adds can now be taken in both languages *without* reloading,
  and the `[data-reported]` comparison it reuses has a runtime variant.
- **Nothing in the canvas, the viewport or the agent pane changed.** The camera
  stability asserted here is a property those modules already had; this issue
  only proves that a language switch does not reach them.
