/**
 * Domain and read-model types of the cockpit.
 *
 * **Nothing in this file describes a shape.** Every type below is an alias for a
 * schema of `api/openapi.yaml`, resolved through the generated module
 * `./generated/contract.ts`. The contract is the authority; when a name here
 * differs from a name there, this file is wrong.
 *
 * This indirection exists so the rest of the app writes `ActiveChange` instead
 * of `components['schemas']['ActiveChange']`, and so a renamed schema shows up
 * as a compile error in exactly one place.
 *
 * Why the aliases are not hand-written any more: they were, and they drifted.
 * `ActiveChange` alone had a `target`/`componentId`/`relationshipId` triple the
 * contract never had (`targetKind`/`targetId`), lacked `snapshot`, and was
 * missing the `retracted` state. See
 * `docs/decisions/0009-generated-frontend-contract-types.md`.
 *
 * Two vocabularies live in the contract and must not be confused:
 *
 * * **Event descriptors** — `Component`, `Relationship`, `PlanStep`, every
 *   `*Payload`: what an agent reports.
 * * **Read models** — `AppliedComponent`, `AppliedRelationship`, `RunAgent`,
 *   `RunPlan`, `ActiveChange`, …: what the read API projects out of the log.
 *   They carry provenance (`appliedAt`, `appliedByAgentId`, `position`) that an
 *   event descriptor does not have, and they report "nothing was reported" as an
 *   empty string or `null` rather than by omitting the field.
 */

import type { components } from './generated/contract'

type Schemas = components['schemas']

// ---------------------------------------------------------------------------
// Primitive identifiers (contract)
// ---------------------------------------------------------------------------

/** Stable project slug, e.g. `visualise-ai`. */
export type ProjectId = Schemas['ProjectId']
/** Identifier of one agent run inside a project. */
export type RunId = Schemas['RunId']
/** Identifier of a reporting agent, unique within a run. */
export type AgentId = Schemas['AgentId']
/** Identifier of an architecture component, stable across snapshots. */
export type ComponentId = Schemas['ComponentId']
/** Opaque agent-assigned identifier (plan, work step, feedback, diff, risk, …). */
export type Identifier = Schemas['Identifier']
/** RFC 4122 UUID. */
export type Uuid = Schemas['Uuid']
/** RFC 3339 timestamp, UTC. */
export type Timestamp = Schemas['Timestamp']
/** Repository-relative POSIX file path. */
export type RepositoryFilePath = Schemas['RepositoryFilePath']
/** Contract version an event was reported under. */
export type SchemaVersion = Schemas['SchemaVersion']
/** Opaque continuation token of a paged read endpoint. */
export type Cursor = Schemas['Cursor']
/** Project position a read response was taken at. */
export type ProjectPosition = Schemas['ProjectPosition']
/** Project position of the event that last wrote a read-model row. */
export type AppliedPosition = Schemas['AppliedPosition']

// ---------------------------------------------------------------------------
// Closed vocabularies (contract)
// ---------------------------------------------------------------------------

export type EventType = Schemas['EventType']
export type ChangeOperation = Schemas['ChangeOperation']
export type Outcome = Schemas['Outcome']
export type PlanStepState = Schemas['PlanStepState']

/**
 * The enums below are declared inline in the contract rather than as named
 * schemas, so they are read off the schema that owns them instead of being
 * re-typed here.
 */
export type ComponentKind = Schemas['Component']['kind']
export type RelationshipKind = Schemas['Relationship']['kind']
export type AgentRole = Schemas['AgentStartedPayload']['role']
export type AgentStatus = Schemas['AgentStatusReportedPayload']['status']
export type ProgressScope = Schemas['AgentProgressReportedPayload']['scope']
export type ProgressBasis = Schemas['AgentProgressReportedPayload']['basis']
export type RiskSeverity = Schemas['RiskReportedPayload']['severity']

/**
 * The closed v0 event catalogue as a runtime value.
 *
 * The SSE client needs the list at runtime — the server sets `event:` to the
 * event type, so a `message` listener never fires and every type has to be
 * subscribed individually. Types are erased at runtime, so this one list cannot
 * be generated away.
 *
 * `EventTypeCatalogueIsComplete` below is the compile-time proof that it still
 * covers the contract enum: adding a type to `api/openapi.yaml` without adding
 * it here fails `tsc`.
 */
export const EVENT_TYPES = [
  'agent.started',
  'agent.status_reported',
  'agent.progress_reported',
  'agent.finished',
  'plan.published',
  'plan.step_updated',
  'work.step_started',
  'work.step_completed',
  'feedback.published',
  'architecture.snapshot_published',
  'component.change_planned',
  'component.change_applied',
  'relationship.change_planned',
  'relationship.change_applied',
  'diff.reported',
  'risk.reported',
  'problem.reported',
  'correction.issued',
  'retraction.issued',
  'run.finished',
] as const satisfies readonly EventType[]

/**
 * Errors with "does not satisfy the constraint `never`" and names the event
 * types the contract has and `EVENT_TYPES` does not.
 */
type NoneLeftOver<T extends never> = T
export type EventTypeCatalogueIsComplete = NoneLeftOver<
  Exclude<EventType, (typeof EVENT_TYPES)[number]>
>

// ---------------------------------------------------------------------------
// Architecture model as an agent reports it (contract)
// ---------------------------------------------------------------------------

export type Technology = Schemas['Technology']
/**
 * One node of the architecture **as reported**. The read API answers with
 * `AppliedComponent`; this shape appears in event payloads and in
 * `ActiveChange.snapshot`.
 */
export type Component = Schemas['Component']
/** A typed, directed edge as reported. The read API answers `AppliedRelationship`. */
export type Relationship = Schemas['Relationship']
export type PlanStep = Schemas['PlanStep']

// ---------------------------------------------------------------------------
// Event payloads (contract)
// ---------------------------------------------------------------------------

export type AgentStartedPayload = Schemas['AgentStartedPayload']
export type AgentStatusReportedPayload = Schemas['AgentStatusReportedPayload']
export type AgentProgressReportedPayload = Schemas['AgentProgressReportedPayload']
export type AgentFinishedPayload = Schemas['AgentFinishedPayload']
export type PlanPublishedPayload = Schemas['PlanPublishedPayload']
export type PlanStepUpdatedPayload = Schemas['PlanStepUpdatedPayload']
export type WorkStepStartedPayload = Schemas['WorkStepStartedPayload']
export type WorkStepCompletedPayload = Schemas['WorkStepCompletedPayload']
export type FeedbackPublishedPayload = Schemas['FeedbackPublishedPayload']
export type ArchitectureSnapshotPublishedPayload =
  Schemas['ArchitectureSnapshotPublishedPayload']
export type ComponentChangePlannedPayload = Schemas['ComponentChangePlannedPayload']
export type ComponentChangeAppliedPayload = Schemas['ComponentChangeAppliedPayload']
export type RelationshipChangePlannedPayload = Schemas['RelationshipChangePlannedPayload']
export type RelationshipChangeAppliedPayload = Schemas['RelationshipChangeAppliedPayload']
export type DiffReportedPayload = Schemas['DiffReportedPayload']
export type RiskReportedPayload = Schemas['RiskReportedPayload']
export type ProblemReportedPayload = Schemas['ProblemReportedPayload']
export type CorrectionIssuedPayload = Schemas['CorrectionIssuedPayload']
export type RetractionIssuedPayload = Schemas['RetractionIssuedPayload']
export type RunFinishedPayload = Schemas['RunFinishedPayload']

// ---------------------------------------------------------------------------
// Streamed events (contract, SSE)
// ---------------------------------------------------------------------------

/** Server-assigned metadata every streamed event carries. */
export type StreamedEventEnvelope = Schemas['StreamedEventEnvelope']

/** Discriminated union over the whole catalogue, keyed by `type`. */
export type StreamedEvent = Schemas['StreamedEvent']

/** One event of the closed catalogue, narrowed to a single `type`. */
export type StreamedEventOf<T extends EventType> = Extract<StreamedEvent, { type: T }>

/** Maps every event type to its payload schema. */
export type EventPayloadMap = {
  [T in EventType]: StreamedEventOf<T>['payload']
}

// ---------------------------------------------------------------------------
// Read models (projections of the event log, served by the read API)
// ---------------------------------------------------------------------------

export type ProjectSummary = Schemas['ProjectSummary']
export type ProjectCounts = Schemas['ProjectCounts']
export type ProjectDetail = Schemas['ProjectDetail']

/** One node of the **applied** architecture model, with its provenance. */
export type AppliedComponent = Schemas['AppliedComponent']
/** One edge of the **applied** architecture model, with its provenance. */
export type AppliedRelationship = Schemas['AppliedRelationship']

/**
 * A pending change proposal.
 *
 * `snapshot` carries the reported `Component` or `Relationship` descriptor
 * verbatim — selected by `targetKind` — so the canvas can draw a proposal
 * without a second lookup. The contract types it as a free-form object; narrow
 * it with `changeSnapshot()` below rather than casting at the use site.
 */
export type ActiveChange = Schemas['ActiveChange']

export type RunSummary = Schemas['RunSummary']
export type RunCounts = Schemas['RunCounts']
export type RunDetail = Schemas['RunDetail']

export type AgentProgress = Schemas['AgentProgress']
/** One node of the agent tree of a run. */
export type RunAgent = Schemas['RunAgent']

export type RunPlanStep = Schemas['RunPlanStep']
export type RunPlanRevision = Schemas['RunPlanRevision']
export type RunPlan = Schemas['RunPlan']

export type InspectorWorkStep = Schemas['InspectorWorkStep']
export type FeedbackEntry = Schemas['FeedbackEntry']
export type ReportedDiff = Schemas['ReportedDiff']
export type ReportedRisk = Schemas['ReportedRisk']
export type ReportedProblem = Schemas['ReportedProblem']
export type ComponentHistoryEntry = Schemas['ComponentHistoryEntry']

// ---------------------------------------------------------------------------
// Read API responses
// ---------------------------------------------------------------------------

export type ProjectListResponse = Schemas['ProjectListResponse']
export type ProjectResponse = Schemas['ProjectResponse']
export type ArchitectureResponse = Schemas['ArchitectureResponse']
export type RunListResponse = Schemas['RunListResponse']
export type RunResponse = Schemas['RunResponse']
export type AgentListResponse = Schemas['AgentListResponse']
export type PlanListResponse = Schemas['PlanListResponse']
export type ComponentInspectorResponse = Schemas['ComponentInspectorResponse']
export type ComponentHistoryResponse = Schemas['ComponentHistoryResponse']

// ---------------------------------------------------------------------------
// RFC 9457 problem details
// ---------------------------------------------------------------------------

export type Problem = Schemas['Problem']
export type ValidationError = Schemas['ValidationError']
export type ValidationProblem = Schemas['ValidationProblem']

// ---------------------------------------------------------------------------
// Local narrowing helpers — no shape of their own
// ---------------------------------------------------------------------------

/**
 * Narrows `ActiveChange.snapshot` to the descriptor `targetKind` announces.
 *
 * The contract deliberately types `snapshot` as a free-form object: it stores
 * what the agent reported, unchanged. `targetKind` is the discriminator, so this
 * is a projection of the contract's own rule, not an added assumption. Returns
 * `null` when the snapshot is not an object at all, so a malformed row degrades
 * to "nothing was reported" instead of throwing.
 */
export function changeSnapshot(change: ActiveChange & { targetKind: 'component' }): Component | null
export function changeSnapshot(
  change: ActiveChange & { targetKind: 'relationship' },
): Relationship | null
export function changeSnapshot(change: ActiveChange): Component | Relationship | null
export function changeSnapshot(change: ActiveChange): Component | Relationship | null {
  const snapshot = change.snapshot
  if (typeof snapshot !== 'object' || snapshot === null) return null
  return snapshot as Component | Relationship
}
