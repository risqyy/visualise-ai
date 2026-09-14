# 29. Project model, saved views and MCP commands

Current implementation status: the integrated source-built Compose deployment
implements all 14 tools, including native views and PNG feedback. This ADR
retains its original decision/delivery context; see [current usage](../mcp-domain-tools.md)
and [local acceptance](../epic-75-acceptance.md) for present capabilities and evidence.

- **Status:** accepted implementation contract; runtime delivery belongs to #77–#83
- **Date:** 2026-09-14
- **Issue:** #76, epic #75
- **Builds on:** [0002](0002-event-log-with-synchronous-projections.md),
  [0004](0004-contract-driven-ingestion-validation.md),
  [0005](0005-read-api-shape-and-run-scoping.md),
  [0008](0008-architecture-canvas-layout-and-edge-bundling.md),
  [0009](0009-generated-frontend-contract-types.md)

## Decision

The native architecture model and interactive canvas remain the product. An
agent may read and directly mutate that model through MCP. A successful command
is applied immediately; there is no approval or proposal-to-apply workflow.
Explicit work reports remain separate from these mutations. Neither proves that
repository files changed. Existing `diff.reported` is reported evidence, not a
server verification of repository contents.

The normative behavioral specification is [the contract guide](../model-view-mcp-contract.md).
The prospective **2.0.0** structural authority is
[`api/model-view-mcp.schema.yaml`](../../api/model-view-mcp.schema.yaml), with a
tool catalogue in [`api/model-view-mcp.tools.yaml`](../../api/model-view-mcp.tools.yaml).
These files specify future operations; they do not register tools or routes in
the current server. Existing REST payload `schemaVersion: "1.0"` and OpenAPI
document version `1.1.0` remain unchanged in #76.

| State | Identity and lifetime | Writes |
| --- | --- | --- |
| Project model | Project + stable component/relationship ID, across runs and views | Atomic model commands and compatible existing architecture events |
| Saved view | Project + view ID; references model IDs, never owns copies | Explicit view commands with their own revision |
| Run / agent | Project + run; agent within run | Explicit lifecycle and reporting events |
| Current work scope | Project + run + agent | Explicit scope report, including explicit empty scope to clear |
| Local presentation | Browser/user + view | Selection, camera, temporary positions, disclosure; no domain write |

Every project has `modelRevision`, initially zero. A committed command affecting
the model advances it once. `projectPosition` remains the append-log/SSE cursor
and advances for every event, including model-neutral work and view events.
These counters are intentionally not interchangeable. A view has independent
`viewRevision`; changing its filter must not invalidate a model CAS token.

Model mutations contain bounded, typed add/update/remove operations. They commit
as one event and one transaction, using the existing project row as serialization
point. Idempotency is checked before lifecycle and expected-revision checks.
Reference validation sees the final candidate graph, allowing coordinated
creation and removal without transient dangling edges. There is no implicit
cascade deletion. Publish SSE only after commit.

MCP is an adapter over the same command/read services used by REST, not a second
store. A connection does not start a run, and disconnecting does not finish one.
Saved views and AI rendering use the native frontend graph projection and layout.
Rendering returns revision metadata for the exact snapshot it rendered.

## Source of truth and implementation boundaries

Shared legacy descriptors are referenced from `api/openapi.yaml`; they are not
restated in the prospective schema. #77 must add generated OpenAPI 3.1 components
and event branches from this schema, then use the existing backend contract-copy
and frontend type-generation checks. #78–#79 must derive MCP input/output schemas
from the same bundled definitions and this tool catalogue. A generation/check
command must fail on drift; no independent hand-maintained MCP/Go/TypeScript
shape copies are permitted. Go implementation structs may be generated or
validated against generated schema fixtures, as existing projection structs are,
but they are not a new contract authority. The #76 validator resolves all shared
references and validates every prospective tool request/result and negative
fixture. It does not claim runtime semantics have been implemented.

Contract 2.0.0 is distinct from the MCP protocol version and SDK version. #78
must pin the official Go SDK and document its actual supported protocol versions,
transport, initialization and proxy behavior. Protocol negotiation does not alter
domain revisions or event schema versions. Feature advertisement must reflect
implemented capabilities, not every operation proposed here.

## Compatibility and trade-offs

Legacy `architecture.snapshot_published` replaces the complete graph; legacy
`*.change_applied` uses full descriptors. They remain legal inputs and retain
their established idempotency comparison (payload + event type + schema version).
They have no expected revision and therefore cannot promise lost-update protection.
After #77, every accepted legacy model write, including a model-affecting
correction/retraction, participates in the same model revision and transaction
rules. New commands use stronger full-request replay identity.

Existing historical events are immutable. Migration initializes model revisions
and detects dangling relationships, missing parents and hierarchy cycles; it
does not rewrite history or silently delete data. The contract guide describes
read diagnostics, repair and stricter future-write checks. These are real behavior
changes from current storage, not already-existing guarantees.

Keeping one project-wide revision makes concurrency explicit and easy to audit,
at the cost of conflicts between unrelated edits. Clients reread and reconcile;
they never silently retry a stale patch against a newer head. Separate view
revisions and model-neutral work reports avoid unnecessary model conflicts.

Native architecture views are in scope. The diagram coverage matrix in the guide
records additional families with priority **OPEN**. PlantUML rendering and full
UML parity remain outside this epic.
