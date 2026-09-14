# Epic #75 local acceptance

The integrated source checkout implements the model, work, saved-view and native
PNG flow. This record preserves local acceptance evidence collected on 2026-09-14
before publication. Subsequent publication and remote CI results are tracked
separately; the measurements below describe the original local run.

## Environment and completed gates

The final full browser run used fresh source-built Compose project
`vai-epic75-i83`, published Nginx port **18183**, and an empty isolated PostgreSQL
fixture. Chromium ran at **1920 × 1080**, one worker, **zero retries**, with all
**44/44 tests passing** in **2.4 minutes**; deployment readiness took **27.7 s**.
The existing REST/simulator tests and the new MCP tests ran in the same mandatory
suite. Artifacts are retained in `e2e/playwright-report/` and `e2e/test-results/`
(ignored outputs, not checked-in generated evidence). An independent repeat of
all eight new MCP/browser cases passed in **17.3 s** against that retained built
stack; it supplements the fresh full run and does not replace its report.

| Gate | Completed local result |
| --- | --- |
| API contract | `npm test` passed, including generated REST/MCP drift, examples and negative fixtures |
| Backend | All packages passed with actual PostgreSQL via `go test -count=1 -p 1 ./...`; build and vet passed |
| Frontend | 57 files / 549 tests passed; typecheck, lint, generated contract, 438-key locale parity, UI-string checks and production build passed |
| Simulator | 110 tests, typecheck and lint passed; all 20 legacy types remain covered independently of the six new command types |
| Published Compose / official SDK / Chromium | Full fresh 44-test suite passed, including the executable client below |
| Remote CI / released images | Outside this local-run record; consult the relevant PR checks and release records for subsequent publication results |

Go MCP SDK **1.7.0** and TypeScript SDK **1.30.0** use stateful Streamable HTTP
through `/mcp`, negotiating **2025-11-25**. Domain inputs use **2.0.0**. The
checked executable is `e2e/examples/native-feedback.mjs`; the mandatory browser
suite invokes that exact standalone program against the published endpoint.
See [client setup and invocation](mcp-domain-tools.md#executable-client).

## Observable acceptance

| Scenario | Evidence exercised |
| --- | --- |
| Fresh workflow | Official initialize/tools discovery, 14 schemas, explicit root/subagent context, read → atomic node/edge batch → saved view → native PNG |
| Atomicity and rollback | Browser model never exposes an accepted edge without endpoints; invalid reference batch leaves counters, event history and published state unchanged |
| Lost response and retry | The server commits, the client fetch override consumes/discards the response, a new SDK connection retries the identical complete input/key, and receives the original receipt with `duplicate: true` |
| Concurrent CAS | Two initialized clients use the same revision; exactly one succeeds, the other gets the current revision and reconciles with a new command key |
| Explicit work | Overlapping reported scopes/steps retain distinct agent contributions; status/progress/terminal guards remain explicit |
| Live browser state | Selection, focus, camera and model inventory remain coherent across updates; deletion retains accessible history/fallback |
| Actual browser reconnect | CDP stops the loaded page's connection while offline; an event sent in the gap is replayed after a second successful stream response, followed by continued live traffic and gapless project positions |
| Shared native views | Two selections share IDs, rename, Inspector/history and work evidence; camera/orientation/selection restore per view; live empty → nonempty scope preserves camera |
| Opaque IDs | Slash, dot/dot-dot, spaces, percent signs, Unicode and mixed punctuation round-trip through browser deep links, reload and the fixed query getter |
| Exact PNG feedback | Saved model/view revisions match metadata and decoded PNG; stale revisions fail; detached capture survives later writes; no active user session is required |
| Render bounds | Empty, hierarchy, explicit boundary, clipping, bundles/detail, actual painted IDs, invalid viewport/view, overload, timeout/cancellation and output limits have native-browser or backend regressions |
| Correction example | The standalone SDK program writes `before.png`, changes one existing label with CAS, writes `after.png` at the new model revision, and explicitly closes its run |

Database tests additionally cover migration, reserved IDs/tombstones, independent
model/view counters, retry after closure, transaction rollback and a barrier that
proves capture reads model/view/counters in one repeatable-read snapshot. Native
backend/frontend resolution uses shared fixtures for missing references, ancestor
boundaries and cycles. These checks supplement, rather than replace, the real
published-proxy browser flow.

## Measured timings

The canonical report retains the raw attachments; extracted copies are under
`e2e/test-results/acceptance-evidence/`. Both measurements use monotonic
`performance.now()`, a two-component/one-relationship model, one Playwright
worker and no externally injected load.

| Measurement | Raw samples (ms, rounded to 4 decimals) | Median (ms) | Range (ms) |
| --- | --- | --- | --- |
| Successful MCP PNG call roundtrip | 936.5736, 865.7180, 860.5769 | 865.7180 | 860.5769–936.5736 |
| SDK mutation dispatch to observed native `aria-label`, including network/polling | 40.3504, 36.8816, 29.4438 | 36.8816 | 29.4438–40.3504 |

Each row has **three samples**. Render uses an 800 × 600 CSS-pixel viewport,
pixel ratio 2 and `standard` detail; every request starts a fresh nonroot
Chromium. The mutation samples are, in order, the lost-response path including
an independent read, the two-client CAS race, and the reconciled mutation. They
are **different scenarios**, not repeated identical writes. The browser viewport
is 1920 × 1080 with the native automatic readable camera. This interval starts
at SDK dispatch, not server acceptance; it must not be reported as pure render,
database or post-commit latency.

Conditions captured in both JSON attachments: Windows `win32 10.0.26200 x64`,
Node **24.14.0**, Docker **27.5.1**, Compose **2.32.4-desktop.1**, Playwright
Chromium **151.0.7922.34**, backend Chromium **152.0.7977.82** on **Alpine 3.24**,
font **NotoSans-Regular.ttf**, Go MCP SDK **1.7.0**, TypeScript MCP SDK **1.30.0**.
The production frontend image builds with Node 22; the Node value above is the
host acceptance runner. CPU/memory allocation and background host load were not
controlled, so these small samples are observations, not a performance target.

`native-render-measurements.json` and `mutation-to-observed-canvas.json` retain
unrounded values, labels and conditions. `browser-sse-replay.json` records two
HTTP 200 stream responses, initial snapshot position **3**, cut **7**, missed
position **8**, continued-live position **9**, and observed positions
**[4, 5, 6, 7, 8, 9]**. `command-recovery-evidence.json` records one deliberately
discarded **921-byte** response, recovery of the original event at model revision
**2** / project position **3**, and exactly one successful concurrent CAS write
at revision **3** with a matching `revision_conflict` for the other client.
`documented-client-result.json` retains the executable example's before/after
image metadata at model revisions **1 → 2**.

## Scope and limits

These are local functional and timing observations, not production service-level
promises or scale benchmarks. The renderer is native architecture only, with no
UML/PlantUML parity or automatic quality judgment. A model correction does not
prove repository code changed. Work state is explicitly reported; connection
state or elapsed time never manufactures activity.

Views share project identities/history. Local camera and manual geometry are
session-only, while the URL preserves the view and explicit selection/orientation
on reload. The implicit complete overview has no persisted view revision and
must be explicitly saved before rendering. Runtime limits and upgrade/data
preservation rules are documented in [operations](operations.md).
