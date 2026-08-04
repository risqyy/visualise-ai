# 13. The mandatory end-to-end acceptance run: one browser, the real deployment, and guards against a green vacuum

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #14 (part of the v0 epic #1)
- **Builds on:** [0001 — Compose topology and single entry point](./0001-compose-topology-and-single-entry-point.md),
  [0002 — Event log with synchronous projections](./0002-event-log-with-synchronous-projections.md),
  [0004 — Contract-driven ingestion validation](./0004-contract-driven-ingestion-validation.md),
  [0006 — SSE replay and in-process broker](./0006-sse-replay-and-in-process-broker.md),
  [0007 — Deterministic event simulator](./0007-deterministic-event-simulator.md),
  [0008 — Architecture canvas](./0008-architecture-canvas-layout-and-edge-bundling.md),
  [0010 — Live change overlays](./0010-live-change-overlays.md),
  [0011 — Run and agent hierarchy](./0011-run-and-agent-hierarchy.md)

## Context

This is the release gate of the whole v0 epic: if the run in `e2e/` fails, v0 is
not released. That single sentence decides everything below, because a gate has
exactly two ways to be useless — it can fail for reasons that have nothing to do
with the product, and it can pass without having looked at anything.

Every unit and integration suite in this repository already passes. They test
the backend against its own store, the frontend against a mocked fetch and the
simulator against an injected `fetchImpl`. None of them can show that the
contract, the projections, the SSE handover, the Nginx routing and the browser
fit together, because each of them replaces at least one of those with a
stand-in.

## Decision

### Against the built Compose deployment, from an empty database, never against mocks

`globalSetup` runs `docker compose -p vai-e2e down -v`, then
`up --build -d`, then waits for `/readyz` **through Nginx**. `globalTeardown`
runs `down -v` again.

The volume is removed on both ends rather than only at the start. A leftover
`pgdata` would make the next run start from a populated database, and against a
populated database the simulator's first delivery is legitimately a duplicate —
correct behaviour that silently invalidates every idempotency assertion the
`retry` scenario exists to make.

Everything the suite touches goes through the published Nginx port: the browser,
the raw SSE reader and the simulator alike. That is not a convention, it is the
only thing the deployment offers — neither the backend nor PostgreSQL publishes
a host port (ADR 0001) — and it means the acceptance run exercises the SSE
location block, the unbuffered proxying and the SPA fallback as part of every
assertion rather than as a separate concern.

Mocking was rejected outright. A mocked backend would let the test assert that
the frontend agrees with the test's own idea of the read API, which is exactly
the agreement that unit tests already establish and exactly the one that cannot
be broken by a deployment defect.

### Chromium at exactly 1920 × 1080, and no browser matrix

The epic fixes desktop Chromium at 1920 × 1080 as the acceptance surface, and
issue #14 states that Firefox, WebKit, mobile and tablet are not mandatory. They
are therefore **not configured**, not configured-and-skipped.

The resolution is a property of the product, not of the test: the default pane
split (`DEFAULT_PANE_LAYOUT`), the deep-focus split
(`DEEP_FOCUS_PANE_LAYOUT`, ~41 % for the canvas), the minimap size and the
horizontal-scrollbar check are all stated in pixels at 1920 × 1080. Asserting
them at another size would assert nothing, and asserting them in a second engine
would either duplicate the same layout arithmetic or start reporting engine
differences as product failures. A gate that reports noise gets ignored, and an
ignored gate is worse than none.

Adding a browser is a decision about what v0 promises, and it belongs in an ADR
rather than in a config array.

### The live states have to be watched live, and the observer lives in the page

Three of the four work states — `aktiv`, `kürzlich angewandt`, `entfernt` — do
not exist in the read API. `activeChanges` is filtered to `state = planned`
server side, a started-and-not-completed work step has no representation there
at all, and a removed component is precisely the one the response no longer
contains (ADR 0010). They are folded from the SSE stream into a client-side
ledger, and a stream opened without a cursor starts at the **live tail**
(ADR 0006). They therefore describe *what this tab watched happen* and start
empty after a reload.

Two consequences shape the test:

**The cockpit is opened before the first reported event.** A stream for a
project that does not exist yet is answered `404`, after which the client backs
off exponentially — it would then race the run and pass or fail by timing. The
suite instead opens the project with a bootstrap run of its own, waits for the
connection badge to read `live`, and only then starts the simulator. Nothing is
observed by luck.

**The observation is recorded inside the page.** Polling the DOM from the test
process samples a moving target: a `planned` proposal becomes `recently_applied`
a second later, an `active` work step completes, and a poll that happens to fire
in between sees neither. `installLiveObserver` is injected with
`addInitScript` and keeps the **maximum** every counter reached and every
distinct overlay mark that was ever rendered, driven by a `MutationObserver`
plus a 50 ms backstop — well below the 150 ms transitions the overlays use, so
nothing that was on screen can slip past unseen. The assertions then read a
recording of the whole run instead of a snapshot of its end.

The simulator runs at `--speed 1` for this, with its pauses intact. `--speed 0`
would compress 62 events into a few hundred milliseconds and turn "observable"
into "technically present in some frame".

Two structural details are asserted rather than colours, because ADR 0010
forbids colour from being the only channel: a *planned* removal carries
`data-work-state="planned"` with the word `entfernen` and a dashed border, while
an *applied* removal carries `data-work-state="removed"` with a dotted one. A
test that compared hues would be proving the opposite of the requirement.

### The reload is the anti-vacuum guard for the live checks

Immediately after the live assertions, the suite reloads the same URL and
asserts that `active`, `recently_applied` and `removed` are back to zero while
`planned` — which the read API does serve — is not.

That is the guard the live half needs. If the earlier assertions could have been
satisfied by data the read API returns, they would still hold after the reload.
They do not, so they can only have come from watching the stream. The reload
test simultaneously documents the trade-off ADR 0010 made, which is why it is
phrased as a property rather than as a known limitation.

### The replay check is guarded, because it is trivially easy to fake

Check 7 — force a disconnect, resume from the last project position, prove that
every position arrives exactly once and in order — is the one assertion in this
suite that passes for the wrong reason by default. The failure mode is concrete
and was observed while writing this: subscribe to a project that has not been
created yet, receive `404`, never receive a frame, cut at position `0`, and
"gapless, ordered, no duplicates" is then trivially true of the empty sequence.
Green, and nothing was tested.

Four guards make that impossible, and none of them is optional:

1. **Both connections answered HTTP 200.** A `404` or a `400` on either half
   fails immediately instead of producing an empty recording.
2. **Both carried real traffic.** The first connection must have delivered at
   least the eight frames it waited for, the second at least one.
3. **The cut lies strictly inside the sequence:** `0 < cut < endPosition`, with
   `endPosition` taken from the simulator's own `--json` summary — the position
   the *server* assigned — rather than from whatever the stream happened to
   deliver.
4. **The union is the complete run.** Not "no duplicates among what arrived",
   but: the two connections together are exactly `1 … endPosition`, each
   position once, ascending within each half, and the seam is exactly `cut` and
   `cut + 1`.

The cut is made while the simulator is still sending, so the resumed connection
has to do both halves of the handover ADR 0006 describes — replay the log, then
continue live — and a further assertion confirms that events were still being
appended after the cut.

The cursor is read **after** the abort completed, never before. A frame arriving
between reading the cursor and closing the socket would otherwise be counted as
received *and* requested again, which would look like a duplicate the server
never produced. That is a defect of the test, not of the system, and the
ordering is what prevents it.

`EventSource` cannot do any of this: it reconnects on its own schedule and does
not report what it received before it dropped. The probe therefore owns the
socket and parses the frames itself, which also lets it assert that the SSE
`id:` and the `position` inside the payload agree on both halves.

### Determinism is a property of the design, not of a retry count

`retries: 0`. A gate that goes green on the second attempt reports "flaky" as
"passed".

Nothing in the suite sleeps for a fixed duration as a synchronisation device.
Waiting is done with Playwright expectations, `expect.poll`, or a poll on a
value the system itself published — the simulator's `--json` summary, a
`data-*` attribute, the connection badge. The simulator is seeded, so the same
events, the same positions and the same read models come out of every run
(ADR 0007), which is what lets the assertions name exact numbers: 17 components,
11 relationships, three `orders.order.created` relationships, three files under
one `changeId`.

One worker, no parallelism, files numbered in the order they must run: the suite
shares one event log, and the `full` scenario is sent exactly once because it
expects an empty project.

### Port and Compose project name are configurable, with defaults that work

`FRONTEND_HTTP_PORT` defaults to **8100** rather than 8080, and the Compose
project name defaults to `vai-e2e`. Both are environment variables.

8080–8083 are commonly taken by other local work, and a release gate that fails
because of a foreign port collision teaches developers to ignore it. The own
Compose project name matters more than the port: without it, `down -v` would
destroy the containers, network and volume of a development stack started from
the same `docker-compose.yml`. CI sets `FRONTEND_HTTP_PORT=8080` because its
runner is empty, which also keeps the 8080 path exercised.

### Where the suite reports what it found rather than asserting around it

Two observations from writing the checks are recorded here because they change
what a reader should expect the test to prove:

**No folded relationship bundle exists in the representative model.** ADR 0008
bundles parallel relationships by *ordered node pair*. The three
`orders.order.created` relationships of the `full` scenario connect three
different pairs — `orders → topic`, `topic → inventory`, `topic → notifications`
— so each is already its own edge, and there is no collapsed bundle to click
open. The acceptance property behind the bundling rule is nevertheless asserted
directly and from both ends: the read API must return all eleven relationships
separately (the server never aggregates topics, ADR 0005), and the canvas must
expose each of them with its own label carrying its own `channel`, with the
number of folded bundles asserted to be zero at the `full` detail level. If a
future model does contain parallel relationships on one pair, that assertion
turns into a failure and the unfold path gets tested rather than silently
skipped.

**A task-list checkbox is rendered in feedback.** `remark-gfm` turns `- [x]`
into an `<input type="checkbox">`, which the sanitiser keeps but forces to
`disabled` (ADR 0012). The "no active element" check is therefore defined as
*nothing focusable, nothing that executes or loads, no inline handler* — a
disabled checkbox is none of the three — rather than as "no `<input>` tag". The
distinction is asserted the way a user would experience it.

## Consequences

- The gate needs Docker, roughly two minutes of build on a cold cache and about
  a minute and a half of run time. It is not a pre-commit check; the fast suites
  (`backend go test`, `frontend npm test`, `api npm test`, `simulator npm test`)
  keep that job and run as separate CI jobs.
- The suite writes into the same project the simulator's `full` scenario uses,
  and it opens one extra bootstrap run there. Anyone reading the acceptance
  database will see two runs in `visualise-ai`, of which one is empty. That is
  deliberate and it doubles as the historical run check 6 switches to.
- The assertions name exact counts. A change to the simulator's model — one more
  component, one more relationship — fails the acceptance run. That is the
  intended coupling: the representative sequence and the acceptance criteria are
  one artefact, and `frontend/src/test/runFixtures.ts` already mirrors the same
  data for the unit tests (ADR 0011).
- `E2E_SKIP_COMPOSE=1` and `E2E_KEEP_STACK=1` exist for debugging a failure. They
  are never set in CI, and skipping the reset fails safe: the simulator asserts
  `201 created`, so a non-empty database aborts the run loudly.
- The suite is the only consumer of the simulator's `--json` output. Changing
  the shape of that summary breaks the release gate, which is the correct
  coupling for a machine-readable interface that exists for exactly this.
