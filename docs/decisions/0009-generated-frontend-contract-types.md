# 9. Frontend read-model types are generated from the contract, not written by hand

- **Status:** accepted
- **Date:** 2026-08-04
- **Context:** contract correction inside the v0 epic #1; unblocks #10, #11, #12
- **Builds on:** [0004 — Contract-driven ingestion validation](./0004-contract-driven-ingestion-validation.md),
  [0005 — Read API shape and run scoping](./0005-read-api-shape-and-run-scoping.md)

## Context

`frontend/src/api/types.ts` used to state, in its own header, that the types
were "derived by hand from `api/openapi.yaml`" and that there was "deliberately
no code generation step". That was an honest description of how the file was
written — and it was wrong within one work package.

The frontend shell (#7) and the read API (#8) were built in parallel against the
same issue text rather than against the finished document. The hand-written
read models therefore described the read API somebody *expected*, and nothing
ever compared the two. TypeScript could not notice: nothing in the frontend ever
saw a real response at compile time. The drift only surfaced when the canvas
(#9) started reading fields.

What had actually diverged:

| hand-written | `api/openapi.yaml` |
| --- | --- |
| `ActiveChange.target`, `componentId`, `relationshipId` | `targetKind`, `targetId` |
| `ActiveChange.reportedAt` | `plannedAt`, `appliedAt`, `retractedAt` |
| `ActiveChange.state: planned \| applied` | `planned \| applied \| retracted` |
| — missing — | `ActiveChange.snapshot`, the reported descriptor verbatim |
| `Component`, `Relationship` as read models | `AppliedComponent`, `AppliedRelationship`, with provenance |
| `Agent` (`capabilities`, `summary`, `statusReportedAt`) | `RunAgent` (none of those; `finishedOutcome`) |
| `ProjectSummary.name`, `runCount` | neither exists; `firstSeenAt`, `lastPosition`, `counts` do |
| `RunSummary.agentCount`, `projectId`, `lastEventAt` | `rootAgentId`, `isOpen`, `isCurrent`, `position` |
| `Plan`, `WorkStep`, `Feedback`, `Diff`, `Risk`, `HistoryEntry` | `RunPlan`, `InspectorWorkStep`, `FeedbackEntry`, `ReportedDiff`, `ReportedRisk`, `ComponentHistoryEntry` |

Three of these were not merely different names: `ProjectsPage`, `WorkspaceHeader`
and `RunAgentPane` rendered `project.name`, `project.runCount` and
`run.agentCount` — fields the API has never sent. They displayed `undefined`
against a real backend.

## Decision

**The contract generates the types.** `openapi-typescript` turns
`api/openapi.yaml` into `frontend/src/api/generated/contract.ts`, and
`frontend/src/api/types.ts` no longer describes a single shape: every export is
an alias into that module. The aliases still exist so application code writes
`ActiveChange` rather than `components['schemas']['ActiveChange']`, and so a
renamed schema fails to compile in exactly one file.

**The contract's names win, always.** Where a frontend name and a contract name
disagreed, the frontend name was retired and the call sites were changed —
never the other way round, and never by adding a field to the contract to keep
frontend code alive. Where a rendered field did not exist at all, the rendering
was corrected: the project list and the workspace header now show the project
slug, because the contract carries no display name for a project and the cockpit
does not invent one; the run list shows `rootAgentId`, because `RunSummary` has
no agent count (only `RunDetail.counts` does, on a different endpoint).

**The generated file is committed.** The frontend image builds with
`frontend/` as its Docker context, so `../api` does not exist during
`npm ci && npm run build`. This is the same constraint, and the same resolution,
as the embedded contract copy in the backend (ADR 0004): commit the artefact,
and guard it.

**The guard is a test, and it was verified to fail.**
`src/api/contractDrift.test.ts` runs `scripts/generate-contract.mjs --check`,
which regenerates in memory and compares byte for byte, and separately asserts
that the sha256 recorded in the generated header is the sha256 of
`api/openapi.yaml` as it is on disk. Both failure modes were reproduced before
this was accepted: adding a property to `ActiveChange` in the contract turned
both assertions red, and editing one line of the generated file turned the
byte comparison red. A guard that has only ever been green proves nothing.

**Empty objects generate as `unknown`, not `Record<string, never>`.** The
contract types `ActiveChange.snapshot` and every event `payload` as a free-form
object on purpose — they carry what the agent reported, unchanged. The
generator's default would claim the opposite (an object that can never have a
property), which makes every narrowing of them `never`. `changeSnapshot()` in
`types.ts` narrows a snapshot by the contract's own `targetKind` discriminator
instead, and is the only hand-written line of logic left in that file.

**One list stays hand-written: `EVENT_TYPES`.** The SSE client needs the
catalogue at runtime — the server sets `event:` to the event type, so a
`message` listener never fires and every type must be subscribed individually —
and types are erased at runtime. It is declared
`satisfies readonly EventType[]` and paired with a type-level exhaustiveness
check, so a type added to the contract and not to the list fails `tsc`.

**The generated types were checked against a running system, not just the
spec.** The full stack was started, the simulator replayed its 62-event
scenario, and every read response was validated with Ajv against the schema it
claims to satisfy — `/projects`, `/projects/{id}`, `/architecture`, `/runs`,
`/runs/current`, `/runs/{id}`, `/agents`, `/plans`, and the inspector plus
history of all 17 components of the applied model. 42 responses, all valid. The
spec and the implementation agree; only the frontend had been out of step.

## Consequences

- Changing the contract is now a two-step change for the frontend:
  `npm run generate:contract`, then commit the result. The test names the
  command when it is missed.
- `src/api/generated/` is excluded from ESLint. It is not excluded from
  `tsc` — the generated module compiles under the project's full strictness
  (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), which is worth
  more than the noise it would otherwise cause.
- Test fixtures now build read models through `appliedComponent` /
  `appliedRelationship`, so a fixture cannot describe a response the API does
  not serve. That is why the canvas fixtures grew provenance fields.
- `graphProjection` no longer treats an empty string as "not reported" for
  `parentComponentId`. The contract types it `ComponentId | null` with
  `minLength: 1`, so the empty-string branch was guarding against a value the
  API cannot produce.
- `resolveWorkState` gained an explicit `retracted` branch. A withdrawn proposal
  now contributes nothing to the overlay instead of falling through an
  unconsidered path — it is neither planned nor applied, and a fifth colour for
  work no longer claimed would mislead the reviewer.
- The generated file is ~2 600 lines of version-controlled artefact. It is only
  defensible while the drift test exists; deleting that test removes the entire
  justification for committing it.
