# 14. Agent pane density: what is painted first, and what is never removed

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #39 (part of the v0 epic #1)
- **Builds on:** [0011 — Run and agent hierarchy](./0011-run-and-agent-hierarchy.md),
  [0003 — Frontend state split and live updates](./0003-frontend-state-split-and-live-updates.md)

## Context

ADR 0011 gave the run/agent pane its content: every row answers role, assigned
task, last reported timestamp, explicit status and reported progress, and every
"nothing was reported" case has its own label. It did not say what any of that
should *weigh*.

Against real data the result flattens. A run of ten agents at three levels —
what the simulator's `self` scenario reports — paints ten rows of seven lines,
almost all of them at 11 px, all of them the same colour. Measured on `develop`
at 1920 × 1080 the agent list is **2150 px tall in a 345 px pane**, with 240 of
its 256 text elements at 11 px. Two of those rows fit fully on screen. The root
orchestrator's `assignedTask` is a full paragraph and a subagent's is three issue
titles chained with `·`, so the longest reports are also the ones that push
everything else off the screen.

Two failure modes are specific to *this* pane, and both are worse than the
density problem they would solve:

- Any rule that decides "this agent matters less" is a **verdict about agent
  work**, which the product forbids (#1). The obvious rule — "nothing has
  happened here for a while" — is exactly the stall detection ADR 0011 ruled out.
- Any shortening done in JavaScript stores a **rewritten report**. An assigned
  task with an ellipsis in it is not what the agent said.

## Decision

### Density follows the agent's own reported status, and no clock is read

A row paints its detail block by default exactly when the agent's last reported
status is one of `working`, `waiting`, `blocked` **and** it reported no
`finishedOutcome`. Everything else — `done`, `idle`, a reported outcome, and "no
status was ever reported" — starts compact. `reportedWorkState` in
`runAgents/reporting.ts` is that rule, and it reads two fields: `status` and
`finishedOutcome`.

It reads no third field. `lastEventAt`, `startedAt` and `Date.now()` are not
consulted, here or anywhere else in the module — ADR 0011's "there is no stall
detection, and no clock is consulted" survives this change unchanged, and a test
asserts it by giving a `working` agent a timestamp from 2020 and a `done` agent
one from 2099: the density does not move.

The reason for reading the status rather than the clock is not caution. An agent
that reported `working` an hour ago and one that reported it a second ago have
made the *same statement*, and the cockpit cannot tell the two apart. The
reported word is the only thing the pane knows; deriving from anything else
would produce a claim the data does not support.

The word "inactive" does not appear in the interface. A compact row says what
the agent reported — `fertig`, `untätig`, `kein Status gemeldet` — and the test
that forbids the derived-verdict vocabulary covers the new markup too.

Compact is a *smaller rendering of the same row*, not a smaller row: the agent,
its role, its reported status, its status message and its assigned task are all
still there. Only progress, the last reported timestamp, the reported outcome
and the agent id move behind the disclosure. Two things never do: the reported
status, because it is the sentence the row exists for, and the attachment notes
of a malformed parent reference, because hiding those would hide the fact that
the report was malformed.

The user's own toggle wins over the derived default and is stored as an
*override* keyed by agent id, in component state. A row somebody opened stays
open when the next report for that agent arrives; a row nobody touched follows
the report. Nothing about it is persisted — it describes one snapshot of one
run, not a layout preference (ADR 0003).

### Long reports are clipped by CSS, never shortened in code

`ReportedText` renders the complete string and lets CSS `line-clamp` decide how
many lines are painted. No substring is ever computed, so there is no code path
on which a rewritten report could reach the user. The complete text stays in the
DOM and in the accessibility tree at all times: it is selectable, copyable,
findable with the browser's own search and read out in full by a screen reader,
whether the control was used or not. The control changes the paint.

Whether a control appears at all is decided by a character budget (90) rather
than by measuring the rendered box. The budget is deterministic, independent of
the current pane width, and therefore identical in Chromium and in jsdom, which
is what makes "the full text is still reachable" a testable statement rather
than a screenshot.

### The two progress forms are untouched

`ReportedProgress` keeps exactly the geometry ADR 0011 fixed: `scope: own_task`
**and** `basis: completed_steps` is ten discrete segments with
`role="progressbar"`; everything else, including every `scope: overall_estimate`,
is a claim with no track, no fill, a leading `≈` and an attribution. Density
moved *where* the block is painted, never *what* it is. The two forms still
share no container and no shape, and the tests that assert that structurally now
open the row first instead of asserting less.

### 12 px is the floor; 11 px is a named exception

Regular secondary information — labels, statuses, reported tasks, reported
messages, section headings, badges — is 12 px or larger. The one exception is
`.pane-meta`: monospaced identifiers and UTC timestamps. They have a fixed
shape, they are compared rather than read, and they are the only place where the
extra px buys real density. If a string does not fit "an id or a timestamp", it
does not get the class.

The shared `.pane-heading` moved from 11 px to 12 px with it. It is the same
category of text in all three panes, and a floor that only holds in one pane is
not a floor.

### One focus treatment for the whole card

Subtree toggle, selection, detail disclosure and the "show the whole text"
controls carry the identical focus ring (2 px, `--ring`), and hover, focus and
selection are painted on the row rather than on the control that happens to be
under the cursor. Measured in Chromium, all six interactive controls of the pane
resolve to `--tw-ring-shadow: 0 0 0 2px oklch(0.78 0.11 235)` when focused.

## Consequences

- The agent list of the `self` scenario is **1081 px instead of 2150 px** at
  1920 × 1080, and the pane's horizontal overflow at 1280 drops from 111 px to
  72 px. Five rows fit fully on screen instead of two, and 5 text elements sit
  below 12 px instead of 240.
- `sr-only` is `position: absolute`, and the shadcn `ScrollArea` root is the
  nearest positioned ancestor of everything in the pane. A screen-reader label
  therefore has to sit inside a positioned in-flow element, or it escapes the
  scroll container's clipping and stretches the pane by its own offset. The
  agent row and the status tally carry `relative` for that reason; it is not
  decoration.
- Reported numbers are no longer visible without an interaction for agents that
  reported an outcome. That is the intended trade: a finished agent's 100 % meter
  is the most redundant thing on the screen, and its status already says
  `fertig`. Tests and the acceptance suite open the row rather than assert less.
- A future feature that wants to fold rows by age, staleness or "recent
  activity" has to re-open both this ADR and ADR 0011. That is intended.
- `ReportedText` cannot know that a 100-character string happens to fit a very
  wide pane, so its control can occasionally be a no-op. That is the price of a
  rule that behaves identically in a test and in a browser, and the failure mode
  is a harmless control rather than a hidden report.
