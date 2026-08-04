package store

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Projector advances the normalised read models for one appended event.
//
// It is deliberately total over the closed v0 catalogue: an unknown type is an
// error rather than a silent no-op, so a catalogue extension cannot slip
// through unprojected.
type Projector struct{}

// NewProjector returns the projector used by a Store.
func NewProjector() *Projector { return &Projector{} }

// maxCorrectionDepth bounds correction handling. A correction restates the
// content of one earlier event; a correction of a correction is not projected
// further, it is only recorded in event_corrections.
const maxCorrectionDepth = 1

// Apply projects one event. It runs inside the append transaction, so any error
// rolls back the event together with every projection it had already written.
func (p *Projector) Apply(tx *gorm.DB, ev *Event) error {
	if err := advanceProject(tx, ev); err != nil {
		return err
	}
	if err := ensureRun(tx, ev); err != nil {
		return err
	}
	if err := touchAgent(tx, ev); err != nil {
		return err
	}
	return p.applyPayload(tx, ev, ev.Type, ev.Payload, 0)
}

func (p *Projector) applyPayload(tx *gorm.DB, ev *Event, evType string, payload []byte, depth int) error {
	switch evType {
	case TypeAgentStarted:
		return applyAgentStarted(tx, ev, payload)
	case TypeAgentStatusReported:
		return applyAgentStatusReported(tx, ev, payload)
	case TypeAgentProgressReported:
		return applyAgentProgressReported(tx, ev, payload)
	case TypeAgentFinished:
		return applyAgentFinished(tx, ev, payload)
	case TypePlanPublished:
		return applyPlanPublished(tx, ev, payload)
	case TypePlanStepUpdated:
		return applyPlanStepUpdated(tx, ev, payload)
	case TypeWorkStepStarted:
		return applyWorkStepStarted(tx, ev, payload)
	case TypeWorkStepCompleted:
		return applyWorkStepCompleted(tx, ev, payload)
	case TypeFeedbackPublished:
		return applyFeedbackPublished(tx, ev, payload)
	case TypeArchitectureSnapshotPublished:
		return applyArchitectureSnapshot(tx, ev, payload)
	case TypeComponentChangePlanned:
		return applyComponentChangePlanned(tx, ev, payload)
	case TypeComponentChangeApplied:
		return applyComponentChangeApplied(tx, ev, payload)
	case TypeRelationshipChangePlanned:
		return applyRelationshipChangePlanned(tx, ev, payload)
	case TypeRelationshipChangeApplied:
		return applyRelationshipChangeApplied(tx, ev, payload)
	case TypeDiffReported:
		return applyDiffReported(tx, ev, payload)
	case TypeRiskReported:
		return applyRiskReported(tx, ev, payload)
	case TypeProblemReported:
		return applyProblemReported(tx, ev, payload)
	case TypeCorrectionIssued:
		return p.applyCorrectionIssued(tx, ev, payload, depth)
	case TypeRetractionIssued:
		return applyRetractionIssued(tx, ev, payload, depth)
	case TypeRunFinished:
		return applyRunFinished(tx, ev, payload)
	default:
		return fmt.Errorf("store: no projection for event type %q", evType)
	}
}

// ---------------------------------------------------------------------------
// Shared projections
// ---------------------------------------------------------------------------

// advanceProject moves the project head to the committed event.
func advanceProject(tx *gorm.DB, ev *Event) error {
	return tx.Model(&Project{}).
		Where("project_id = ?", ev.ProjectID).
		Updates(map[string]any{
			"last_event_at":                 ev.OccurredAt,
			"last_position":                 ev.Position,
			"last_applied_project_position": ev.Position,
		}).Error
}

// ensureRun records that the run exists. A run is open from the moment it is
// first seen and stays open until an explicit run.finished closes it — silence
// never produces a terminal state.
func ensureRun(tx *gorm.DB, ev *Event) error {
	run := &Run{
		ProjectID:                  ev.ProjectID,
		RunID:                      ev.RunID,
		StartedAt:                  ev.OccurredAt,
		IsOpen:                     true,
		LastAppliedProjectPosition: ev.Position,
	}
	return upsert(tx, run, runKey, []string{"last_applied_project_position"})
}

// touchAgent records activity of the reporting agent, but never invents a row:
// an agent exists once it has reported agent.started.
func touchAgent(tx *gorm.DB, ev *Event) error {
	return tx.Model(&Agent{}).
		Where("project_id = ? AND run_id = ? AND agent_id = ?", ev.ProjectID, ev.RunID, ev.AgentID).
		Updates(map[string]any{
			"last_event_at":                 ev.OccurredAt,
			"last_applied_project_position": ev.Position,
		}).Error
}

// ---------------------------------------------------------------------------
// Agent projections
// ---------------------------------------------------------------------------

func applyAgentStarted(tx *gorm.DB, ev *Event, payload []byte) error {
	var p agentStartedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}

	agent := &Agent{
		ProjectID:                  ev.ProjectID,
		RunID:                      ev.RunID,
		AgentID:                    ev.AgentID,
		ParentAgentID:              ev.ParentAgentID,
		Role:                       p.Role,
		DisplayName:                p.DisplayName,
		AssignedTask:               p.AssignedTask,
		StartedAt:                  ev.OccurredAt,
		LastEventAt:                ev.OccurredAt,
		LastAppliedProjectPosition: ev.Position,
	}
	// status, progress and outcome are left untouched: they are only ever
	// written by the event that explicitly reports them.
	if err := upsert(tx, agent, agentKey, []string{
		"parent_agent_id", "role", "display_name", "assigned_task",
		"started_at", "last_event_at", "last_applied_project_position",
	}); err != nil {
		return err
	}

	if p.Role != roleOrchestrator || ev.ParentAgentID != nil {
		return nil
	}
	// A root orchestrator opens the run and becomes the project's current run.
	if err := tx.Model(&Run{}).
		Where("project_id = ? AND run_id = ?", ev.ProjectID, ev.RunID).
		Updates(map[string]any{
			"root_agent_id":                 ev.AgentID,
			"started_at":                    ev.OccurredAt,
			"last_applied_project_position": ev.Position,
		}).Error; err != nil {
		return err
	}
	return tx.Model(&Project{}).
		Where("project_id = ?", ev.ProjectID).
		Update("current_run_id", ev.RunID).Error
}

func applyAgentStatusReported(tx *gorm.DB, ev *Event, payload []byte) error {
	var p agentStatusReportedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}
	agent := &Agent{
		ProjectID:                  ev.ProjectID,
		RunID:                      ev.RunID,
		AgentID:                    ev.AgentID,
		ParentAgentID:              ev.ParentAgentID,
		Status:                     p.Status,
		StatusNote:                 p.Note,
		StartedAt:                  ev.OccurredAt,
		LastEventAt:                ev.OccurredAt,
		LastAppliedProjectPosition: ev.Position,
	}
	return upsert(tx, agent, agentKey, []string{
		"status", "status_note", "last_event_at", "last_applied_project_position",
	})
}

func applyAgentProgressReported(tx *gorm.DB, ev *Event, payload []byte) error {
	var p agentProgressReportedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}
	percent := p.Percent
	agent := &Agent{
		ProjectID:                  ev.ProjectID,
		RunID:                      ev.RunID,
		AgentID:                    ev.AgentID,
		ParentAgentID:              ev.ParentAgentID,
		ProgressPercent:            &percent,
		ProgressScope:              nonEmpty(p.Scope),
		ProgressBasis:              nonEmpty(p.Basis),
		StartedAt:                  ev.OccurredAt,
		LastEventAt:                ev.OccurredAt,
		LastAppliedProjectPosition: ev.Position,
	}
	return upsert(tx, agent, agentKey, []string{
		"progress_percent", "progress_scope", "progress_basis",
		"last_event_at", "last_applied_project_position",
	})
}

func applyAgentFinished(tx *gorm.DB, ev *Event, payload []byte) error {
	var p agentFinishedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}
	agent := &Agent{
		ProjectID:                  ev.ProjectID,
		RunID:                      ev.RunID,
		AgentID:                    ev.AgentID,
		ParentAgentID:              ev.ParentAgentID,
		FinishedOutcome:            nonEmpty(p.Outcome),
		StartedAt:                  ev.OccurredAt,
		LastEventAt:                ev.OccurredAt,
		LastAppliedProjectPosition: ev.Position,
	}
	// An agent finishing does not finish its run, and it does not overwrite the
	// last explicitly reported status either.
	return upsert(tx, agent, agentKey, []string{
		"finished_outcome", "last_event_at", "last_applied_project_position",
	})
}

// ---------------------------------------------------------------------------
// Plan projections
// ---------------------------------------------------------------------------

func applyPlanPublished(tx *gorm.DB, ev *Event, payload []byte) error {
	var p planPublishedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}

	plan := &Plan{
		ProjectID:                  ev.ProjectID,
		RunID:                      ev.RunID,
		PlanID:                     p.PlanID,
		AgentID:                    ev.AgentID,
		CurrentRevision:            p.Revision,
		LastAppliedProjectPosition: ev.Position,
	}
	if err := upsert(tx, plan, planKey, []string{
		"agent_id", "current_revision", "last_applied_project_position",
	}); err != nil {
		return err
	}

	// Revisions are append-only: an already published revision and its steps
	// are never rewritten, they stay inspectable exactly as reported.
	revision := &PlanRevision{
		ProjectID:                  ev.ProjectID,
		PlanID:                     p.PlanID,
		Revision:                   p.Revision,
		CreatedAt:                  ev.OccurredAt,
		CreatedByAgentID:           ev.AgentID,
		LastAppliedProjectPosition: ev.Position,
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(revision).Error; err != nil {
		return err
	}

	for _, step := range p.Steps {
		row := &PlanStep{
			ProjectID:                  ev.ProjectID,
			PlanID:                     p.PlanID,
			Revision:                   p.Revision,
			StepID:                     step.StepID,
			StepOrder:                  step.Order,
			Title:                      step.Title,
			State:                      step.State,
			LastAppliedProjectPosition: ev.Position,
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(row).Error; err != nil {
			return err
		}
	}
	return nil
}

func applyPlanStepUpdated(tx *gorm.DB, ev *Event, payload []byte) error {
	var p planStepUpdatedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}

	var plan Plan
	err := tx.Where("project_id = ? AND run_id = ? AND plan_id = ?", ev.ProjectID, ev.RunID, p.PlanID).
		Take(&plan).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// No revision has been published yet, so there is no step to update.
		// The ingestion layer rejects this case; the store stays a no-op.
		return nil
	}
	if err != nil {
		return err
	}

	// The update targets the currently published revision only — earlier
	// revisions keep the state they were published with.
	if err := tx.Model(&PlanStep{}).
		Where("project_id = ? AND plan_id = ? AND revision = ? AND step_id = ?",
			ev.ProjectID, p.PlanID, plan.CurrentRevision, p.StepID).
		Updates(map[string]any{
			"state":                         p.State,
			"last_applied_project_position": ev.Position,
		}).Error; err != nil {
		return err
	}

	return tx.Model(&Plan{}).
		Where("project_id = ? AND run_id = ? AND plan_id = ?", ev.ProjectID, ev.RunID, p.PlanID).
		Update("last_applied_project_position", ev.Position).Error
}

// ---------------------------------------------------------------------------
// Work step projections
// ---------------------------------------------------------------------------

func applyWorkStepStarted(tx *gorm.DB, ev *Event, payload []byte) error {
	var p workStepStartedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}

	step := &WorkStep{
		ProjectID:                  ev.ProjectID,
		RunID:                      ev.RunID,
		WorkStepID:                 p.WorkStepID,
		AgentID:                    ev.AgentID,
		PlanStepID:                 p.PlanStepID,
		Title:                      p.Title,
		StartedAt:                  ev.OccurredAt,
		LastAppliedProjectPosition: ev.Position,
	}
	if err := upsert(tx, step, workStepKey, []string{
		"agent_id", "plan_step_id", "title", "started_at", "last_applied_project_position",
	}); err != nil {
		return err
	}

	for _, id := range normaliseIDs(p.ComponentIDs) {
		link := &WorkStepComponent{
			ProjectID:                  ev.ProjectID,
			WorkStepID:                 p.WorkStepID,
			ComponentID:                id,
			LastAppliedProjectPosition: ev.Position,
		}
		if err := upsert(tx, link, workStepComponentKey, []string{"last_applied_project_position"}); err != nil {
			return err
		}
	}
	return nil
}

func applyWorkStepCompleted(tx *gorm.DB, ev *Event, payload []byte) error {
	var p workStepCompletedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}
	completedAt := ev.OccurredAt
	step := &WorkStep{
		ProjectID:                  ev.ProjectID,
		RunID:                      ev.RunID,
		WorkStepID:                 p.WorkStepID,
		AgentID:                    ev.AgentID,
		StartedAt:                  ev.OccurredAt,
		CompletedAt:                &completedAt,
		Summary:                    nonEmpty(p.Summary),
		LastAppliedProjectPosition: ev.Position,
	}
	return upsert(tx, step, workStepKey, []string{
		"completed_at", "summary", "last_applied_project_position",
	})
}

// ---------------------------------------------------------------------------
// Feedback, diff, risk and problem projections
// ---------------------------------------------------------------------------

func applyFeedbackPublished(tx *gorm.DB, ev *Event, payload []byte) error {
	var p feedbackPublishedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}

	entry := &FeedbackEntry{
		ProjectID:                  ev.ProjectID,
		FeedbackID:                 p.FeedbackID,
		RunID:                      ev.RunID,
		AgentID:                    ev.AgentID,
		Format:                     p.Format,
		Title:                      p.Title,
		Body:                       p.Body,
		CreatedAt:                  ev.OccurredAt,
		SourcePosition:             ev.Position,
		LastAppliedProjectPosition: ev.Position,
	}
	if err := upsert(tx, entry, feedbackKey, []string{
		"run_id", "agent_id", "format", "title", "body",
		"created_at", "source_position", "last_applied_project_position",
	}); err != nil {
		return err
	}

	for _, id := range normaliseIDs(p.ComponentIDs) {
		link := &FeedbackComponent{
			ProjectID:                  ev.ProjectID,
			FeedbackID:                 p.FeedbackID,
			ComponentID:                id,
			LastAppliedProjectPosition: ev.Position,
		}
		if err := upsert(tx, link, feedbackComponentKey, []string{"last_applied_project_position"}); err != nil {
			return err
		}
	}
	return nil
}

func applyDiffReported(tx *gorm.DB, ev *Event, payload []byte) error {
	var p diffReportedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}

	diff := &Diff{
		ProjectID:                  ev.ProjectID,
		DiffID:                     p.DiffID,
		RunID:                      ev.RunID,
		AgentID:                    ev.AgentID,
		ChangeID:                   p.ChangeID,
		FilePath:                   p.FilePath,
		UnifiedDiff:                p.UnifiedDiff,
		CreatedAt:                  ev.OccurredAt,
		SourcePosition:             ev.Position,
		LastAppliedProjectPosition: ev.Position,
	}
	if err := upsert(tx, diff, diffKey, []string{
		"run_id", "agent_id", "change_id", "file_path", "unified_diff",
		"created_at", "source_position", "last_applied_project_position",
	}); err != nil {
		return err
	}

	for _, id := range normaliseIDs(p.ComponentIDs) {
		link := &DiffComponent{
			ProjectID:                  ev.ProjectID,
			DiffID:                     p.DiffID,
			ComponentID:                id,
			LastAppliedProjectPosition: ev.Position,
		}
		if err := upsert(tx, link, diffComponentKey, []string{"last_applied_project_position"}); err != nil {
			return err
		}
	}
	return nil
}

func applyRiskReported(tx *gorm.DB, ev *Event, payload []byte) error {
	var p riskReportedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}

	risk := &Risk{
		ProjectID:                  ev.ProjectID,
		RiskID:                     p.RiskID,
		RunID:                      ev.RunID,
		AgentID:                    ev.AgentID,
		Title:                      p.Title,
		Detail:                     p.Detail,
		Severity:                   p.Severity,
		CreatedAt:                  ev.OccurredAt,
		SourcePosition:             ev.Position,
		LastAppliedProjectPosition: ev.Position,
	}
	if err := upsert(tx, risk, riskKey, []string{
		"run_id", "agent_id", "title", "detail", "severity",
		"created_at", "source_position", "last_applied_project_position",
	}); err != nil {
		return err
	}

	for _, id := range normaliseIDs(p.ComponentIDs) {
		link := &RiskComponent{
			ProjectID:                  ev.ProjectID,
			RiskID:                     p.RiskID,
			ComponentID:                id,
			LastAppliedProjectPosition: ev.Position,
		}
		if err := upsert(tx, link, riskComponentKey, []string{"last_applied_project_position"}); err != nil {
			return err
		}
	}
	return nil
}

func applyProblemReported(tx *gorm.DB, ev *Event, payload []byte) error {
	var p problemReportedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}

	problem := &Problem{
		ProjectID:                  ev.ProjectID,
		ProblemID:                  p.ProblemID,
		RunID:                      ev.RunID,
		AgentID:                    ev.AgentID,
		Title:                      p.Title,
		Detail:                     p.Detail,
		CreatedAt:                  ev.OccurredAt,
		SourcePosition:             ev.Position,
		LastAppliedProjectPosition: ev.Position,
	}
	if err := upsert(tx, problem, problemKey, []string{
		"run_id", "agent_id", "title", "detail",
		"created_at", "source_position", "last_applied_project_position",
	}); err != nil {
		return err
	}

	for _, id := range normaliseIDs(p.ComponentIDs) {
		link := &ProblemComponent{
			ProjectID:                  ev.ProjectID,
			ProblemID:                  p.ProblemID,
			ComponentID:                id,
			LastAppliedProjectPosition: ev.Position,
		}
		if err := upsert(tx, link, problemComponentKey, []string{"last_applied_project_position"}); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Architecture projections
// ---------------------------------------------------------------------------

// applyArchitectureSnapshot replaces the applied model wholesale.
//
// The contract defines a snapshot as authoritative: components and
// relationships missing from it no longer exist. Deleting and re-inserting
// inside the append transaction is what makes that atomic — readers never see
// a half-replaced model.
func applyArchitectureSnapshot(tx *gorm.DB, ev *Event, payload []byte) error {
	var p architectureSnapshotPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}

	if err := tx.Where("project_id = ?", ev.ProjectID).Delete(&Component{}).Error; err != nil {
		return err
	}
	if err := tx.Where("project_id = ?", ev.ProjectID).Delete(&Relationship{}).Error; err != nil {
		return err
	}

	for _, component := range p.Components {
		if err := writeComponent(tx, ev, component); err != nil {
			return err
		}
	}
	for _, relationship := range p.Relationships {
		if err := writeRelationship(tx, ev, relationship); err != nil {
			return err
		}
	}
	return nil
}

func applyComponentChangePlanned(tx *gorm.DB, ev *Event, payload []byte) error {
	component, change, err := decodeComponentChange(payload)
	if err != nil {
		return err
	}
	// A planned change is a proposal: it must not touch the applied model.
	return recordPlannedChange(tx, ev, changeIDOrEventID(change.ChangeID, ev),
		ChangeTargetComponent, component.ComponentID, change.Operation, change.Component)
}

func applyComponentChangeApplied(tx *gorm.DB, ev *Event, payload []byte) error {
	component, change, err := decodeComponentChange(payload)
	if err != nil {
		return err
	}

	switch change.Operation {
	case OperationRemove:
		if err := tx.Where("project_id = ? AND component_id = ?", ev.ProjectID, component.ComponentID).
			Delete(&Component{}).Error; err != nil {
			return err
		}
	default: // add and modify both merge the reported descriptor
		if err := writeComponent(tx, ev, component); err != nil {
			return err
		}
	}

	return recordAppliedChange(tx, ev, changeIDOrEventID(change.ChangeID, ev),
		ChangeTargetComponent, component.ComponentID, change.Operation, change.Component)
}

func applyRelationshipChangePlanned(tx *gorm.DB, ev *Event, payload []byte) error {
	relationship, change, err := decodeRelationshipChange(payload)
	if err != nil {
		return err
	}
	return recordPlannedChange(tx, ev, changeIDOrEventID(change.ChangeID, ev),
		ChangeTargetRelationship, relationship.RelationshipID, change.Operation, change.Relationship)
}

func applyRelationshipChangeApplied(tx *gorm.DB, ev *Event, payload []byte) error {
	relationship, change, err := decodeRelationshipChange(payload)
	if err != nil {
		return err
	}

	switch change.Operation {
	case OperationRemove:
		if err := tx.Where("project_id = ? AND relationship_id = ?", ev.ProjectID, relationship.RelationshipID).
			Delete(&Relationship{}).Error; err != nil {
			return err
		}
	default:
		if err := writeRelationship(tx, ev, relationship); err != nil {
			return err
		}
	}

	return recordAppliedChange(tx, ev, changeIDOrEventID(change.ChangeID, ev),
		ChangeTargetRelationship, relationship.RelationshipID, change.Operation, change.Relationship)
}

// ---------------------------------------------------------------------------
// Correction, retraction and run projections
// ---------------------------------------------------------------------------

func (p *Projector) applyCorrectionIssued(tx *gorm.DB, ev *Event, payload []byte, depth int) error {
	var corrected correctionIssuedPayload
	if err := decodePayload(payload, &corrected); err != nil {
		return err
	}

	correctedType := corrected.CorrectedType
	record := &EventCorrection{
		ProjectID:           ev.ProjectID,
		Position:            ev.Position,
		Kind:                CorrectionKindCorrection,
		TargetClientEventID: corrected.CorrectsClientEventID,
		Reason:              corrected.Reason,
		CorrectedType:       nonEmpty(correctedType),
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(record).Error; err != nil {
		return err
	}

	if depth >= maxCorrectionDepth {
		return nil
	}
	// The original event stays in the log untouched; the read models show the
	// corrected content instead.
	return p.applyPayload(tx, ev, correctedType, corrected.CorrectedPayload, depth+1)
}

// applyRetractionIssued withdraws a previously announced change. It deletes
// nothing from the log and rewrites no history: it only marks the change the
// retracted event had announced.
func applyRetractionIssued(tx *gorm.DB, ev *Event, payload []byte, depth int) error {
	var p retractionIssuedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}

	record := &EventCorrection{
		ProjectID:           ev.ProjectID,
		Position:            ev.Position,
		Kind:                CorrectionKindRetraction,
		TargetClientEventID: p.RetractsClientEventID,
		Reason:              p.Reason,
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(record).Error; err != nil {
		return err
	}
	if depth >= maxCorrectionDepth {
		return nil
	}

	target, err := findByClientEventID(tx, ev.ProjectID, p.RetractsClientEventID)
	if err != nil || target == nil {
		return err
	}
	changeID, err := changeIDOf(target)
	if err != nil || changeID == "" {
		return err
	}

	retractedAt := ev.OccurredAt
	return tx.Model(&ActiveChange{}).
		Where("project_id = ? AND change_id = ?", ev.ProjectID, changeID).
		Updates(map[string]any{
			"state":                         ChangeStateRetracted,
			"retracted_at":                  retractedAt,
			"last_applied_project_position": ev.Position,
		}).Error
}

func applyRunFinished(tx *gorm.DB, ev *Event, payload []byte) error {
	var p runFinishedPayload
	if err := decodePayload(payload, &p); err != nil {
		return err
	}
	finishedAt := ev.OccurredAt
	return tx.Model(&Run{}).
		Where("project_id = ? AND run_id = ?", ev.ProjectID, ev.RunID).
		Updates(map[string]any{
			"is_open":                       false,
			"finished_at":                   finishedAt,
			"outcome":                       p.Outcome,
			"last_applied_project_position": ev.Position,
		}).Error
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeComponent(tx *gorm.DB, ev *Event, c componentDescriptor) error {
	row := &Component{
		ProjectID:                  ev.ProjectID,
		ComponentID:                c.ComponentID,
		Name:                       c.Name,
		Kind:                       c.Kind,
		ParentComponentID:          c.ParentComponentID,
		Description:                c.Description,
		Technology:                 orEmpty(c.Technology, emptyObject),
		Tags:                       orEmpty(c.Tags, emptyArray),
		AppliedAt:                  ev.OccurredAt,
		AppliedByAgentID:           ev.AgentID,
		AppliedRunID:               ev.RunID,
		LastAppliedProjectPosition: ev.Position,
	}
	return upsert(tx, row, componentKey, []string{
		"name", "kind", "parent_component_id", "description", "technology", "tags",
		"applied_at", "applied_by_agent_id", "applied_run_id", "last_applied_project_position",
	})
}

func writeRelationship(tx *gorm.DB, ev *Event, r relationshipDescriptor) error {
	row := &Relationship{
		ProjectID:                  ev.ProjectID,
		RelationshipID:             r.RelationshipID,
		SourceComponentID:          r.SourceComponentID,
		TargetComponentID:          r.TargetComponentID,
		Kind:                       r.Kind,
		Label:                      r.Label,
		Protocol:                   r.Protocol,
		Operation:                  r.Operation,
		Channel:                    r.Channel,
		AppliedAt:                  ev.OccurredAt,
		AppliedByAgentID:           ev.AgentID,
		AppliedRunID:               ev.RunID,
		LastAppliedProjectPosition: ev.Position,
	}
	return upsert(tx, row, relationshipKey, []string{
		"source_component_id", "target_component_id", "kind", "label",
		"protocol", "operation", "channel",
		"applied_at", "applied_by_agent_id", "applied_run_id", "last_applied_project_position",
	})
}

// recordPlannedChange stores a proposal. state, applied_at and retracted_at are
// left out of the update set, so a planned event arriving after the applied one
// cannot reopen a change that is already closed.
func recordPlannedChange(tx *gorm.DB, ev *Event, changeID, targetKind, targetID, operation string, snapshot []byte) error {
	plannedAt := ev.OccurredAt
	row := &ActiveChange{
		ProjectID:                  ev.ProjectID,
		ChangeID:                   changeID,
		TargetKind:                 targetKind,
		TargetID:                   targetID,
		Operation:                  operation,
		State:                      ChangeStatePlanned,
		RunID:                      ev.RunID,
		AgentID:                    ev.AgentID,
		PlannedAt:                  &plannedAt,
		Snapshot:                   orEmpty(snapshot, emptyObject),
		LastAppliedProjectPosition: ev.Position,
	}
	return upsert(tx, row, changeKey, []string{
		"target_kind", "target_id", "operation", "run_id", "agent_id",
		"planned_at", "snapshot", "last_applied_project_position",
	})
}

// recordAppliedChange closes a change. It creates the row when the change was
// never planned or its changeId is unknown.
func recordAppliedChange(tx *gorm.DB, ev *Event, changeID, targetKind, targetID, operation string, snapshot []byte) error {
	appliedAt := ev.OccurredAt
	row := &ActiveChange{
		ProjectID:                  ev.ProjectID,
		ChangeID:                   changeID,
		TargetKind:                 targetKind,
		TargetID:                   targetID,
		Operation:                  operation,
		State:                      ChangeStateApplied,
		RunID:                      ev.RunID,
		AgentID:                    ev.AgentID,
		AppliedAt:                  &appliedAt,
		Snapshot:                   orEmpty(snapshot, emptyObject),
		LastAppliedProjectPosition: ev.Position,
	}
	return upsert(tx, row, changeKey, []string{
		"target_kind", "target_id", "operation", "state", "run_id", "agent_id",
		"applied_at", "snapshot", "last_applied_project_position",
	})
}

func decodeComponentChange(payload []byte) (componentDescriptor, componentChangePayload, error) {
	var change componentChangePayload
	if err := decodePayload(payload, &change); err != nil {
		return componentDescriptor{}, change, err
	}
	var component componentDescriptor
	if err := decodePayload(change.Component, &component); err != nil {
		return componentDescriptor{}, change, err
	}
	return component, change, nil
}

func decodeRelationshipChange(payload []byte) (relationshipDescriptor, relationshipChangePayload, error) {
	var change relationshipChangePayload
	if err := decodePayload(payload, &change); err != nil {
		return relationshipDescriptor{}, change, err
	}
	var relationship relationshipDescriptor
	if err := decodePayload(change.Relationship, &relationship); err != nil {
		return relationshipDescriptor{}, change, err
	}
	return relationship, change, nil
}

// changeIDOrEventID falls back to the server event id for an unplanned change,
// which the contract allows to omit changeId. The event id is stable, so the
// change keeps one identity across replays.
func changeIDOrEventID(changeID *string, ev *Event) string {
	if changeID != nil && *changeID != "" {
		return *changeID
	}
	return ev.ID
}

// changeIDOf reports which change a stored event announced, or "" when the
// event announced none.
func changeIDOf(ev *Event) (string, error) {
	switch ev.Type {
	case TypeComponentChangePlanned, TypeComponentChangeApplied:
		var change componentChangePayload
		if err := decodePayload(ev.Payload, &change); err != nil {
			return "", err
		}
		return changeIDOrEventID(change.ChangeID, ev), nil
	case TypeRelationshipChangePlanned, TypeRelationshipChangeApplied:
		var change relationshipChangePayload
		if err := decodePayload(ev.Payload, &change); err != nil {
			return "", err
		}
		return changeIDOrEventID(change.ChangeID, ev), nil
	default:
		return "", nil
	}
}

// nonEmpty maps the empty string to a NULL column value.
func nonEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// upsert writes value and, on a primary key collision, updates exactly the
// listed columns. Everything left out keeps the value an earlier event wrote.
func upsert(tx *gorm.DB, value any, conflict []clause.Column, assign []string) error {
	return tx.Clauses(clause.OnConflict{
		Columns:   conflict,
		DoUpdates: clause.AssignmentColumns(assign),
	}).Create(value).Error
}

func cols(names ...string) []clause.Column {
	out := make([]clause.Column, 0, len(names))
	for _, name := range names {
		out = append(out, clause.Column{Name: name})
	}
	return out
}

// Primary keys used by the upserts above.
var (
	runKey               = cols("project_id", "run_id")
	agentKey             = cols("project_id", "run_id", "agent_id")
	planKey              = cols("project_id", "run_id", "plan_id")
	workStepKey          = cols("project_id", "run_id", "work_step_id")
	componentKey         = cols("project_id", "component_id")
	relationshipKey      = cols("project_id", "relationship_id")
	changeKey            = cols("project_id", "change_id")
	feedbackKey          = cols("project_id", "feedback_id")
	diffKey              = cols("project_id", "diff_id")
	riskKey              = cols("project_id", "risk_id")
	problemKey           = cols("project_id", "problem_id")
	feedbackComponentKey = cols("project_id", "feedback_id", "component_id")
	diffComponentKey     = cols("project_id", "diff_id", "component_id")
	riskComponentKey     = cols("project_id", "risk_id", "component_id")
	problemComponentKey  = cols("project_id", "problem_id", "component_id")
	workStepComponentKey = cols("project_id", "work_step_id", "component_id")
)
