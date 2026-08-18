# 25. Architecture focus and responsive canvas overlays

- **Status:** accepted
- **Date:** 2026-08-17
- **Context issue:** #58
- **Builds on:** [0003 — Frontend state split and live updates](./0003-frontend-state-split-and-live-updates.md), [0015 — Desktop viewport and absolute pane minimums](./0015-desktop-viewport-and-absolute-pane-minimums.md), [0024 — Readable semantic zoom levels](./0024-readable-semantic-zoom-levels.md)

## Decision

The canvas toolbar exposes one explicit **Architecture focus** action. Entering
the mode folds both side panes and records the complete current pane
arrangement (layout shares and both collapsed flags) in transient UI state.
Leaving the mode restores that snapshot exactly. Selection, validated URL
parameters, container disclosure, relationship disclosure and inspector data
are not changed by the mode. The focus control is a button rather than a
global shortcut: `/` and `Control/Meta+K` already belong to component search,
so another shortcut would create an avoidable conflict.

Pane folding changes the canvas surface asynchronously. Entering and leaving
architecture focus each schedule one explicit whole-visible-graph fit after the
new surface has settled. The camera policy still treats live events, relayouts
and pane changes after those explicit actions as non-camera events.

Primary canvas actions (search, selection jump, focus, fit and disclosure)
are grouped separately from orientation, minimap and semantic-level
information. When the minimap is visible, the toolbar reserves a fixed right
gutter so wrapping translated labels cannot cover the 168 × 112 px minimap.
The minimap toggle remains a named, keyboard-accessible action when the map is
hidden. React Flow zoom controls stay at bottom-right and attribution at
bottom-left, with no shared overlay footprint.

## Acceptance matrix (working note)

| Criterion | 1280 × 720 | 1920 × 1080 | German / English verification |
| --- | --- | --- | --- |
| Visible action | `Architektur fokussieren` fits in the wrapped primary group | Same action is immediately available | `data-testid="canvas-toggle-architecture-focus"`, button name |
| Enter/leave focus | Both side panes show rails, then the exact arrangement returns; one explicit fit per transition | Same, with larger readable surface | UI store test + Playwright geometry |
| Exact restoration | Pre-existing custom shares and collapsed flags return unchanged | Same | UI store test + Playwright before/after snapshots |
| State preservation | URL selection, selected node, disclosure and inspector context survive | Same | Playwright focus/restoration flow |
| Live safety | Later model event changes no camera/fit count | Same | Canvas camera/live regression test |
| Toolbar/minimap | Toolbar wraps inside its reserved gutter; minimap is unobstructed or toggle is named | Same | Playwright control probes at both widths |
| Keyboard access | Focus, minimap and wrapped controls remain tab-reachable | Same | Playwright focus probe + accessible names |
| Language parity | German and English labels remain unclipped | German and English labels remain unclipped | `check:locales`, `check:ui-strings`, Playwright DE/EN |
