# Atomic model command implementation (#77)

The `model.mutation_applied` REST event (`schemaVersion: "2.0"`) and its shared
`ingest.Service.Submit` entry point are implemented. This does not register MCP
transport/tools or the prospective context, work, scope and view commands.
`MV_*` generated schemas describe those later adapters; schema availability is
not a capability advertisement. ADR 0029 remains the behavioral authority.

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
snapshot. Collection pagination and bounded MCP read responses belong to #79.

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

The frontend changes here only keep the expanded contract buildable: event
registration, one architecture/component-cache invalidation per mutation, a
localized history label and revision-bearing fixtures. Scope presentation,
canvas interaction and complete live behavior remain #80.

Validation uses an isolated PostgreSQL container (`vai-epic75-i77-test`, loopback
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
