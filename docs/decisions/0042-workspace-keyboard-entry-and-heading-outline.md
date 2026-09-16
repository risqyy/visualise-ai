# 42. Short keyboard routes through the workspace

- **Status:** accepted
- **Date:** 2026-09-16
- **Context issue:** #120
- **Builds on:** [0003 — Frontend state split](./0003-frontend-state-split-and-live-updates.md), [0012 — Inspector and markdown](./0012-component-inspector-and-markdown-safety.md), [0027 — Spatial keyboard navigation](./0027-spatial-keyboard-navigation.md)

## Decision

The workspace owns one named `main` and an `h1` identifying the project and run.
Its document title carries the same context and is restored when leaving the
workspace. The three pane titles are `h2` destinations; section labels are `h3`,
followed by the existing plan/report titles and revisions.

Three links at the start of the keyboard order become visible on focus. Each
focuses its pane heading, so the next Tab enters that pane's controls. A side-pane
jump leaves architecture focus and opens its destination if folded. Inspector
deep focus and all URL context remain intact. The action waits for the heading
to mount and uses `preventScroll`, avoiding fragment navigation that would scroll
the fixed workspace. Graph keyboard navigation remains owned by the canvas.

Reported markdown headings are rebased below their `h4` report title. Distinct
source levels are ranked relative to the first heading and clamped to `h5`–`h6`.
The first heading starts at `h5`, and repeated source levels always remain peers,
even when a shallower heading appears later. Such later parent levels cannot
move above the report title and are flattened at `h5`. A report beginning with
`##` therefore does not create a skipped heading level. This normalization
runs on the parsed tree, including harmless raw HTML, before the final sanitizer.
Subtrees that the sanitizer strips cannot influence the visible outline. Reported
wording is unchanged. HTML's six heading levels limit how much deep report nesting
can be represented semantically.

## Validation

Unit and browser checks cover keyboard entry, hidden-pane recovery, retained URL
context, the heading outline, localized titles, and existing graph navigation.
Markdown tests retain the sanitization boundary and exercise reports whose source
outline starts below level one or contains stripped embedded content.
