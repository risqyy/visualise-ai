# 7. Deterministic event simulator as a contract-validating Node client

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #13 (part of the v0 epic #1)
- **Builds on:** [0004 — Contract-driven ingestion validation](./0004-contract-driven-ingestion-validation.md),
  [0005 — Read API shape and run scoping](./0005-read-api-shape-and-run-scoping.md)

## Context

v0 has no repository access and no live agent. Everything the cockpit shows has
to arrive through `POST /api/v1/events`, so without a producer there is nothing
to look at, nothing to demo and nothing for the mandatory Playwright acceptance
run (#14) to assert against.

That producer has to satisfy three things at once: it must be reproducible
enough that an end-to-end test can assert on exact content, rich enough that
every v0 UI state is reachable, and honest enough that it cannot demonstrate
anything the published contract does not allow.

## Decision

**Node and TypeScript, in its own `simulator/` package.** The backend is Go, so
Go would have been the obvious neighbour. It was rejected because the consumer
is the Playwright suite of #14, which is Node: a Node simulator can be imported
and started directly from a test, with no compiled binary and no container in
between. The package carries its own `package.json`, `tsconfig.json` and ESLint
config; it depends on nothing inside `backend/` or `frontend/` and touches
neither.

**Determinism is enforced by the linter, not by discipline.** `Math.random`,
`Date.now` and `crypto.randomUUID` are banned through `no-restricted-properties`
with a message naming the seeded replacement. Client event ids are drawn as
UUIDv4-shaped values from a seeded mulberry32 stream, and `occurredAt` comes
from a virtual clock anchored to the date the contract's examples use. Ids,
pacing and the clock are three *separate* streams, so adding a pause cannot
shift an id and re-timing a phase cannot change an event's identity.

The property this buys is the one the acceptance criteria ask for: a repeated
run against an empty database produces the same events, therefore the same
positions, therefore the same read models. It also makes the idempotency
scenario meaningful — a retry can only be byte-identical if the generator is.

**The simulator validates every event against `api/openapi.yaml` before it sends
it.** Same approach as `api/scripts/validate-examples.mjs`: parse the contract,
register the component schemas under their canonical `$ref` and compile with Ajv
2020 with format assertions on. An event that violates the contract aborts the
process; it never reaches the network.

This is deliberate and not redundant with the server-side validation. It fixes
the meaning of a failure: if the simulator runs, whatever it sent was contract
legal, so a rejection is a statement about the *server*. Without it, a red run
would first have to be triaged into "the simulator invented a field" versus "the
backend is wrong". The union is a 20-branch `oneOf`, so — exactly as ADR 0004
found for the backend — the contract's own `discriminator.mapping` selects the
single branch first and only then the union gates it, otherwise a single bad
field reports the failures of 19 branches nobody meant.

The check is symmetric: every acknowledgement is validated against
`EventAccepted`, and an unexpected status, `duplicate` flag or re-allocated
position aborts the run with the event, the code and the detail printed.

**No bundling step.** `api/openapi.yaml` has no external `$ref`, so the document
is loaded directly instead of depending on `api/dist/openapi.bundled.yaml`, which
is generated and git-ignored. The simulator therefore has no build-order
dependency on the `api/` package. The contract is located by walking up from the
module, so it works from `src/`, from a test runner and from a future build
output alike.

**The run stays open unless `--finish true` is given.** `run.finished` is
optional by contract and no terminal state is derived from silence, which is a
product boundary rather than an implementation detail. Leaving the run open is
the state that demonstrates it: an abandoned run keeps `isOpen: true` and its
last reported values, and the cockpit invents nothing. It is also the more
interesting thing to look at. `--finish true` restores the terminal event, and a
test asserts that `run.finished` is the *only* event type the default run omits.

**The probes report into their own projects.** `full` writes to `visualise-ai`,
`retry` to `visualise-ai-retry` and `conflict` to `visualise-ai-conflict`. Per
ADR 0005 `runs/current` resolves to the run a root orchestrator opened last, so a
probe sent into the demo project afterwards would silently become the current run
and empty every default component inspector. Each id is fixed, so a repeated run
always lands in the same project; `--project` overrides all three.

**The scenario is a document, not a recording of the examples.**
`api/examples/` are standalone illustrations and are not a runnable order: the
lifecycle guard of ADR 0004 rejects any event whose agent never reported
`agent.started`. The sequence is therefore built to satisfy those rules, and
tests assert the preconditions — one root orchestrator, every agent started
before its first other event, every `parentAgentId` and every correction target
already sent — on the generated sequence rather than discovering them as a wall
of `422`s.

## Consequences

- Adding an event type to the contract turns the catalogue test red until the
  scenario reports it. That is the same intended friction ADR 0004 describes for
  the backend: the catalogue is closed and the demonstration of it should be
  complete.
- The scenario is a fixture in code. It is long and it is meant to be — the tests
  that guard it (agent depth, hierarchy depth, all six relationship kinds, two
  NATS topics with a fan-out, four grouped diffs, planned/applied/removed/
  retracted/pending) encode what #14 has to be able to see.
- The simulated data is invented and says so. v0 has no repository access, and
  the contract states that `unifiedDiff` is taken as reported; the diffs are
  plausible Go, not extracted from anything.
- `--speed` is a pause *multiplier*, not a rate: `1` is the normal watchable
  pace, `0` removes every pause for CI, `2` doubles them. A rate would have made
  `0` mean "divide by zero".
- The determinism claim is only true on an empty database. A second run against a
  populated one legitimately answers `200 duplicate` throughout, which is correct
  behaviour but not what the scenarios assert; `docker compose down -v` is part
  of the procedure.
