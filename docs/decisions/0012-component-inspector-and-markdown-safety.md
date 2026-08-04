# 12. Component inspector: untrusted markdown, diffs grouped by change, and a reading position that survives live updates

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #12 (part of the v0 epic #1)
- **Builds on:** [0003 — Frontend state split and live updates](./0003-frontend-state-split-and-live-updates.md),
  [0005 — Read API shape and run scoping](./0005-read-api-shape-and-run-scoping.md),
  [0009 — Generated frontend contract types](./0009-generated-frontend-contract-types.md)

## Context

The inspector is where the cockpit stops being a picture and starts being
evidence. After a click on a component it has to answer, without the user
opening the repository: which agent is working here, on what, with what status,
in which run — and what did it actually report about this component.

That evidence has three uncomfortable properties.

It is **written by a machine that is not trusted**. `FeedbackEntry.body` is
markdown produced by an agent, whose own input is web pages, tool output and
files. The contract states the consequence in as many words: the body is
"untrusted markdown … handed through verbatim — sanitising it before rendering
is the client's job."

It is **fragmented**. One `diff.reported` event carries exactly one repository
file. A change that touched three files is three events, and the only thing
that joins them is `changeId`. Read as a flat list, a coherent piece of work
looks like three unrelated edits.

It **keeps arriving**. The user is reading a diff while the agent continues to
work, and the read API serves component evidence newest first — so new content
appears *above* what is being read.

## Decision

### Agent feedback is untrusted input, and it is sanitised after rendering

Feedback is rendered through a fixed pipeline in
`components/workspace/inspector/SafeMarkdown.tsx`:

`remark-parse` + `remark-gfm` → `remark-rehype` → `rehype-raw` →
**`rehype-sanitize`** → React elements (with react-markdown's
`defaultUrlTransform`).

Three things about that order are deliberate.

**Sanitising happens on the HTML tree, last.** Not by refusing to parse HTML,
and not by trusting React's escaping. `react-markdown` always runs
`remark-rehype` with `allowDangerousHtml`, so reported HTML survives as raw
nodes regardless; `rehype-raw` turns them into real elements, and
`rehype-sanitize` is the boundary they have to pass. A plugin inserted before
the sanitiser is covered by it, one inserted after is not — which is why the
plugin array is a module constant and not assembled at the call site.

**It is an allow list, taken from a library, not a list of forbidden
patterns.** `sanitizeSchema.ts` starts from the GitHub-style `defaultSchema` of
`hast-util-sanitize`: any tag and any attribute that is not enumerated is
removed. That makes the failure mode "a harmless element was dropped", not "a
vector nobody predicted got through". A hand-written blocklist has the opposite
failure mode and has historically always been incomplete. The schema adds only
two things: the active element families (`script`, `style`, `iframe`, `object`,
`embed`, `svg`, `form`, …) are put in `strip` so they are removed *with their
children* rather than unwrapped, and the URL protocol lists are stated
explicitly so `javascript:`, `data:` and `vbscript:` cannot appear in an `href`
or a `src`.

**`rehype-raw` was kept on purpose, and it is what makes the guarantee
testable.** Dropping raw HTML entirely would be marginally safer and would make
every attack test vacuous: it would pass on a renderer whose sanitiser had
rotted away years ago. With raw parsing enabled, the sanitiser is the only thing
between the payload and the DOM, so the tests measure the property that is
actually claimed. `SafeMarkdown.test.tsx` therefore carries a positive control —
`<b>` and `<kbd>` survive — next to nine attack vectors: `<script>`, an
`onerror` handler (fired explicitly), `<iframe srcdoc>`, `<object>`/`<embed>`,
`javascript:` in a link href (clicked explicitly), `javascript:` in an image
src, `<style>`, an inline `style` plus `onclick`, and `<svg onload>`. Each
asserts both halves: a global sentinel the payload writes to stays empty, and
the dangerous element or attribute is absent from the rendered markup.

`dangerouslySetInnerHTML` appears nowhere in the inspector.

### Diffs are grouped by `(runId, agentId, changeId)`, and unattributed ones stand alone

`diffGroups.ts` reconstructs the logical change the contract split apart. The
key is a triple rather than just `changeId`: two agents reporting the same
change id did two pieces of work, and merging them would attribute one agent's
edit to the other. The run stays in the key even though the inspector is already
scoped to one run, so the grouping cannot silently mix runs if it is reused.

A diff whose `changeId` is `null` — the contract's "unattributed diff" — becomes
its own group. Collecting them into one bucket would invent a change the agent
never reported, and the simulator deliberately emits one such diff next to the
three that share `change-2026-08-04-0007`.

Duplicate `diffId`s are dropped. Two pages of the same collection can overlap
when the underlying list grows between requests, and a diff rendered twice reads
as work done twice.

Diffs are the only paged part of the inspector (`diffLimit`/`diffCursor` →
`nextDiffCursor`, ADR 0005), so `componentInspectorQuery` became an infinite
query. Every page repeats the complete non-paged collections; the first page is
treated as authoritative for the component, the agent, the work step, the
feedback, the risks and the problems, and later pages contribute only diffs.

### Corrections and retractions add, they never replace

The history view renders the append-only log as it is. `historyEntries.ts`
removes nothing and rewrites nothing: it only *links* entries, marking the
original that a later `correction.issued` or `retraction.issued` refers to, and
keeping the correcting entry in its own place with the reason the agent gave.

Showing only the corrected end state would be the more comfortable UI and the
wrong one. The reviewer's job in this product is to judge whether the agent's
work is going off the rails; "it claimed X, then withdrew it" is exactly the
signal that judgement needs, and it is invisible in a view that overwrites.

Current run and history stay **mutually exclusive views**, not a filter over one
list. They come from different endpoints for the reason ADR 0005 gives, and the
UI keeps that separation visible: a diff from yesterday can never appear in the
same list as one from the run being watched. The current run is the default; the
history sits behind a tab and the `history` search parameter.

### The reader's place is anchored, not restored

`scrollStability.ts` pins the topmost visible entry rather than the raw
`scrollTop`. While the user scrolls, the first element carrying
`data-scroll-anchor` that is still in view is remembered together with its
distance from the top of the viewport; after a content change it is looked up
again and the offset is corrected by exactly how far it moved.

Remembering `scrollTop` would be wrong — that number *has* to change when
content is inserted above. Remembering nothing would also be wrong: the browser
keeps `scrollTop` and the content slides under the reader. Nothing is restored
while the viewport is at the top, where there is nothing to lose.

The inspector body scrolls in a plain container instead of the Radix
`ScrollArea` the other two panes use. It nests horizontally scrolling diff
boxes, and the anchor needs the real scroll offset of the real element.

Deep focus builds on the mode from #7 rather than reinventing it: the `focus`
search parameter and `DEEP_FOCUS_PANE_LAYOUT` are unchanged, and the inspector
only adds that the *other* sections step aside instead of shrinking, so the
extra width is spent on the content being read. The canvas keeps ~41 % of the
width — roughly 790 px at 1920 — throughout.

## Consequences

- The frontend gained four runtime dependencies: `react-markdown`, `remark-gfm`,
  `rehype-raw` and `rehype-sanitize`. That is the price of not writing a
  sanitiser, and it is the right trade: a home-made filter would be smaller and
  wrong.
- The sanitisation schema is a security control, so changing it needs the same
  care as changing an auth rule. Adding a tag to `tagNames` or a scheme to
  `protocols` widens what an agent can render into the cockpit's own origin.
  Three tests assert properties of the schema itself (no executable protocol, no
  `on*` attribute, no `srcdoc`) so a careless widening fails rather than ships.
- `useComponentInspector` is now an infinite query. Callers read
  `data.pages[0]` for everything except diffs; treating a later page as the
  head would show a stale agent or a stale work step.
- The anchor arithmetic is unit-tested, the anchor *measurement* is not: jsdom
  has no layout engine and reports zeros from `getBoundingClientRect`. The
  behavioural guarantee is covered end to end instead — selection, run context,
  the scroll container's identity and its offset are all asserted unchanged
  across a live `diff.reported` that prepends a group.
- The inspector renders four collections that the read API does not page
  (feedback, risks, problems, active changes). If one of them ever grows without
  bound, the fix belongs in the contract, not in a client-side cap.
