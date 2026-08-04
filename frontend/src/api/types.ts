/**
 * Domain and read-model types of the cockpit.
 *
 * Everything here is derived by hand from `api/openapi.yaml` — there is
 * deliberately **no code generation step**, so the Docker build stays a plain
 * `npm ci && npm run build` with no generator in between.
 *
 * Two groups live in this file:
 *
 * 1. Types that appear verbatim in the event contract (`Component`,
 *    `Relationship`, `PlanStep`, `Technology`, every event payload and the
 *    streamed envelope). They must stay byte-compatible with the contract.
 * 2. Read models (`ProjectSummary`, `Agent`, `Plan`, `ActiveChange`, …). The
 *    read API projects the event log into these shapes; it is specified in the
 *    issue and implemented server-side in #8. They are folds over the events of
 *    group 1 and never introduce information the contract cannot carry.
 *
 * Nothing in the cockpit is inferred: a field is `null` when no agent reported
 * it, never a guess.
 */

// ---------------------------------------------------------------------------
// Primitive identifiers (contract)
// ---------------------------------------------------------------------------

/** Stable project slug, e.g. `visualise-ai`. */
export type ProjectId = string
/** Identifier of one agent run inside a project. */
export type RunId = string
/** Identifier of a reporting agent, unique within a run. */
export type AgentId = string
/** Identifier of an architecture component, stable across snapshots. */
export type ComponentId = string
/** Opaque agent-assigned identifier (plan, work step, feedback, diff, risk, …). */
export type Identifier = string
/** RFC 4122 UUID. */
export type Uuid = string
/** RFC 3339 timestamp, UTC. */
export type Timestamp = string
/** Repository-relative POSIX file path. */
export type RepositoryFilePath = string

/** The closed v0 event catalogue. */
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
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export type ChangeOperation = 'add' | 'modify' | 'remove'
export type Outcome = 'completed' | 'failed' | 'cancelled'
export type PlanStepState = 'pending' | 'in_progress' | 'done' | 'skipped'
export type AgentRole = 'orchestrator' | 'subagent'
export type AgentStatus = 'working' | 'waiting' | 'blocked' | 'idle' | 'done'
export type ProgressScope = 'own_task' | 'overall_estimate'
export type ProgressBasis = 'reported_estimate' | 'completed_steps'
export type RiskSeverity = 'low' | 'medium' | 'high'
export type ComponentKind =
  | 'system'
  | 'service'
  | 'module'
  | 'datastore'
  | 'queue'
  | 'topic'
  | 'ui'
  | 'external'
  | 'library'
export type RelationshipKind =
  | 'http'
  | 'grpc'
  | 'data'
  | 'async'
  | 'nats_topic'
  | 'dependency'

// ---------------------------------------------------------------------------
// Architecture model (contract)
// ---------------------------------------------------------------------------

export interface Technology {
  language?: string
  framework?: string
  runtime?: string
  version?: string
}

/**
 * One node of the application architecture. The hierarchy is expressed
 * exclusively through `parentComponentId`; dotted ids are a convention only.
 */
export interface Component {
  componentId: ComponentId
  name: string
  kind: ComponentKind
  parentComponentId: ComponentId | null
  description?: string
  technology?: Technology
  tags?: string[]
}

/**
 * A typed, directed edge. Every NATS topic is its own relationship — topics are
 * never merged server-side into one aggregated messaging edge.
 */
export interface Relationship {
  relationshipId: Identifier
  sourceComponentId: ComponentId
  targetComponentId: ComponentId
  kind: RelationshipKind
  label?: string
  protocol?: string
  operation?: string
  channel?: string
}

export interface PlanStep {
  stepId: Identifier
  order: number
  title: string
  state: PlanStepState
  componentIds?: ComponentId[]
}

// ---------------------------------------------------------------------------
// Event payloads (contract)
// ---------------------------------------------------------------------------

export interface AgentStartedPayload {
  role: AgentRole
  displayName: string
  assignedTask: string
  capabilities?: string[]
}

export interface AgentStatusReportedPayload {
  status: AgentStatus
  note?: string
}

export interface AgentProgressReportedPayload {
  percent: number
  scope: ProgressScope
  basis: ProgressBasis
  note?: string
}

export interface AgentFinishedPayload {
  outcome: Outcome
  summary?: string
}

export interface PlanPublishedPayload {
  planId: Identifier
  revision: number
  steps: PlanStep[]
}

export interface PlanStepUpdatedPayload {
  planId: Identifier
  stepId: Identifier
  state: PlanStepState
  note?: string
}

export interface WorkStepStartedPayload {
  workStepId: Identifier
  title: string
  componentIds: ComponentId[]
  planStepId?: Identifier
}

export interface WorkStepCompletedPayload {
  workStepId: Identifier
  summary?: string
}

export interface FeedbackPublishedPayload {
  feedbackId: Identifier
  componentIds: ComponentId[]
  format: 'markdown'
  body: string
  title?: string
}

export interface ArchitectureSnapshotPublishedPayload {
  snapshotId: Identifier
  components: Component[]
  relationships: Relationship[]
}

export interface ComponentChangePlannedPayload {
  changeId: Identifier
  operation: ChangeOperation
  component: Component
  rationale?: string
}

export interface ComponentChangeAppliedPayload {
  changeId?: Identifier
  operation: ChangeOperation
  component: Component
}

export interface RelationshipChangePlannedPayload {
  changeId: Identifier
  operation: ChangeOperation
  relationship: Relationship
  rationale?: string
}

export interface RelationshipChangeAppliedPayload {
  changeId?: Identifier
  operation: ChangeOperation
  relationship: Relationship
}

export interface DiffReportedPayload {
  diffId: Identifier
  changeId?: Identifier
  componentIds: ComponentId[]
  filePath: RepositoryFilePath
  unifiedDiff: string
}

export interface RiskReportedPayload {
  riskId: Identifier
  componentIds: ComponentId[]
  title: string
  detail?: string
  severity: RiskSeverity
}

export interface ProblemReportedPayload {
  problemId: Identifier
  componentIds: ComponentId[]
  title: string
  detail?: string
}

export interface CorrectionIssuedPayload {
  correctsClientEventId: Uuid
  reason: string
  correctedType: EventType
  correctedPayload: Record<string, unknown>
}

export interface RetractionIssuedPayload {
  retractsClientEventId: Uuid
  reason: string
}

export interface RunFinishedPayload {
  outcome: Outcome
  summary?: string
}

/** Maps every event type to its payload schema. */
export interface EventPayloadMap {
  'agent.started': AgentStartedPayload
  'agent.status_reported': AgentStatusReportedPayload
  'agent.progress_reported': AgentProgressReportedPayload
  'agent.finished': AgentFinishedPayload
  'plan.published': PlanPublishedPayload
  'plan.step_updated': PlanStepUpdatedPayload
  'work.step_started': WorkStepStartedPayload
  'work.step_completed': WorkStepCompletedPayload
  'feedback.published': FeedbackPublishedPayload
  'architecture.snapshot_published': ArchitectureSnapshotPublishedPayload
  'component.change_planned': ComponentChangePlannedPayload
  'component.change_applied': ComponentChangeAppliedPayload
  'relationship.change_planned': RelationshipChangePlannedPayload
  'relationship.change_applied': RelationshipChangeAppliedPayload
  'diff.reported': DiffReportedPayload
  'risk.reported': RiskReportedPayload
  'problem.reported': ProblemReportedPayload
  'correction.issued': CorrectionIssuedPayload
  'retraction.issued': RetractionIssuedPayload
  'run.finished': RunFinishedPayload
}

// ---------------------------------------------------------------------------
// Streamed events (contract, SSE)
// ---------------------------------------------------------------------------

/** Server-assigned metadata every streamed event carries. */
export interface StreamedEventMeta {
  schemaVersion: '1.0'
  clientEventId: Uuid
  projectId: ProjectId
  runId: RunId
  agentId: AgentId
  parentAgentId?: AgentId | null
  occurredAt: Timestamp
  /** Strictly increasing per project. Cursor for SSE replay. */
  position: number
  serverEventId: Uuid
  receivedAt: Timestamp
}

/** One event of the closed catalogue as carried by a single SSE `data:` line. */
export type StreamedEventOf<T extends EventType> = StreamedEventMeta & {
  type: T
  payload: EventPayloadMap[T]
}

/** Discriminated union over the whole catalogue, keyed by `type`. */
export type StreamedEvent = {
  [T in EventType]: StreamedEventOf<T>
}[EventType]

// ---------------------------------------------------------------------------
// Read models (projections of the event log, served by the read API)
// ---------------------------------------------------------------------------

/**
 * Server-side project position every read response carries. It is the same
 * counter the SSE stream uses as `id:`, so an HTTP snapshot and the live stream
 * can be reconciled deterministically.
 */
export interface PositionedResponse {
  projectPosition: number
}

export interface ProjectSummary {
  projectId: ProjectId
  name: string
  /** Most recent run, or `null` while a project has not reported one yet. */
  currentRunId: RunId | null
  runCount: number
  lastEventAt: Timestamp | null
}

export interface ProjectDetail extends ProjectSummary {
  description: string | null
  firstEventAt: Timestamp | null
  componentCount: number
  relationshipCount: number
}

export interface RunSummary {
  runId: RunId
  projectId: ProjectId
  startedAt: Timestamp
  lastEventAt: Timestamp
  /** `null` while no `run.finished` was reported — never inferred from silence. */
  outcome: Outcome | null
  finishedAt: Timestamp | null
  orchestratorAgentId: AgentId | null
  agentCount: number
}

export interface RunDetail extends RunSummary {
  summary: string | null
}

export interface AgentProgress {
  percent: number
  scope: ProgressScope
  basis: ProgressBasis
  note: string | null
  reportedAt: Timestamp
}

/**
 * One agent of a run. The tree is flat with `parentAgentId`; the left pane
 * builds the hierarchy from it (#11).
 */
export interface Agent {
  agentId: AgentId
  runId: RunId
  parentAgentId: AgentId | null
  role: AgentRole
  displayName: string
  assignedTask: string
  capabilities: string[]
  /** Last explicitly reported status; `null` until the agent reported one. */
  status: AgentStatus | null
  statusNote: string | null
  statusReportedAt: Timestamp | null
  progress: AgentProgress | null
  outcome: Outcome | null
  summary: string | null
  startedAt: Timestamp
  lastEventAt: Timestamp
}

export interface PlanRevision {
  revision: number
  publishedAt: Timestamp
  publishedByAgentId: AgentId
  steps: PlanStep[]
}

/** Plans are append-only: a changed plan is a new revision of the same plan. */
export interface Plan {
  planId: Identifier
  runId: RunId
  agentId: AgentId
  currentRevision: number
  revisions: PlanRevision[]
}

export interface WorkStep {
  workStepId: Identifier
  runId: RunId
  agentId: AgentId
  title: string
  componentIds: ComponentId[]
  planStepId: Identifier | null
  startedAt: Timestamp
  completedAt: Timestamp | null
  summary: string | null
}

/**
 * A component or relationship change that is currently visible on the canvas —
 * either only planned, or applied recently enough to still be highlighted.
 * Drives the work-state overlay (#10); `src/state/workStates.ts` owns the
 * mapping to a visual state.
 */
export interface ActiveChange {
  changeId: Identifier | null
  target: 'component' | 'relationship'
  state: 'planned' | 'applied'
  operation: ChangeOperation
  componentId: ComponentId | null
  relationshipId: Identifier | null
  runId: RunId
  agentId: AgentId
  rationale: string | null
  reportedAt: Timestamp
}

export interface Feedback {
  feedbackId: Identifier
  runId: RunId
  agentId: AgentId
  componentIds: ComponentId[]
  format: 'markdown'
  /** Untrusted markdown — rendered sanitised by the inspector (#12). */
  body: string
  title: string | null
  publishedAt: Timestamp
  retracted: boolean
  correctedAt: Timestamp | null
}

export interface Diff {
  diffId: Identifier
  changeId: Identifier | null
  runId: RunId
  agentId: AgentId
  componentIds: ComponentId[]
  filePath: RepositoryFilePath
  unifiedDiff: string
  reportedAt: Timestamp
  retracted: boolean
}

export interface Risk {
  riskId: Identifier
  runId: RunId
  agentId: AgentId
  componentIds: ComponentId[]
  title: string
  detail: string | null
  severity: RiskSeverity
  reportedAt: Timestamp
  retracted: boolean
}

export interface ReportedProblem {
  problemId: Identifier
  runId: RunId
  agentId: AgentId
  componentIds: ComponentId[]
  title: string
  detail: string | null
  reportedAt: Timestamp
  retracted: boolean
}

/**
 * One entry of the component history. Corrections and retractions stay visible
 * as their own entries; nothing is overwritten.
 */
export interface HistoryEntry {
  position: number
  eventType: EventType
  runId: RunId
  agentId: AgentId
  occurredAt: Timestamp
  receivedAt: Timestamp
  title: string
  retracted: boolean
  correctsPosition: number | null
}

// ---------------------------------------------------------------------------
// Read API responses
// ---------------------------------------------------------------------------

export interface ProjectsResponse extends PositionedResponse {
  projects: ProjectSummary[]
}

export interface ProjectResponse extends PositionedResponse {
  project: ProjectDetail
}

export interface ArchitectureResponse extends PositionedResponse {
  components: Component[]
  relationships: Relationship[]
  activeChanges: ActiveChange[]
}

export interface RunsResponse extends PositionedResponse {
  runs: RunSummary[]
  nextCursor: string | null
}

export interface RunResponse extends PositionedResponse {
  run: RunDetail
}

export interface AgentsResponse extends PositionedResponse {
  agents: Agent[]
}

export interface PlansResponse extends PositionedResponse {
  plans: Plan[]
}

export interface ComponentInspectorResponse extends PositionedResponse {
  component: Component
  responsibleAgent: Agent | null
  currentWorkStep: WorkStep | null
  feedback: Feedback[]
  diffs: Diff[]
  risks: Risk[]
  problems: ReportedProblem[]
  activeChanges: ActiveChange[]
}

export interface ComponentHistoryResponse extends PositionedResponse {
  entries: HistoryEntry[]
  nextCursor: string | null
}

// ---------------------------------------------------------------------------
// RFC 9457 problem details
// ---------------------------------------------------------------------------

export interface Problem {
  type: string
  title: string
  status: number
  detail: string
  code: string
  instance?: string
}

export interface ValidationErrorDetail {
  /** RFC 6901 JSON Pointer into the rejected body. */
  field: string
  code: string
  message: string
}

export interface ValidationProblem extends Problem {
  errors: ValidationErrorDetail[]
}
