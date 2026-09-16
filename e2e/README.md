# End-to-end acceptance

The mandatory acceptance test introduced by the v0 epic (#14). It starts the
real Compose system with an empty PostgreSQL database, exercises the complete
v0 user journey in **Chromium at 1920 × 1080** exclusively through Nginx, and
cleans up afterward.

**A failure blocks the v0 release.**

The rationale for the test design — one browser, the real system rather than
mocks, observing live states as they happen, and guards against vacuous passes
in replay tests — is documented in
[`docs/decisions/0013-mandatory-end-to-end-acceptance.md`](../docs/decisions/0013-mandatory-end-to-end-acceptance.md).

## Running the suite

From a fresh checkout, with Docker running:

```bash
cd e2e
npm install
npx playwright install chromium
npm test
```

That is all you need. The test handles:

1. `docker compose -p vai-e2e down -v` — start with an empty database,
2. `docker compose -p vai-e2e up --build -d`,
3. waiting for `/readyz` **through Nginx**,
4. acceptance testing,
5. `docker compose -p vai-e2e down -v`.

If simulator dependencies are missing, the test installs them first
(`npm ci` in `simulator/`). Without the simulator, there is no sequence to test.

The HTML report is then available in `playwright-report/`:

```bash
npm run report
```

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `FRONTEND_HTTP_PORT` | `8100` | Host port for the Nginx frontend |
| `E2E_COMPOSE_PROJECT` | `vai-e2e` | Compose project name for the acceptance stack |
| `E2E_BASE_URL` | `http://localhost:<port>` | Entry point when not using localhost |
| `E2E_SKIP_COMPOSE` | off | Use an already running stack |
| `E2E_KEEP_STACK` | off | Leave the stack running after the test |

The default port is deliberately **8100**, not 8080: ports 8080–8083 are often
occupied on development machines, and a release gate that fails because another
application owns a port tends to be ignored. CI sets `FRONTEND_HTTP_PORT=8080`
to keep the documented default port under test too.

The dedicated Compose project name matters more than the port: without it,
`down -v` would delete the containers, network, and volume of a development
stack started from the same `docker-compose.yml`.

`E2E_SKIP_COMPOSE` and `E2E_KEEP_STACK` are debugging aids only. They are never
set in CI and fail safely: simulator scenarios expect `201 created`, so a run
against a populated database fails visibly.

## Structure

| Path | Contents |
| --- | --- |
| `playwright.config.ts` | One project: Chromium, 1920 × 1080, one worker, `retries: 0` |
| `src/config.ts` | Ports, Compose project name, project and run IDs |
| `src/compose.ts` | Lifecycle of the system under test |
| `src/globalSetup.ts` / `src/globalTeardown.ts` | `down -v` → `up --build` → `/readyz`, then cleanup |
| `src/simulator.ts` | Starts the simulator and reads its `--json` summary |
| `src/sse.ts` | Raw SSE reader that owns the socket so disconnection can be forced |
| `src/liveObserver.ts` | Injected before application startup to record live states |
| `src/controls.ts` | Visibility and occlusion checks using `elementFromPoint` |
| `src/layout.ts` | Page overflow and clipped text as a function of viewport width |
| `src/pseudoLocale.ts` | Expands every cockpit-owned text in the browser by 35% |
| `tests/` | Test files numbered in execution order; the initial twelve and later MCP additions are described below |

## The initial twelve test files

| File | Checks |
| --- | --- |
| `01-ingestion.spec.ts` | Event validation, idempotency, and observable projections |
| `02-live-updates.spec.ts` | Live SSE updates for planned, active, applied, and removed states |
| `03-architecture.spec.ts` | Complete architecture canvas with hierarchy and typed relationships |
| `04-run-agents.spec.ts` | Run/agent tree with parallel subagents and distinct progress forms |
| `05-inspector.spec.ts` | Component click: agent, task, Markdown feedback, grouped diffs |
| `06-run-history-focus.spec.ts` | Current run/history separation and basic deep-focus behavior |
| `07-sse-replay.spec.ts` | Forced SSE disconnect and gapless, ordered replay |
| `08-viewport.spec.ts` | No horizontal page scrollbar or obscured primary controls |
| `09-i18n-layout.spec.ts` | German, English, and pseudo-locale layouts at widths of 1920, 1440, and 1280 |
| `10-architecture-focus.spec.ts` | Architecture focus, exact pane restoration, and overlay geometry in German and English |
| `11-canvas-hit-areas.spec.ts` | Screen-space hit areas at multiple zoom levels with fine/coarse pointers |
| `12-spatial-keyboard-navigation.spec.ts` | Complete arrow-only keyboard traversal, panning without zoom, and focus fallback |

`01`–`08` are the mandatory v0 epic (#14) checks and retain the same assertions,
1920 × 1080 viewport, and language. `09` comes from the i18n epic (#37), runs
afterward, and adds three axes: two more widths, the second language, and an
artificial third locale with text expanded by 35%. All selectors in `09` are
language-independent. A checklist using German `aria-label` values would find
nothing in an English run and report "nothing clipped" for a screen it never
actually inspected.

### Screenshots are evidence, not a baseline

`09` attaches nine screenshots to the report (three widths × German, English,
pseudo-locale). **Nothing** is compared against a checked-in image.
`toHaveScreenshot()` compares rendered pixels, which depend on font rendering
and subpixel positioning: a baseline captured in a Linux container differs
from the same build on Windows even when the text is entirely correct.
Instead, the test measures what the issue actually requires: no clipped pane
titles, buttons, legends, or status values. It compares `scrollWidth` with
`clientWidth` when `overflow` hides the remaining content. The rationale is in
[ADR 0022](../docs/decisions/0022-translation-test-suite-pseudo-locale-and-a-suite-that-can-be-believed.md).

`02-live-updates.spec.ts` sends the representative sequence and is the only file
allowed to do so: the `full` scenario expects an empty project. Subsequent files
read the state it leaves behind, hence one worker, no parallelism, and numbered
filenames.

## Determinism

`retries: 0`. A gate that turns green on its second attempt reports "flaky" as
"passed".

There are no fixed sleeps for synchronization. The tests wait using Playwright
expectations, `expect.poll`, or a value published by the system itself: the
simulator's `--json` summary, a `data-*` attribute, or the connection badge.
The simulator is seeded, so assertions use exact counts: 17 components,
11 relationships, three relationships on `orders.order.created`, and three
files under one `changeId`.

## CI

`.github/workflows/e2e.yml` runs the same suite on an Ubuntu runner with
`FRONTEND_HTTP_PORT=8080` and uploads the Playwright report as an artifact.
The fast suites run separately in `.github/workflows/ci.yml`.

## MCP live Canvas acceptance (#80)

`tests/15-mcp-live-canvas.spec.ts` drives the published `/mcp` endpoint using the
official `@modelcontextprotocol/sdk`, pinned to 1.30.0, while Chromium operates
the real UI. It creates an isolated project and checks atomic node/edge changes,
direct applied state, overlapping scopes, selection/focus and camera retention,
exact retries, browser offline/replay, reload hydration, selected removal and
history fallback. It adds to the REST/simulator suite.

Run it with `npx playwright test 15-mcp-live-canvas.spec.ts`. The normal global
setup builds Compose and uses `E2E_COMPOSE_PROJECT` and `FRONTEND_HTTP_PORT` for
isolation. `E2E_KEEP_STACK=1` retains the stack for inspection. Successful runs
also retain screenshots of overlapping scopes and selected removal under their
Playwright test output directory. `E2E_SKIP_COMPOSE=1` is only for a deliberately
prepared stack, never evidence that a fresh full acceptance deployment passed.

## Native MCP images (#81)

`tests/16-native-render.spec.ts` uses the production native render entry and
the official MCP client. It checks empty views, valid self relationships,
partially clipped unfolded bundles, one actual PNG at the requested pixel
dimensions, model/view revision conflicts and structured domain errors. The
first MCP image is requested with no user page; a later request preserves an
open user's camera and selection. The flow reads, renders, corrects one known
component label and renders again, then explicitly finishes the run.

Successful outputs retain the before/after PNGs, native regression screenshots
and a measurement attachment with sample count, model size, viewport/detail and
execution conditions. Run with `npx playwright test 16-native-render.spec.ts`;
the default full suite includes it automatically.

## Native architecture view acceptance (#82)

`tests/16-native-views.spec.ts` creates an isolated project through the official
MCP SDK and operates two saved views in Chromium against freshly built
Compose/Nginx. It checks shared native identities, original history event IDs,
work evidence, independent cameras/orientations and remembered selection,
shared live renames, a live empty-scope roundtrip, boundary diagnostics, removal,
and opaque view IDs through browser selection, deep links, query reads and reload.

Run `npx playwright test 16-native-views.spec.ts` with the same isolated Compose
settings described above. Successful runs retain `native-detail-view.png` and
`native-complete-view.png` in the test output directory. Local camera state is
session-only; reload assertions cover the URL view/selection and saved defaults.

## Complete MCP recovery acceptance (#83)

`tests/17-mcp-command-recovery.spec.ts` adds two independently initialized SDK
clients racing one model CAS, followed by explicit reread/reconciliation. Its
lost-response transport override sends the real request through Nginx, consumes
and discards the committed response bytes, then throws before the SDK sees them.
An independent model read and published SSE event establish the original commit.
A newly initialized client retries the identical full command/key and must
recover the original server event ID, timestamp, ownership, revisions and affected
IDs. Retrying again after explicit run closure preserves that same receipt.

A rejected node-plus-invalid-edge batch is checked against the model/head and
single ordered SSE publication stream, plus a native browser status barrier and
active DOM observer: no partial node can be drawn. The test registers a root and
two workers, reports overlapping scope, status, progress and owned step completion,
then closes the run explicitly. Observed new event types must exactly cover the
generated command catalogue. Together with the simulator's closed legacy catalogue,
the mandatory suite covers both generations of events.

Test 15 now records Chromium's actual EventSource frames using CDP. Offline
emulation alone does not reliably close an established stream; `Page.stopLoading`
explicitly aborts the browser request while offline. A missed committed mutation
must be absent before reconnect, replayed once afterward and followed by another
live mutation. Both streams must return 200 and received positions must be gapless
from the initial hydration snapshot through the continued live event.

The documented client is also executed by the mandatory suite:

```bash
npm --prefix e2e ci
MCP_URL=http://localhost:8080/mcp node e2e/examples/native-feedback.mjs
```

`MCP_OUTPUT_DIR` optionally selects its output directory. By default the example
writes PNGs and matching JSON metadata under `e2e/test-results/client-example/`.
The process creates a unique project/run, renders without a user page, corrects
one model label, renders again and explicitly closes the run. This demonstrates
model feedback, not automated quality judgment or a repository code change.

The existing full `npm test` gate includes all MCP, native render and saved-view
tests. Successful PNGs and client outputs are uploaded with `test-results` on every CI
run; failure traces/videos remain included. Raw measurement attachments are
retained in the separately uploaded HTML report. This canonical local run also
exports named JSON files under `test-results/acceptance-evidence`. Timings use `performance.now`:
render roundtrip samples and distinct mutation-to-observed-canvas scenarios carry
raw values, sample count, median/range, model/viewport/detail, SDK/browser/font,
OS/Docker and fresh-versus-reused-stack conditions. These are local observations,
not an SLA or a repeated identical-write benchmark.

Run a complete isolated source-build acceptance with a disposable project/port:

```bash
E2E_COMPOSE_PROJECT=vai-epic75-i83 FRONTEND_HTTP_PORT=18183 E2E_KEEP_STACK=1 npm --prefix e2e test
```

Leave `E2E_SKIP_COMPOSE` unset for final acceptance. This deletes only the selected
acceptance project's volume, builds the current source and starts fresh. Never
select a user's existing deployment project. See
[the acceptance evidence and limits](../docs/epic-75-acceptance.md).

## Text contrast acceptance (#112)

`tests/20-text-contrast.spec.ts` checks the rendered text colors with axe-core in
Chromium. Transparent diff cells that axe cannot resolve are checked using the
browser's computed colors and background composition; unsupported paint or
occlusion fails the check. It seeds its own finished run and newer run, then measures zero-state
counters, historical context and diff captions, metadata, code and line numbers
in German and English. Each sampled diff row is scrolled into view; both ends of
each line kind are covered. Missing or indeterminate measurements fail the test.
The report includes measured color pairs and screenshots. These checks target
the reported text contrast issues; they are not a complete accessibility audit.
