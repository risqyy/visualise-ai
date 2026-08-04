# 4. Contract-driven ingestion validation and race-free lifecycle rules

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #5 (part of the v0 epic #1)
- **Builds on:** [0002 — Event log with synchronous projections](./0002-event-log-with-synchronous-projections.md)

## Context

`api/openapi.yaml` is the single authority for what an agent may report. If the
Go validation is a hand-written re-statement of that document, the two drift the
moment someone edits one of them — and a contract nobody enforces is a contract
nobody can rely on.

Separately, the lifecycle rules ("this agent was started", "this run is still
open") depend on the current project state. Checking them before opening the
append transaction is racy: two concurrent requests can both read "the run is
open" and both be accepted.

## Decision

**Validate against the specification itself, not a copy of its rules.**
Requests are validated with `pb33f/libopenapi` and `libopenapi-validator`
against the actual contract document.

Two refinements were necessary and are not obvious:

1. **Validate against the concrete branch, not the union.** Validating a body
   against `IngestEventRequest` — a 20-branch `oneOf` — reports the failures of
   all 19 branches the agent never meant. One bad `percent` produced ~80 errors.
   The contract's own `discriminator.mapping` is used to select the single
   envelope schema the `type` field designates, and only that branch is
   validated. The resulting error tree maps cleanly onto `errors[].field` with
   correct RFC 6901 pointers.
2. **Format assertions are off by default** in JSON Schema tooling, which
   silently accepted `"clientEventId": "not-a-uuid"`. They are enabled
   explicitly.

**The contract is committed into the module and guarded, not copied at build
time.** Go's `embed` cannot reach above the module root, and `api/` sits outside
`backend/`. Copying the bundle during the image build would force the Docker
context to the repository root and change `docker-compose.yml`. Instead
`backend/internal/ingest/contract/openapi.yaml` is a committed copy, and a test
asserts it is byte-identical to `api/openapi.yaml`. Editing one without the
other turns the suite red with an instruction on how to fix it. Two further
tests assert that the catalogue in the contract, the catalogue the store
projects and the catalogue the validator accepts are the same set.

These guards were verified to fail, not merely to pass: modifying the authority
document makes the identity test fail; copying the document across without
updating the Go code makes the catalogue tests fail.

**Lifecycle rules run inside the append transaction.** `store.AppendGuarded`
takes a `Guard` that executes after the project row is locked and idempotency is
resolved, and before the event row is written. The guard therefore observes a
state no concurrent append can move underneath it, and returning an error rolls
the whole append back — a rejected event consumes no position and touches no
projection.

**Idempotency is resolved before the lifecycle guard.** A byte-identical retry
of the root `agent.started` must answer `200 duplicate` with the original
position. If the lifecycle check ran first it would see the run it created
itself and answer `422 run_already_started`. An event accepted once keeps its
position even after the project moved on.

**A finished run stays correctable.** After `run.finished`, every event type is
rejected with `422 run_already_finished` except `correction.issued` and
`retraction.issued`. Closing a run must not make its record unfixable.

**Silence is never a signal.** There is no timeout, stall detection or
heuristic anywhere in the ingestion path. A run without a terminal event stays
open and shows its last reported state, exactly as the product boundary requires.

**The publisher is called only after commit.** It receives a `CommittedEvent`
shaped exactly like the contract's `StreamedEvent`, so the SSE work package
needs no second mapping. It is not called for duplicates — those were published
when they were first accepted — and never for rejections, so an uncommitted
event cannot reach a browser.

## Consequences

- Adding an event type is a three-place change (contract, store projector, Go
  validator) and the tests name which place is missing. That is the intended
  friction: the catalogue is meant to be closed.
- Validation costs about 5.7 µs per event once warm, which is irrelevant next to
  the database round trip.
- `libopenapi` raised the module's `go` directive to `1.25.7`. The
  `golang:1.25-alpine` build image satisfies it; the container build is
  unchanged and was verified.
- The contract copy is a generated artefact living in version control. It is
  safe only because the identity test exists — removing that test would remove
  the whole justification for this arrangement.
