package readapi

import (
	"context"
	"encoding/json"
	"time"

	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// Projects lists every project the backend has ever seen.
//
// One statement. This is the only endpoint that is not scoped to a single
// project, so its `projectPosition` is the highest position across the listed
// projects; each summary repeats its own `lastPosition`.
func (s *Service) Projects(ctx context.Context) (ProjectsResponse, error) {
	var rows []store.Project
	if err := s.db.WithContext(ctx).
		Model(&store.Project{}).
		Order("project_id ASC").
		Find(&rows).Error; err != nil {
		return ProjectsResponse{}, err
	}

	response := ProjectsResponse{Projects: make([]ProjectSummary, 0, len(rows))}
	for _, row := range rows {
		if row.LastPosition > response.ProjectPosition {
			response.ProjectPosition = row.LastPosition
		}
		response.Projects = append(response.Projects, projectSummary(row))
	}
	return response, nil
}

// Project returns one project together with the sizes of its read models.
//
// Two statements: the project head row, then one row of scalar subqueries for
// the counts.
func (s *Service) Project(ctx context.Context, projectID string) (ProjectResponse, error) {
	project, err := s.project(ctx, projectID)
	if err != nil {
		return ProjectResponse{}, err
	}

	var counts ProjectCounts
	if err := s.db.WithContext(ctx).Raw(`
		SELECT
			(SELECT count(*) FROM runs          WHERE project_id = ?)                      AS runs,
			(SELECT count(*) FROM runs          WHERE project_id = ? AND is_open)          AS open_runs,
			(SELECT count(*) FROM components    WHERE project_id = ?)                      AS components,
			(SELECT count(*) FROM relationships WHERE project_id = ?)                      AS relationships,
			(SELECT count(*) FROM active_changes WHERE project_id = ? AND state = ?)       AS active_changes`,
		projectID, projectID, projectID, projectID, projectID, store.ChangeStatePlanned,
	).Scan(&counts).Error; err != nil {
		return ProjectResponse{}, err
	}

	return ProjectResponse{
		ProjectPosition: project.LastPosition,
		Project: ProjectDetail{
			ProjectSummary: projectSummary(project),
			Counts:         counts,
		},
	}, nil
}

// Architecture returns the applied architecture model plus the change proposals
// that are still pending.
//
// Four statements, one per collection. The applied model and the proposals are
// kept apart on purpose: a planned change never touches `components` or
// `relationships`, so a proposal cannot be mistaken for reality.
func (s *Service) Architecture(ctx context.Context, projectID string) (ArchitectureResponse, error) {
	project, err := s.project(ctx, projectID)
	if err != nil {
		return ArchitectureResponse{}, err
	}

	var componentRows []store.Component
	if err := s.db.WithContext(ctx).
		Model(&store.Component{}).
		Where("project_id = ?", projectID).
		Order("component_id ASC").
		Find(&componentRows).Error; err != nil {
		return ArchitectureResponse{}, err
	}

	var relationshipRows []store.Relationship
	if err := s.db.WithContext(ctx).
		Model(&store.Relationship{}).
		Where("project_id = ?", projectID).
		Order("relationship_id ASC").
		Find(&relationshipRows).Error; err != nil {
		return ArchitectureResponse{}, err
	}

	changes, err := s.plannedChanges(ctx, projectID, "", "")
	if err != nil {
		return ArchitectureResponse{}, err
	}

	response := ArchitectureResponse{
		ProjectPosition: project.LastPosition,
		Components:      make([]Component, 0, len(componentRows)),
		Relationships:   make([]Relationship, 0, len(relationshipRows)),
		ActiveChanges:   changes,
	}
	for _, row := range componentRows {
		response.Components = append(response.Components, componentOf(row))
	}
	for _, row := range relationshipRows {
		response.Relationships = append(response.Relationships, Relationship{
			RelationshipID:    row.RelationshipID,
			SourceComponentID: row.SourceComponentID,
			TargetComponentID: row.TargetComponentID,
			Kind:              row.Kind,
			Label:             row.Label,
			Protocol:          row.Protocol,
			Operation:         row.Operation,
			Channel:           row.Channel,
			AppliedAt:         utc(row.AppliedAt),
			AppliedByAgentID:  row.AppliedByAgentID,
			AppliedRunID:      row.AppliedRunID,
			Position:          row.LastAppliedProjectPosition,
		})
	}
	return response, nil
}

// plannedChanges loads the pending proposals of a project in one statement.
//
// runID and targetID narrow the result for the component inspector, which shows
// the proposals of exactly one run for exactly one component. Empty values mean
// "do not narrow", which is what the architecture endpoint asks for.
func (s *Service) plannedChanges(ctx context.Context, projectID, runID, targetID string) ([]ActiveChange, error) {
	query := s.db.WithContext(ctx).
		Model(&store.ActiveChange{}).
		Where("project_id = ? AND state = ?", projectID, store.ChangeStatePlanned)
	if runID != "" {
		query = query.Where("run_id = ?", runID)
	}
	if targetID != "" {
		query = query.Where("target_kind = ? AND target_id = ?", store.ChangeTargetComponent, targetID)
	}

	var rows []store.ActiveChange
	if err := query.Order("planned_at DESC, change_id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}

	changes := make([]ActiveChange, 0, len(rows))
	for _, row := range rows {
		changes = append(changes, ActiveChange{
			ChangeID:    row.ChangeID,
			TargetKind:  row.TargetKind,
			TargetID:    row.TargetID,
			Operation:   row.Operation,
			State:       row.State,
			RunID:       row.RunID,
			AgentID:     row.AgentID,
			PlannedAt:   utcPtr(row.PlannedAt),
			AppliedAt:   utcPtr(row.AppliedAt),
			RetractedAt: utcPtr(row.RetractedAt),
			Snapshot:    rawJSON(row.Snapshot, "{}"),
			Position:    row.LastAppliedProjectPosition,
		})
	}
	return changes, nil
}

func projectSummary(row store.Project) ProjectSummary {
	return ProjectSummary{
		ProjectID:    row.ProjectID,
		FirstSeenAt:  utc(row.FirstSeenAt),
		LastEventAt:  utc(row.LastEventAt),
		LastPosition: row.LastPosition,
		CurrentRunID: nonEmpty(row.CurrentRunID),
	}
}

func componentOf(row store.Component) Component {
	return Component{
		ComponentID:       row.ComponentID,
		Name:              row.Name,
		Kind:              row.Kind,
		ParentComponentID: row.ParentComponentID,
		Description:       row.Description,
		Technology:        rawJSON(row.Technology, "{}"),
		Tags:              rawJSON(row.Tags, "[]"),
		AppliedAt:         utc(row.AppliedAt),
		AppliedByAgentID:  row.AppliedByAgentID,
		AppliedRunID:      row.AppliedRunID,
		Position:          row.LastAppliedProjectPosition,
	}
}

// rawJSON hands a stored jsonb document through unchanged and substitutes an
// empty document for a column that was never written, so the response never
// carries a bare `null` where the contract promises an object or an array.
func rawJSON(value store.JSON, fallback string) json.RawMessage {
	if len(value) == 0 {
		return json.RawMessage(fallback)
	}
	return json.RawMessage(value)
}

// nonEmpty maps the empty string of a NOT NULL column to a JSON null, which is
// what "not reported yet" means to the UI.
func nonEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

// utc normalises a `timestamptz` that the driver returned in the session's time
// zone. Without it the rendered offset would depend on where the container runs,
// while the contract states timestamps in UTC.
func utc(value time.Time) time.Time { return value.UTC() }

// utcPtr is utc for an optional timestamp, keeping a NULL a JSON null.
func utcPtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	normalised := value.UTC()
	return &normalised
}
