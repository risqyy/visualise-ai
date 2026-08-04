package store

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

// ErrEventLogImmutable is reported when something tries to rewrite the log.
var ErrEventLogImmutable = errors.New("store: the event log is append-only")

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

// Event is one entry of a project event log.
//
// The two unique indexes carry the invariants of the log: a project position is
// handed out exactly once, and a clientEventId is accepted exactly once per
// project. The remaining indexes serve the four reads the cockpit performs —
// replay, run history, agent history and type history. Component history does
// not scan the payload; it is served by the EventComponent join table.
type Event struct {
	ID            string    `gorm:"column:id;type:uuid;primaryKey"`
	ProjectID     string    `gorm:"column:project_id;type:text;not null;uniqueIndex:uq_events_project_position,priority:1;uniqueIndex:uq_events_project_client_event_id,priority:1;index:idx_events_project_run_position,priority:1;index:idx_events_project_agent_position,priority:1;index:idx_events_project_type_position,priority:1"`
	Position      int64     `gorm:"column:position;type:bigint;not null;uniqueIndex:uq_events_project_position,priority:2;index:idx_events_project_run_position,priority:3;index:idx_events_project_agent_position,priority:3;index:idx_events_project_type_position,priority:3"`
	ClientEventID string    `gorm:"column:client_event_id;type:uuid;not null;uniqueIndex:uq_events_project_client_event_id,priority:2"`
	RunID         string    `gorm:"column:run_id;type:text;not null;index:idx_events_project_run_position,priority:2"`
	AgentID       string    `gorm:"column:agent_id;type:text;not null;index:idx_events_project_agent_position,priority:2"`
	ParentAgentID *string   `gorm:"column:parent_agent_id;type:text"`
	Type          string    `gorm:"column:type;type:text;not null;index:idx_events_project_type_position,priority:2"`
	SchemaVersion string    `gorm:"column:schema_version;type:text;not null"`
	OccurredAt    time.Time `gorm:"column:occurred_at;type:timestamptz;not null"`
	ReceivedAt    time.Time `gorm:"column:received_at;type:timestamptz;not null"`
	Payload       JSON      `gorm:"column:payload;type:jsonb;not null"`
	PayloadHash   string    `gorm:"column:payload_hash;type:text;not null"`
}

// TableName pins the table name so the schema does not depend on GORM's
// pluralisation rules.
func (Event) TableName() string { return "events" }

// BeforeUpdate refuses every update of a stored event. Corrections and
// retractions are new events referencing the original one.
func (Event) BeforeUpdate(*gorm.DB) error { return ErrEventLogImmutable }

// BeforeDelete refuses every delete of a stored event.
func (Event) BeforeDelete(*gorm.DB) error { return ErrEventLogImmutable }

// EventCorrection links a correction or retraction event to the event it
// refers to. The original event itself stays untouched.
//
// The position column is the position of the correcting event, so it doubles as
// this row's applied position; a separate last_applied_project_position would
// only repeat it.
type EventCorrection struct {
	ProjectID           string  `gorm:"column:project_id;type:text;primaryKey;index:idx_event_corrections_target,priority:1"`
	Position            int64   `gorm:"column:position;type:bigint;primaryKey"`
	Kind                string  `gorm:"column:kind;type:text;not null;default:''"`
	TargetClientEventID string  `gorm:"column:target_client_event_id;type:uuid;not null;index:idx_event_corrections_target,priority:2"`
	Reason              string  `gorm:"column:reason;type:text;not null;default:''"`
	CorrectedType       *string `gorm:"column:corrected_type;type:text"`
}

// TableName pins the table name.
func (EventCorrection) TableName() string { return "event_corrections" }

// EventComponent links an event to every component it touches, so component
// history is an index lookup instead of a JSONB scan.
//
// As for EventCorrection, the position column already is the applied position.
type EventComponent struct {
	ProjectID   string `gorm:"column:project_id;type:text;primaryKey;index:idx_event_components_component_position,priority:1"`
	Position    int64  `gorm:"column:position;type:bigint;primaryKey;index:idx_event_components_component_position,priority:3"`
	ComponentID string `gorm:"column:component_id;type:text;primaryKey;index:idx_event_components_component_position,priority:2"`
}

// TableName pins the table name.
func (EventComponent) TableName() string { return "event_components" }

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

// Project is the head of one project event log.
//
// It is also the serialisation point of position assignment: every append locks
// this row before it reads LastPosition.
type Project struct {
	ProjectID                  string    `gorm:"column:project_id;type:text;primaryKey"`
	FirstSeenAt                time.Time `gorm:"column:first_seen_at;type:timestamptz;not null"`
	LastEventAt                time.Time `gorm:"column:last_event_at;type:timestamptz;not null"`
	LastPosition               int64     `gorm:"column:last_position;type:bigint;not null;default:0"`
	CurrentRunID               string    `gorm:"column:current_run_id;type:text;not null;default:''"`
	LastAppliedProjectPosition int64     `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (Project) TableName() string { return "projects" }

// Run is one orchestrated session inside a project.
//
// A run stays open until an explicit run.finished event closes it; silence is
// never interpreted as a terminal state.
type Run struct {
	ProjectID                  string     `gorm:"column:project_id;type:text;primaryKey"`
	RunID                      string     `gorm:"column:run_id;type:text;primaryKey"`
	RootAgentID                string     `gorm:"column:root_agent_id;type:text;not null;default:''"`
	StartedAt                  time.Time  `gorm:"column:started_at;type:timestamptz;not null"`
	FinishedAt                 *time.Time `gorm:"column:finished_at;type:timestamptz"`
	Outcome                    *string    `gorm:"column:outcome;type:text"`
	IsOpen                     bool       `gorm:"column:is_open;not null;default:true"`
	LastAppliedProjectPosition int64      `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (Run) TableName() string { return "runs" }

// Agent is one node of the agent tree of a run. The tree is expressed through
// ParentAgentID; a root orchestrator has none.
//
// Status, progress and the finished outcome are kept apart on purpose: each is
// written only by the event that explicitly reports it.
type Agent struct {
	ProjectID                  string    `gorm:"column:project_id;type:text;primaryKey;index:idx_agents_parent,priority:1"`
	RunID                      string    `gorm:"column:run_id;type:text;primaryKey;index:idx_agents_parent,priority:2"`
	AgentID                    string    `gorm:"column:agent_id;type:text;primaryKey"`
	ParentAgentID              *string   `gorm:"column:parent_agent_id;type:text;index:idx_agents_parent,priority:3"`
	Role                       string    `gorm:"column:role;type:text;not null;default:''"`
	DisplayName                string    `gorm:"column:display_name;type:text;not null;default:''"`
	AssignedTask               string    `gorm:"column:assigned_task;type:text;not null;default:''"`
	Status                     string    `gorm:"column:status;type:text;not null;default:''"`
	StatusNote                 string    `gorm:"column:status_note;type:text;not null;default:''"`
	ProgressPercent            *int      `gorm:"column:progress_percent;type:int"`
	ProgressScope              *string   `gorm:"column:progress_scope;type:text"`
	ProgressBasis              *string   `gorm:"column:progress_basis;type:text"`
	FinishedOutcome            *string   `gorm:"column:finished_outcome;type:text"`
	StartedAt                  time.Time `gorm:"column:started_at;type:timestamptz;not null"`
	LastEventAt                time.Time `gorm:"column:last_event_at;type:timestamptz;not null"`
	LastAppliedProjectPosition int64     `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (Agent) TableName() string { return "agents" }

// Plan points at the revision of a plan that is currently displayed.
type Plan struct {
	ProjectID                  string `gorm:"column:project_id;type:text;primaryKey"`
	RunID                      string `gorm:"column:run_id;type:text;primaryKey"`
	PlanID                     string `gorm:"column:plan_id;type:text;primaryKey"`
	AgentID                    string `gorm:"column:agent_id;type:text;not null;default:''"`
	CurrentRevision            int    `gorm:"column:current_revision;type:int;not null;default:0"`
	LastAppliedProjectPosition int64  `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (Plan) TableName() string { return "plans" }

// PlanRevision is one published revision of a plan. Revisions are append-only:
// publishing a new revision never rewrites an earlier one.
type PlanRevision struct {
	ProjectID                  string    `gorm:"column:project_id;type:text;primaryKey"`
	PlanID                     string    `gorm:"column:plan_id;type:text;primaryKey"`
	Revision                   int       `gorm:"column:revision;type:int;primaryKey"`
	CreatedAt                  time.Time `gorm:"column:created_at;type:timestamptz;not null"`
	CreatedByAgentID           string    `gorm:"column:created_by_agent_id;type:text;not null;default:''"`
	LastAppliedProjectPosition int64     `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (PlanRevision) TableName() string { return "plan_revisions" }

// PlanStep is one step of one plan revision. Only its state changes after
// publication, through plan.step_updated on the current revision.
type PlanStep struct {
	ProjectID                  string `gorm:"column:project_id;type:text;primaryKey"`
	PlanID                     string `gorm:"column:plan_id;type:text;primaryKey"`
	Revision                   int    `gorm:"column:revision;type:int;primaryKey"`
	StepID                     string `gorm:"column:step_id;type:text;primaryKey"`
	StepOrder                  int    `gorm:"column:step_order;type:int;not null;default:0"`
	Title                      string `gorm:"column:title;type:text;not null;default:''"`
	State                      string `gorm:"column:state;type:text;not null;default:''"`
	LastAppliedProjectPosition int64  `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (PlanStep) TableName() string { return "plan_steps" }

// WorkStep is a concrete unit of work an agent reported.
type WorkStep struct {
	ProjectID                  string     `gorm:"column:project_id;type:text;primaryKey"`
	RunID                      string     `gorm:"column:run_id;type:text;primaryKey"`
	WorkStepID                 string     `gorm:"column:work_step_id;type:text;primaryKey"`
	AgentID                    string     `gorm:"column:agent_id;type:text;not null;default:''"`
	PlanStepID                 *string    `gorm:"column:plan_step_id;type:text"`
	Title                      string     `gorm:"column:title;type:text;not null;default:''"`
	StartedAt                  time.Time  `gorm:"column:started_at;type:timestamptz;not null"`
	CompletedAt                *time.Time `gorm:"column:completed_at;type:timestamptz"`
	Summary                    *string    `gorm:"column:summary;type:text"`
	LastAppliedProjectPosition int64      `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (WorkStep) TableName() string { return "work_steps" }

// Component is one node of the *applied* architecture model. Planned changes
// never reach this table.
type Component struct {
	ProjectID                  string    `gorm:"column:project_id;type:text;primaryKey;index:idx_components_parent,priority:1"`
	ComponentID                string    `gorm:"column:component_id;type:text;primaryKey"`
	Name                       string    `gorm:"column:name;type:text;not null;default:''"`
	Kind                       string    `gorm:"column:kind;type:text;not null;default:''"`
	ParentComponentID          *string   `gorm:"column:parent_component_id;type:text;index:idx_components_parent,priority:2"`
	Description                string    `gorm:"column:description;type:text;not null;default:''"`
	Technology                 JSON      `gorm:"column:technology;type:jsonb;not null"`
	Tags                       JSON      `gorm:"column:tags;type:jsonb;not null"`
	AppliedAt                  time.Time `gorm:"column:applied_at;type:timestamptz;not null"`
	AppliedByAgentID           string    `gorm:"column:applied_by_agent_id;type:text;not null;default:''"`
	AppliedRunID               string    `gorm:"column:applied_run_id;type:text;not null;default:''"`
	LastAppliedProjectPosition int64     `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (Component) TableName() string { return "components" }

// Relationship is one typed, directed edge of the applied architecture model.
// Every message topic keeps its own row; edges are never aggregated.
type Relationship struct {
	ProjectID                  string    `gorm:"column:project_id;type:text;primaryKey;index:idx_relationships_source,priority:1;index:idx_relationships_target,priority:1"`
	RelationshipID             string    `gorm:"column:relationship_id;type:text;primaryKey"`
	SourceComponentID          string    `gorm:"column:source_component_id;type:text;not null;default:'';index:idx_relationships_source,priority:2"`
	TargetComponentID          string    `gorm:"column:target_component_id;type:text;not null;default:'';index:idx_relationships_target,priority:2"`
	Kind                       string    `gorm:"column:kind;type:text;not null;default:''"`
	Label                      string    `gorm:"column:label;type:text;not null;default:''"`
	Protocol                   string    `gorm:"column:protocol;type:text;not null;default:''"`
	Operation                  string    `gorm:"column:operation;type:text;not null;default:''"`
	Channel                    string    `gorm:"column:channel;type:text;not null;default:''"`
	AppliedAt                  time.Time `gorm:"column:applied_at;type:timestamptz;not null"`
	AppliedByAgentID           string    `gorm:"column:applied_by_agent_id;type:text;not null;default:''"`
	AppliedRunID               string    `gorm:"column:applied_run_id;type:text;not null;default:''"`
	LastAppliedProjectPosition int64     `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (Relationship) TableName() string { return "relationships" }

// ActiveChange is a reported change to the architecture model together with the
// state it is in: planned, applied or retracted.
type ActiveChange struct {
	ProjectID                  string     `gorm:"column:project_id;type:text;primaryKey;index:idx_active_changes_target,priority:1"`
	ChangeID                   string     `gorm:"column:change_id;type:text;primaryKey"`
	TargetKind                 string     `gorm:"column:target_kind;type:text;not null;default:'';index:idx_active_changes_target,priority:2"`
	TargetID                   string     `gorm:"column:target_id;type:text;not null;default:'';index:idx_active_changes_target,priority:3"`
	Operation                  string     `gorm:"column:operation;type:text;not null;default:''"`
	State                      string     `gorm:"column:state;type:text;not null;default:''"`
	RunID                      string     `gorm:"column:run_id;type:text;not null;default:''"`
	AgentID                    string     `gorm:"column:agent_id;type:text;not null;default:''"`
	PlannedAt                  *time.Time `gorm:"column:planned_at;type:timestamptz"`
	AppliedAt                  *time.Time `gorm:"column:applied_at;type:timestamptz"`
	RetractedAt                *time.Time `gorm:"column:retracted_at;type:timestamptz"`
	Snapshot                   JSON       `gorm:"column:snapshot;type:jsonb;not null"`
	LastAppliedProjectPosition int64      `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (ActiveChange) TableName() string { return "active_changes" }

// FeedbackEntry is one published, component-scoped feedback item.
type FeedbackEntry struct {
	ProjectID                  string    `gorm:"column:project_id;type:text;primaryKey"`
	FeedbackID                 string    `gorm:"column:feedback_id;type:text;primaryKey"`
	RunID                      string    `gorm:"column:run_id;type:text;not null;default:''"`
	AgentID                    string    `gorm:"column:agent_id;type:text;not null;default:''"`
	Format                     string    `gorm:"column:format;type:text;not null;default:''"`
	Title                      string    `gorm:"column:title;type:text;not null;default:''"`
	Body                       string    `gorm:"column:body;type:text;not null;default:''"`
	CreatedAt                  time.Time `gorm:"column:created_at;type:timestamptz;not null"`
	SourcePosition             int64     `gorm:"column:source_position;type:bigint;not null;default:0"`
	LastAppliedProjectPosition int64     `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (FeedbackEntry) TableName() string { return "feedback_entries" }

// Diff is one reported unified diff of exactly one repository file.
type Diff struct {
	ProjectID                  string    `gorm:"column:project_id;type:text;primaryKey"`
	DiffID                     string    `gorm:"column:diff_id;type:text;primaryKey"`
	RunID                      string    `gorm:"column:run_id;type:text;not null;default:''"`
	AgentID                    string    `gorm:"column:agent_id;type:text;not null;default:''"`
	ChangeID                   *string   `gorm:"column:change_id;type:text"`
	FilePath                   string    `gorm:"column:file_path;type:text;not null;default:''"`
	UnifiedDiff                string    `gorm:"column:unified_diff;type:text;not null;default:''"`
	CreatedAt                  time.Time `gorm:"column:created_at;type:timestamptz;not null"`
	SourcePosition             int64     `gorm:"column:source_position;type:bigint;not null;default:0"`
	LastAppliedProjectPosition int64     `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (Diff) TableName() string { return "diffs" }

// Risk is a risk as stated by the reporting agent. The system never derives,
// scores or aggregates risks on its own.
type Risk struct {
	ProjectID                  string    `gorm:"column:project_id;type:text;primaryKey"`
	RiskID                     string    `gorm:"column:risk_id;type:text;primaryKey"`
	RunID                      string    `gorm:"column:run_id;type:text;not null;default:''"`
	AgentID                    string    `gorm:"column:agent_id;type:text;not null;default:''"`
	Title                      string    `gorm:"column:title;type:text;not null;default:''"`
	Detail                     string    `gorm:"column:detail;type:text;not null;default:''"`
	Severity                   string    `gorm:"column:severity;type:text;not null;default:''"`
	CreatedAt                  time.Time `gorm:"column:created_at;type:timestamptz;not null"`
	SourcePosition             int64     `gorm:"column:source_position;type:bigint;not null;default:0"`
	LastAppliedProjectPosition int64     `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (Risk) TableName() string { return "risks" }

// Problem is a problem as stated by the reporting agent.
type Problem struct {
	ProjectID                  string    `gorm:"column:project_id;type:text;primaryKey"`
	ProblemID                  string    `gorm:"column:problem_id;type:text;primaryKey"`
	RunID                      string    `gorm:"column:run_id;type:text;not null;default:''"`
	AgentID                    string    `gorm:"column:agent_id;type:text;not null;default:''"`
	Title                      string    `gorm:"column:title;type:text;not null;default:''"`
	Detail                     string    `gorm:"column:detail;type:text;not null;default:''"`
	CreatedAt                  time.Time `gorm:"column:created_at;type:timestamptz;not null"`
	SourcePosition             int64     `gorm:"column:source_position;type:bigint;not null;default:0"`
	LastAppliedProjectPosition int64     `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (Problem) TableName() string { return "problems" }

// ---------------------------------------------------------------------------
// Component join tables
// ---------------------------------------------------------------------------

// FeedbackComponent links a feedback entry to one component.
type FeedbackComponent struct {
	ProjectID                  string `gorm:"column:project_id;type:text;primaryKey;index:idx_feedback_components_component,priority:1"`
	FeedbackID                 string `gorm:"column:feedback_id;type:text;primaryKey"`
	ComponentID                string `gorm:"column:component_id;type:text;primaryKey;index:idx_feedback_components_component,priority:2"`
	LastAppliedProjectPosition int64  `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (FeedbackComponent) TableName() string { return "feedback_components" }

// DiffComponent links a diff to one component.
type DiffComponent struct {
	ProjectID                  string `gorm:"column:project_id;type:text;primaryKey;index:idx_diff_components_component,priority:1"`
	DiffID                     string `gorm:"column:diff_id;type:text;primaryKey"`
	ComponentID                string `gorm:"column:component_id;type:text;primaryKey;index:idx_diff_components_component,priority:2"`
	LastAppliedProjectPosition int64  `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (DiffComponent) TableName() string { return "diff_components" }

// RiskComponent links a risk to one component.
type RiskComponent struct {
	ProjectID                  string `gorm:"column:project_id;type:text;primaryKey;index:idx_risk_components_component,priority:1"`
	RiskID                     string `gorm:"column:risk_id;type:text;primaryKey"`
	ComponentID                string `gorm:"column:component_id;type:text;primaryKey;index:idx_risk_components_component,priority:2"`
	LastAppliedProjectPosition int64  `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (RiskComponent) TableName() string { return "risk_components" }

// ProblemComponent links a problem to one component.
type ProblemComponent struct {
	ProjectID                  string `gorm:"column:project_id;type:text;primaryKey;index:idx_problem_components_component,priority:1"`
	ProblemID                  string `gorm:"column:problem_id;type:text;primaryKey"`
	ComponentID                string `gorm:"column:component_id;type:text;primaryKey;index:idx_problem_components_component,priority:2"`
	LastAppliedProjectPosition int64  `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (ProblemComponent) TableName() string { return "problem_components" }

// WorkStepComponent links a work step to one component.
type WorkStepComponent struct {
	ProjectID                  string `gorm:"column:project_id;type:text;primaryKey;index:idx_work_step_components_component,priority:1"`
	WorkStepID                 string `gorm:"column:work_step_id;type:text;primaryKey"`
	ComponentID                string `gorm:"column:component_id;type:text;primaryKey;index:idx_work_step_components_component,priority:2"`
	LastAppliedProjectPosition int64  `gorm:"column:last_applied_project_position;type:bigint;not null;default:0"`
}

// TableName pins the table name.
func (WorkStepComponent) TableName() string { return "work_step_components" }
