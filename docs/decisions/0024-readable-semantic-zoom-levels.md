# 24. Readable semantic zoom levels for the architecture canvas

- **Status:** accepted
- **Date:** 2026-08-17
- **Context issue:** #56
- **Supersedes:** the readability floor and detail thresholds in [0017 — Readable entry zoom and progressive disclosure](./0017-readable-entry-zoom-and-progressive-disclosure.md)

## Decision

The canvas is rendered inside a CSS transform, so a font declared as 10 px is
not a 10 px label on screen. The product documents two effective text floors:

| text class | declared size at zoom 1 | effective minimum | derived threshold |
| --- | ---: | ---: | ---: |
| primary (component names) | 13 px | 12 px | `ceil(12 / 13, 2) = 0.93` |
| secondary (kind, technology, badges, tags, relationship adjuncts) | 10 px | 10 px | `10 / 10 = 1.00` |

The automatic camera uses `MIN_READABLE_ZOOM = 0.93`. It may never choose a
zoom below the primary floor at either supported desktop viewport. A user may
still request the spatial whole-model map, which can zoom farther out because
its purpose is orientation rather than reading.

Detail is a pure presentation decision. Node sizes, ELK input, positions,
selection, search and inspector state do not depend on it:

| semantic stage | zoom | visible canvas content | hidden detail remains available through |
| --- | ---: | --- | --- |
| **Map / Karte** | `< 0.93` | node shape/icon and relationship lines | node/edge selection, tooltip/title, inspector |
| **Readable overview / Lesbare Übersicht** | `0.93–<1.00` | primary names; 11 px state/count summaries | selection, inspector, container disclosure |
| **Standard / Standard** | `1.00–<1.15` | names, kind, technology and short relationship adjuncts | title/tooltip and inspector for full reported values |
| **Full / Vollständig** | `≥ 1.15` | tags and individually fanned relationship labels | inspector and relationship selection |

Long relationship discriminators are never required for the normal canvas
label. They remain verbatim in the title/tooltip and relationship inspector.
At the map stage all text labels are removed, while the relationship path and
accessible edge name remain interactive.

The toolbar names the two camera intents explicitly:

- **Lesbare Systemübersicht / Readable system overview** restores the entry
  picture and its readable camera floor.
- **Gesamtkarte / Whole-model map** expands every container and fits the full
  model as a spatial orientation map. It explains why labels can become hidden
  and does not change the model or disable search/selection.

The current semantic stage is always shown in the toolbar and the exact zoom is
published as `data-canvas-zoom` on the canvas for diagnostics and acceptance
checks. Detail changes do not relayout or move nodes. Existing transitions
respect `prefers-reduced-motion: reduce`.

## Acceptance matrix (working note)

| criterion | 1280 × 720 | 1920 × 1080 | verification |
| --- | --- | --- | --- |
| Automatic camera | zoom ≥ 0.93; primary ≥ 12 px | zoom ≥ 0.93; primary ≥ 12 px | `ArchitectureZoom.test.tsx`, Playwright canvas check |
| No undersized secondary text | at 0.93: no 10 px rows/badges; metadata starts at 1.00 | same | `detailLevel.test.ts`, stage-content E2E |
| Spatial whole-model map | may be below 0.93; label explains orientation purpose | may be below 0.93; label explains orientation purpose | camera/toolbar tests |
| Reachability | search, selection, path click and inspector remain available | same | architecture canvas + Playwright |
| Stable layout | stage changes only content; no ELK rerun or position shift | same | box-size invariant/unit tests |
| Motion preference | transition durations collapse to a near-zero duration | same | reduced-motion CSS rule |
| Language parity | German keys and labels present | English keys and labels present | `check:locales`, `check:ui-strings` |

Local Compose E2E is intentionally not run as part of this change: it mutates
the shared simulator/database state and is outside a safe unit/Playwright
verification run. The repository's existing CI Compose job remains the place
for that destructive integration check.
