# Atomic model command implementation (#77)

The `model.mutation_applied` REST event (`schemaVersion: "2.0"`) and its shared
`ingest.Service.Submit` entry point are implemented. The integrated source also exposes MCP, context/work/scope commands, saved
views and native rendering. [Current workflow](mcp-domain-tools.md) describes
available capabilities. ADR 0029 remains the behavioral authority; this document
records the model transaction and migration implementation.

The store serializes new commands with legacy events on the project row. It
checks full command replay identity before lifecycle and CAS, then applies the
whole batch and validates the final graph. The event, model revision, project
position, component history, identity reservations and original receipt commit
together. Both REST and `Service.Submit` publish only after that commit; retries
publish nothing. Relationship edits link old and new endpoint component history,
while receipt `affected` IDs remain the explicit typed mutation targets.

`Store.ReadModel` returns native descriptors, bounded integrity diagnostics and
both counters from one repeatable-read transaction. The existing architecture
read also returns `modelRevision` and reads its head, graph and proposals in one
snapshot. MCP collection pagination and response bounds share this consistent boundary.

Migration preserves the current projection and log. Each existing project starts
at revision zero with its activation position recorded. It reserves currently
live and historically materialized component/relationship identities, including
one-level effective corrections; planned-only identities remain available. It
records ambiguous historical reuse and exposes current missing references and
cycles without silently repairing them. Migration and append share activation
under the project row lock so startup cannot reset an accepted revision.

Legacy snapshots and applied changes remain unconditional writes and advance
model revision once. They now must leave a valid final graph and cannot revive
retired identities. Existing invalid graphs remain readable; repair uses an
explicit batch or valid replacement snapshot. Corrections retain the original
20 legacy corrected-event types and validate the effective descriptor and
lifecycle before projection. Post-run corrections remain supported. Retractions
change evidence/proposals only and do not advance model revision.

The integrated frontend applies model batches atomically and shares work
evidence, history and identities across saved views. View writes use the same
append lock with independent CAS/revision, durable tombstones and one post-commit
event. They never advance model revision.

The original #77 validation used an isolated PostgreSQL container (`vai-epic75-i77-test`, loopback
port 55477, database `issue77`, no shared volumes):

```powershell
$env:TEST_DATABASE_URL='postgres://test:test@127.0.0.1:55477/issue77?sslmode=disable'
# backend/
go test -count=1 -p 1 ./...
go build -p 1 ./...
go vet -p 1 ./...
# api/
npm test
# frontend/
npm run typecheck
npm run check:contract
npm test
```

Contract generation: `npm --prefix api run generate:model-contract` followed by
`npm --prefix frontend run generate:contract`. The API test command rejects
generated-schema/embedded-copy drift. Frozen source schemas are not edited.

For upgrades retain the PostgreSQL volume. Repeatable startup migration never
clears accepted history, resets activated revisions or unreserves retired IDs.
Legacy invalid data stays diagnosable; migration does not repair it or invent
historical revisions. Work-step associations are reconstructed from attributable
accepted history; unattributable links remain preserved. See
[operations](operations.md) and [acceptance](epic-75-acceptance.md).
