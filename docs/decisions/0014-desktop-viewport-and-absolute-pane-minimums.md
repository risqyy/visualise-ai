# 14. The real viewport, absolute pane minimums and one place where sideways scrolling is allowed

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #41 (part of the v0 epic #1)
- **Builds on:** [0003 — Frontend state split and live updates](./0003-frontend-state-split-and-live-updates.md),
  [0008 — Architecture canvas](./0008-architecture-canvas-layout-and-edge-bundling.md),
  [0013 — Mandatory end-to-end acceptance](./0013-mandatory-end-to-end-acceptance.md)

## Context

The cockpit is desktop-only and its mandatory acceptance surface is
1920 × 1080 in Chromium (epic #1). That is a floor for *acceptance*, not a
statement that no other window exists. Three ordinary desktop situations
produce a narrower CSS viewport without anybody choosing a different device:

- a window that is not maximised,
- two windows split across one screen,
- **browser zoom** — 1920 px at 125 % is a 1536 px viewport, at 150 % a 1280 px
  one. Zoom is an accessibility setting, and refusing to lay out for it is
  refusing the setting.

The shell was pinned against all three by `<meta name="viewport" content="width=1920">`
and by pane minimums expressed in **percent**. Both are wrong for different
reasons, and the second one is the one that actually hurt.

## Decision

### The viewport meta describes the device, not a wish

`width=device-width, initial-scale=1`. The fixed `width=1920` told every
viewport-honouring browser mode to lay the page out as if the window were
1920 px and then scale the result — which is precisely the behaviour the issue
reports. Desktop Chromium ignores the tag altogether, which is why the defect
was invisible in the acceptance run and visible to users: the tag was wrong
*and* inert on the one browser that gates the release.

### Shares are relative, minimums are absolute

The split stays a share of the window — 18 / 54 / 28 — because that is what
keeps the architecture surface the visually dominant area at every width
(ADR 0008), and a share does that by construction.

The **minimums are pixels**, not percentages:

| Pane | Minimum | Why that number |
| --- | --- | --- |
| Run and agents | 260 px | a run row is a 20-character monospace id plus its state badge; the agent tree indents four levels before it truncates |
| Architecture | 500 px | the canvas toolbar is ~300 px and the minimap 168 px in the opposite corner — below ~500 px they meet and the graph has nothing left |
| Inspector | 340 px | two 40 px line-number gutters plus a code column worth reading before it scrolls |

A percentage minimum shrinks with the window, which inverts the intent: the
content a pane must show does not get narrower because the window did. The old
12 % floor on the run pane meant 230 px at 1920 and 154 px at 1280 — the width
at which it is *least* affordable. The three pixel minimums add up to 1100 px
and therefore fit into 1280 with room to spare; `state/paneSizing.test.ts`
asserts that as an invariant rather than as a comment.

At 1280 the default shares would give the run pane 230 px, so it is clamped up
to 260 px and the difference comes out of the centre — 260 / 660 / 358. The
centre is the pane that gives space up, because it is the only one with space
to give. The measured splits:

| Window | Run pane | Architecture | Inspector |
| --- | --- | --- | --- |
| 1280 | 260 px | 660 px (52 %) | 358 px |
| 1440 | 260 px | 776 px (54 %) | 403 px |
| 1536 (1920 @ 125 %) | 276 px | 828 px (54 %) | 430 px |
| 1920 | 345 px | 1036 px (54 %) | 537 px |

Deep focus stays the one documented exception to "the canvas is the widest
pane" (ADR 0008). It is also the constraint that fixes the centre minimum: its
41 % centre share is 524 px at 1280, so a minimum above that would turn the
mode into a silently clamped, slightly different split.

### Sideways scrolling belongs to the content, never to the page

`body` keeps `overflow: hidden` and each pane owns its own scroll region. Wide
technical content scrolls **inside the box that owns it**: a unified diff, a
fenced code block, a markdown table, the React Flow viewport. Nothing that
scrolls sideways is allowed to be a page-level scroller.

That rule had one silent hole, and it was invisible at 1920. The Radix
`ScrollArea` viewport wraps its children in a `display: table` box, which sizes
to its own min-content width and may therefore be **wider than the viewport** —
while the viewport itself clips horizontally, because this `ScrollArea` renders
a vertical scrollbar only. The result is not a scroller, it is a guillotine: at
a 260 px run pane the content box still claimed 341 px and 81 px of it was
unreachable by any means. Forcing that wrapper to a block box makes the content
wrap to the pane. It is a one-line override in `components/ui/scroll-area.tsx`
and it is correct for both places the component is used, which are both
vertical lists.

### The measurement stays where it already is

`e2e/tests/08-viewport.spec.ts` asks the browser, not the DOM: no horizontal
page scrollbar, and every primary control rendered, inside the viewport and the
element `elementFromPoint` finds at its own centre. That check is unchanged, and
it still runs at exactly 1920 × 1080 — the acceptance resolution is a property
of the release gate, not of the layout.

Its documented Chromium oddity stays documented: `document.documentElement.scrollHeight`
reads 2663 instead of 1080 over the Radix `ScrollArea` viewport, so the test
measures `body` and `#root`. That is a measurement artefact and not a defect,
and this decision does not touch it.

## Consequences

- 1280 px is now a supported width with a name — `MIN_SUPPORTED_WIDTH` — and
  the pane minimums are checked against it. Adding a narrower supported width is
  a decision, because the minimums no longer fit into it by arithmetic.
- Browser zoom needs no separate handling. Zoom changes the CSS viewport and
  nothing else, so "works at 1280" and "works at 1920 with 150 % zoom" are the
  same statement, and the same measurement covers both.
- The `ScrollArea` override is a Radix implementation detail pinned in our
  wrapper. A Radix upgrade that stops emitting the `display: table` wrapper makes
  the override a no-op rather than a breakage, but the comment has to be checked.
- Truncation in the run pane is real at 260 px: long agent display names ellipse.
  The agent area is being reworked in #39; giving those rows a hover title or a
  second line belongs there, not here.
