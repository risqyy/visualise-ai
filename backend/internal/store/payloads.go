package store

import (
	"encoding/json"
	"fmt"
)

// The closed v0 event catalogue. The contract in api/openapi.yaml is the
// authority; the store must be able to project every one of these types.
const (
	TypeAgentStarted                  = "agent.started"
	TypeAgentStatusReported           = "agent.status_reported"
	TypeAgentProgressReported         = "agent.progress_reported"
	TypeAgentFinished                 = "agent.finished"
	TypePlanPublished                 = "plan.published"
	TypePlanStepUpdated               = "plan.step_updated"
	TypeWorkStepStarted               = "work.step_started"
	TypeWorkStepCompleted             = "work.step_completed"
	TypeFeedbackPublished             = "feedback.published"
	TypeArchitectureSnapshotPublished = "architecture.snapshot_published"
	TypeComponentChangePlanned        = "component.change_planned"
	TypeComponentChangeApplied        = "component.change_applied"
	TypeRelationshipChangePlanned     = "relationship.change_planned"
	TypeRelationshipChangeApplied     = "relationship.change_applied"
	TypeDiffReported                  = "diff.reported"
	TypeRiskReported                  = "risk.reported"
	TypeProblemReported               = "problem.reported"
	TypeCorrectionIssued              = "correction.issued"
	TypeRetractionIssued              = "retraction.issued"
	TypeRunFinished                   = "run.finished"
)

// Values of the change lifecycle kept in ActiveChange.
const (
	ChangeStatePlanned   = "planned"
	ChangeStateApplied   = "applied"
	ChangeStateRetracted = "retracted"

	ChangeTargetComponent    = "component"
	ChangeTargetRelationship = "relationship"

	OperationAdd    = "add"
	OperationModify = "modify"
	OperationRemove = "remove"
)

// Kinds stored in EventCorrection.
const (
	CorrectionKindCorrection = "correction"
	CorrectionKindRetraction = "retraction"
)

// roleOrchestrator marks the agent that owns a run.
const roleOrchestrator = "orchestrator"

// EventTypes lists the closed v0 catalogue in contract order.
func EventTypes() []string {
	return []string{
		TypeAgentStarted,
		TypeAgentStatusReported,
		TypeAgentProgressReported,
		TypeAgentFinished,
		TypePlanPublished,
		TypePlanStepUpdated,
		TypeWorkStepStarted,
		TypeWorkStepCompleted,
		TypeFeedbackPublished,
		TypeArchitectureSnapshotPublished,
		TypeComponentChangePlanned,
		TypeComponentChangeApplied,
		TypeRelationshipChangePlanned,
		TypeRelationshipChangeApplied,
		TypeDiffReported,
		TypeRiskReported,
		TypeProblemReported,
		TypeCorrectionIssued,
		TypeRetractionIssued,
		TypeRunFinished,
	}
}

// ---------------------------------------------------------------------------
// Payload shapes
//
// These mirror the payload schemas of the contract. Validating them is the job
// of the ingestion layer; the store only needs to read the fields it projects.
// ---------------------------------------------------------------------------

type componentDescriptor struct {
	ComponentID       string          `json:"componentId"`
	Name              string          `json:"name"`
	Kind              string          `json:"kind"`
	ParentComponentID *string         `json:"parentComponentId"`
	Description       string          `json:"description"`
	Technology        json.RawMessage `json:"technology"`
	Tags              json.RawMessage `json:"tags"`
}

type relationshipDescriptor struct {
	RelationshipID    string `json:"relationshipId"`
	SourceComponentID string `json:"sourceComponentId"`
	TargetComponentID string `json:"targetComponentId"`
	Kind              string `json:"kind"`
	Label             string `json:"label"`
	Protocol          string `json:"protocol"`
	Operation         string `json:"operation"`
	Channel           string `json:"channel"`
}

type planStepDescriptor struct {
	StepID       string   `json:"stepId"`
	Order        int      `json:"order"`
	Title        string   `json:"title"`
	State        string   `json:"state"`
	ComponentIDs []string `json:"componentIds"`
}

type agentStartedPayload struct {
	Role         string   `json:"role"`
	DisplayName  string   `json:"displayName"`
	AssignedTask string   `json:"assignedTask"`
	Capabilities []string `json:"capabilities"`
}

type agentStatusReportedPayload struct {
	Status string `json:"status"`
	Note   string `json:"note"`
}

type agentProgressReportedPayload struct {
	Percent int    `json:"percent"`
	Scope   string `json:"scope"`
	Basis   string `json:"basis"`
	Note    string `json:"note"`
}

type agentFinishedPayload struct {
	Outcome string `json:"outcome"`
	Summary string `json:"summary"`
}

type planPublishedPayload struct {
	PlanID   string               `json:"planId"`
	Revision int                  `json:"revision"`
	Steps    []planStepDescriptor `json:"steps"`
}

type planStepUpdatedPayload struct {
	PlanID string `json:"planId"`
	StepID string `json:"stepId"`
	State  string `json:"state"`
	Note   string `json:"note"`
}

type workStepStartedPayload struct {
	WorkStepID   string   `json:"workStepId"`
	Title        string   `json:"title"`
	ComponentIDs []string `json:"componentIds"`
	PlanStepID   *string  `json:"planStepId"`
}

type workStepCompletedPayload struct {
	WorkStepID string `json:"workStepId"`
	Summary    string `json:"summary"`
}

type feedbackPublishedPayload struct {
	FeedbackID   string   `json:"feedbackId"`
	ComponentIDs []string `json:"componentIds"`
	Format       string   `json:"format"`
	Body         string   `json:"body"`
	Title        string   `json:"title"`
}

type architectureSnapshotPayload struct {
	SnapshotID    string                   `json:"snapshotId"`
	Components    []componentDescriptor    `json:"components"`
	Relationships []relationshipDescriptor `json:"relationships"`
}

// componentChangePayload covers both component.change_planned and
// component.change_applied: only the planned variant carries a rationale, and
// only the applied variant may omit changeId. The descriptor stays raw so the
// reported document can be stored verbatim in active_changes.snapshot.
type componentChangePayload struct {
	ChangeID  *string         `json:"changeId"`
	Operation string          `json:"operation"`
	Component json.RawMessage `json:"component"`
	Rationale string          `json:"rationale"`
}

type relationshipChangePayload struct {
	ChangeID     *string         `json:"changeId"`
	Operation    string          `json:"operation"`
	Relationship json.RawMessage `json:"relationship"`
	Rationale    string          `json:"rationale"`
}

type diffReportedPayload struct {
	DiffID       string   `json:"diffId"`
	ChangeID     *string  `json:"changeId"`
	ComponentIDs []string `json:"componentIds"`
	FilePath     string   `json:"filePath"`
	UnifiedDiff  string   `json:"unifiedDiff"`
}

type riskReportedPayload struct {
	RiskID       string   `json:"riskId"`
	ComponentIDs []string `json:"componentIds"`
	Title        string   `json:"title"`
	Detail       string   `json:"detail"`
	Severity     string   `json:"severity"`
}

type problemReportedPayload struct {
	ProblemID    string   `json:"problemId"`
	ComponentIDs []string `json:"componentIds"`
	Title        string   `json:"title"`
	Detail       string   `json:"detail"`
}

type correctionIssuedPayload struct {
	CorrectsClientEventID string          `json:"correctsClientEventId"`
	Reason                string          `json:"reason"`
	CorrectedType         string          `json:"correctedType"`
	CorrectedPayload      json.RawMessage `json:"correctedPayload"`
}

type retractionIssuedPayload struct {
	RetractsClientEventID string `json:"retractsClientEventId"`
	Reason                string `json:"reason"`
}

type runFinishedPayload struct {
	Outcome string `json:"outcome"`
	Summary string `json:"summary"`
}

// decodePayload reads one payload document into target.
func decodePayload(raw []byte, target any) error {
	if len(raw) == 0 {
		return fmt.Errorf("store: empty payload for %T", target)
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("store: decoding payload into %T: %w", target, err)
	}
	return nil
}
