package readapi

import (
	"encoding/json"
	"time"
)

// Every response repeats `projectPosition`, the server side project position at
// the moment the snapshot was read. It is `projects.last_position` and is the
// value an SSE client compares its own cursor against, so a snapshot and the
// stream can be merged without guessing which one is ahead.
//
// Every row carries the project position of the event that last wrote it as
// `position`, which lets the UI reconcile a single node instead of the whole
// snapshot when a live event arrives.

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

// ProjectsResponse is the body of `GET /api/v1/projects`.
type ProjectsResponse struct {
	// ProjectPosition is the highest position across the listed projects, or 0
	// when there is none. The collection is not scoped to one project, so the
	// per-project value lives on each summary instead.
	ProjectPosition int64            `json:"projectPosition"`
	Projects        []ProjectSummary `json:"projects"`
}

// ProjectSummary is one row of the project list.
type ProjectSummary struct {
	ProjectID    string    `json:"projectId"`
	FirstSeenAt  time.Time `json:"firstSeenAt"`
	LastEventAt  time.Time `json:"lastEventAt"`
	LastPosition int64     `json:"lastPosition"`
	// CurrentRunID is null until a root orchestrator has opened a run.
	CurrentRunID *string `json:"currentRunId"`
}

// ProjectResponse is the body of `GET /api/v1/projects/{projectId}`.
type ProjectResponse struct {
	ProjectPosition int64         `json:"projectPosition"`
	Project         ProjectDetail `json:"project"`
}

// ProjectDetail is one project plus the sizes of its read models, so the shell
// can render its navigation without fetching every collection first.
type ProjectDetail struct {
	ProjectSummary
	Counts ProjectCounts `json:"counts"`
}

// ProjectCounts sizes the read models of one project.
type ProjectCounts struct {
	Runs          int64 `json:"runs"`
	OpenRuns      int64 `json:"openRuns"`
	Components    int64 `json:"components"`
	Relationships int64 `json:"relationships"`
	// ActiveChanges counts pending proposals only — see ArchitectureResponse.
	ActiveChanges int64 `json:"activeChanges"`
}

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------

// ArchitectureResponse is the body of
// `GET /api/v1/projects/{projectId}/architecture`.
//
// Components and relationships are the *applied* model. ActiveChanges lists the
// changes that are still pending (`state: planned`); an applied change has
// become the model and a retracted one was withdrawn, so neither is active.
type ArchitectureResponse struct {
	ProjectPosition int64          `json:"projectPosition"`
	Components      []Component    `json:"components"`
	Relationships   []Relationship `json:"relationships"`
	ActiveChanges   []ActiveChange `json:"activeChanges"`
}

// Component is one node of the applied architecture model. The hierarchy is
// expressed exclusively through ParentComponentID; the response is flat.
type Component struct {
	ComponentID       string          `json:"componentId"`
	Name              string          `json:"name"`
	Kind              string          `json:"kind"`
	ParentComponentID *string         `json:"parentComponentId"`
	Description       string          `json:"description"`
	Technology        json.RawMessage `json:"technology"`
	Tags              json.RawMessage `json:"tags"`
	AppliedAt         time.Time       `json:"appliedAt"`
	AppliedByAgentID  string          `json:"appliedByAgentId"`
	AppliedRunID      string          `json:"appliedRunId"`
	Position          int64           `json:"position"`
}

// Relationship is one typed, directed edge of the applied model. Every message
// topic keeps its own row; edges are never aggregated server side.
type Relationship struct {
	RelationshipID    string    `json:"relationshipId"`
	SourceComponentID string    `json:"sourceComponentId"`
	TargetComponentID string    `json:"targetComponentId"`
	Kind              string    `json:"kind"`
	Label             string    `json:"label"`
	Protocol          string    `json:"protocol"`
	Operation         string    `json:"operation"`
	Channel           string    `json:"channel"`
	AppliedAt         time.Time `json:"appliedAt"`
	AppliedByAgentID  string    `json:"appliedByAgentId"`
	AppliedRunID      string    `json:"appliedRunId"`
	Position          int64     `json:"position"`
}

// ActiveChange is a pending change proposal. Snapshot carries the reported
// component or relationship descriptor verbatim, so the canvas can render the
// proposal next to the applied model without a second lookup.
type ActiveChange struct {
	ChangeID    string          `json:"changeId"`
	TargetKind  string          `json:"targetKind"`
	TargetID    string          `json:"targetId"`
	Operation   string          `json:"operation"`
	State       string          `json:"state"`
	RunID       string          `json:"runId"`
	AgentID     string          `json:"agentId"`
	PlannedAt   *time.Time      `json:"plannedAt"`
	AppliedAt   *time.Time      `json:"appliedAt"`
	RetractedAt *time.Time      `json:"retractedAt"`
	Snapshot    json.RawMessage `json:"snapshot"`
	Position    int64           `json:"position"`
}

// ---------------------------------------------------------------------------
// Runs, agents and plans
// ---------------------------------------------------------------------------

// RunsResponse is the body of `GET /api/v1/projects/{projectId}/runs`. It lists
// current and historical runs alike, newest start first.
type RunsResponse struct {
	ProjectPosition int64        `json:"projectPosition"`
	Runs            []RunSummary `json:"runs"`
	// NextCursor is null on the last page.
	NextCursor *string `json:"nextCursor"`
}

// RunSummary is one run. A run stays open until an explicit `run.finished`
// closes it; silence is never a terminal state.
type RunSummary struct {
	RunID string `json:"runId"`
	// RootAgentID is null until a root orchestrator reported agent.started.
	RootAgentID *string    `json:"rootAgentId"`
	StartedAt   time.Time  `json:"startedAt"`
	FinishedAt  *time.Time `json:"finishedAt"`
	Outcome     *string    `json:"outcome"`
	IsOpen      bool       `json:"isOpen"`
	// IsCurrent marks the run `projects.current_run_id` points at.
	IsCurrent bool  `json:"isCurrent"`
	Position  int64 `json:"position"`
}

// RunResponse is the body of `GET /api/v1/projects/{projectId}/runs/{runId}`.
type RunResponse struct {
	ProjectPosition int64     `json:"projectPosition"`
	Run             RunDetail `json:"run"`
}

// RunDetail is one run plus the sizes of the collections hanging off it.
type RunDetail struct {
	RunSummary
	Counts RunCounts `json:"counts"`
}

// RunCounts sizes the read models of one run.
type RunCounts struct {
	Agents    int64 `json:"agents"`
	Plans     int64 `json:"plans"`
	WorkSteps int64 `json:"workSteps"`
}

// AgentsResponse is the body of
// `GET /api/v1/projects/{projectId}/runs/{runId}/agents`.
//
// The list is flat and every entry carries its ParentAgentID; the UI builds the
// tree. A flat list keeps arbitrarily deep spawn chains renderable without the
// server deciding on a nesting depth.
type AgentsResponse struct {
	ProjectPosition int64   `json:"projectPosition"`
	Agents          []Agent `json:"agents"`
}

// Agent is one node of the agent tree of a run.
type Agent struct {
	AgentID string `json:"agentId"`
	RunID   string `json:"runId"`
	// ParentAgentID is null for the root orchestrator.
	ParentAgentID *string `json:"parentAgentId"`
	Role          string  `json:"role"`
	DisplayName   string  `json:"displayName"`
	AssignedTask  string  `json:"assignedTask"`
	// Status is the last explicitly reported status, empty while none was
	// reported. It is never derived from silence.
	Status     string `json:"status"`
	StatusNote string `json:"statusNote"`
	// Progress is null until the agent reported a number itself.
	Progress *AgentProgress `json:"progress"`
	// FinishedOutcome is null while the agent has not reported agent.finished.
	FinishedOutcome *string   `json:"finishedOutcome"`
	StartedAt       time.Time `json:"startedAt"`
	LastEventAt     time.Time `json:"lastEventAt"`
	Position        int64     `json:"position"`
}

// AgentProgress is a self-assessment of the reporting agent, not a measurement.
// Scope separates an agent's own task from an orchestrator's overall estimate;
// Basis separates a free estimate from counted steps.
type AgentProgress struct {
	Percent int     `json:"percent"`
	Scope   *string `json:"scope"`
	Basis   *string `json:"basis"`
}

// PlansResponse is the body of
// `GET /api/v1/projects/{projectId}/runs/{runId}/plans`.
type PlansResponse struct {
	ProjectPosition int64  `json:"projectPosition"`
	Plans           []Plan `json:"plans"`
}

// Plan is one plan of a run with every revision it ever had.
type Plan struct {
	PlanID          string `json:"planId"`
	RunID           string `json:"runId"`
	AgentID         string `json:"agentId"`
	CurrentRevision int    `json:"currentRevision"`
	// Revisions are append-only and ascending. Publishing a new revision never
	// rewrites an earlier one, so the whole history stays inspectable.
	Revisions []PlanRevision `json:"revisions"`
	Position  int64          `json:"position"`
}

// PlanRevision is one published revision of a plan.
type PlanRevision struct {
	Revision         int       `json:"revision"`
	CreatedAt        time.Time `json:"createdAt"`
	CreatedByAgentID string    `json:"createdByAgentId"`
	// IsCurrent marks the revision `plan.step_updated` writes to.
	IsCurrent bool       `json:"isCurrent"`
	Steps     []PlanStep `json:"steps"`
	Position  int64      `json:"position"`
}

// PlanStep is one step of one revision, in the reported order.
type PlanStep struct {
	StepID   string `json:"stepId"`
	Order    int    `json:"order"`
	Title    string `json:"title"`
	State    string `json:"state"`
	Position int64  `json:"position"`
}

// ---------------------------------------------------------------------------
// Component inspector and history
// ---------------------------------------------------------------------------

// ComponentResponse is the body of
// `GET /api/v1/projects/{projectId}/components/{componentId}`.
//
// It carries the evidence of **exactly one run** — the requested one, or the
// current one when no `runId` was given. Evidence of other runs is never mixed
// in; the run spanning view is `/history`.
type ComponentResponse struct {
	ProjectPosition int64 `json:"projectPosition"`
	// RunID is the run the evidence belongs to, null when the project has no
	// run at all yet.
	RunID *string `json:"runId"`
	// Component is null when the component is known from the history but no
	// longer part of the applied model, for example after a remove.
	Component *Component `json:"component"`
	// ResponsibleAgent is the agent of CurrentWorkStep, or the agent that last
	// applied the component within this run. Null when neither is reported —
	// responsibility is read from evidence, never guessed.
	ResponsibleAgent *Agent `json:"responsibleAgent"`
	// CurrentWorkStep is the open work step of this run touching the component,
	// or the most recently started one when all of them completed.
	CurrentWorkStep *WorkStep       `json:"currentWorkStep"`
	Feedback        []FeedbackEntry `json:"feedback"`
	// Diffs is paginated: a single component can accumulate more unified diffs
	// than one response should carry. See NextDiffCursor.
	Diffs []Diff `json:"diffs"`
	// NextDiffCursor is null when the last page of diffs was returned.
	NextDiffCursor *string        `json:"nextDiffCursor"`
	Risks          []Risk         `json:"risks"`
	Problems       []Problem      `json:"problems"`
	ActiveChanges  []ActiveChange `json:"activeChanges"`
}

// WorkStep is a concrete unit of work an agent reported.
type WorkStep struct {
	WorkStepID string `json:"workStepId"`
	RunID      string `json:"runId"`
	AgentID    string `json:"agentId"`
	// PlanStepID links the work back to the plan when it followed a planned step.
	PlanStepID  *string    `json:"planStepId"`
	Title       string     `json:"title"`
	StartedAt   time.Time  `json:"startedAt"`
	CompletedAt *time.Time `json:"completedAt"`
	Summary     *string    `json:"summary"`
	Position    int64      `json:"position"`
}

// FeedbackEntry is one published, component scoped feedback item. Body is
// untrusted markdown and is handed through verbatim; sanitising it is the
// renderer's job.
type FeedbackEntry struct {
	FeedbackID string    `json:"feedbackId"`
	RunID      string    `json:"runId"`
	AgentID    string    `json:"agentId"`
	Format     string    `json:"format"`
	Title      string    `json:"title"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"createdAt"`
	Position   int64     `json:"position"`
}

// Diff is one reported unified diff of exactly one repository file. The backend
// never splits or merges diffs; ChangeID is what groups several files of one
// logical change.
type Diff struct {
	DiffID      string    `json:"diffId"`
	RunID       string    `json:"runId"`
	AgentID     string    `json:"agentId"`
	ChangeID    *string   `json:"changeId"`
	FilePath    string    `json:"filePath"`
	UnifiedDiff string    `json:"unifiedDiff"`
	CreatedAt   time.Time `json:"createdAt"`
	Position    int64     `json:"position"`
}

// Risk is a risk as stated by the reporting agent. The system never derives,
// scores or aggregates risks on its own.
type Risk struct {
	RiskID    string    `json:"riskId"`
	RunID     string    `json:"runId"`
	AgentID   string    `json:"agentId"`
	Title     string    `json:"title"`
	Detail    string    `json:"detail"`
	Severity  string    `json:"severity"`
	CreatedAt time.Time `json:"createdAt"`
	Position  int64     `json:"position"`
}

// Problem is a problem as stated by the reporting agent.
type Problem struct {
	ProblemID string    `json:"problemId"`
	RunID     string    `json:"runId"`
	AgentID   string    `json:"agentId"`
	Title     string    `json:"title"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"createdAt"`
	Position  int64     `json:"position"`
}

// HistoryResponse is the body of
// `GET /api/v1/projects/{projectId}/components/{componentId}/history`.
//
// Unlike the inspector this view spans **all** runs of the project, descending
// by project position, and every entry names the run it belongs to.
type HistoryResponse struct {
	ProjectPosition int64          `json:"projectPosition"`
	Entries         []HistoryEntry `json:"entries"`
	// NextCursor is null on the last page.
	NextCursor *string `json:"nextCursor"`
}

// HistoryEntry is one reported event that touched the component, as recorded.
// Corrections and retractions appear as their own entries; nothing is
// overwritten.
type HistoryEntry struct {
	Position      int64           `json:"position"`
	ServerEventID string          `json:"serverEventId"`
	ClientEventID string          `json:"clientEventId"`
	RunID         string          `json:"runId"`
	AgentID       string          `json:"agentId"`
	ParentAgentID *string         `json:"parentAgentId"`
	Type          string          `json:"type"`
	SchemaVersion string          `json:"schemaVersion"`
	OccurredAt    time.Time       `json:"occurredAt"`
	ReceivedAt    time.Time       `json:"receivedAt"`
	Payload       json.RawMessage `json:"payload"`
}
