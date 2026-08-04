package readapi

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// ComponentQuery narrows the component inspector.
type ComponentQuery struct {
	// RunID selects the run the evidence is read from. Empty means the current
	// run of the project; the literal CurrentRunAlias means the same thing
	// explicitly. Any other value must name a run of this project.
	RunID string
	// DiffLimit and DiffCursor page the unified diffs. See ComponentResponse.
	DiffLimit  string
	DiffCursor string
}

// Component returns everything the inspector shows for one component.
//
// The response is scoped to **exactly one run**. Evidence of other runs is
// never mixed in, so "what is happening here right now" cannot be confused with
// "what happened here at some point"; the run spanning view is History.
//
// Statement count is fixed at ten and independent of how much evidence exists:
// project, component, component history probe (only when the component left the
// applied model), work step, responsible agent, feedback, diffs, risks,
// problems, pending changes. Every collection is loaded through its join table
// in one statement — there is no query per row and no JSONB scan over `events`.
func (s *Service) Component(ctx context.Context, projectID, componentID string, query ComponentQuery) (ComponentResponse, error) {
	project, err := s.project(ctx, projectID)
	if err != nil {
		return ComponentResponse{}, err
	}

	page, invalid := parsePage("diffLimit", "diffCursor", query.DiffLimit, query.DiffCursor)
	if invalid != nil {
		return ComponentResponse{}, invalid
	}

	runID := project.CurrentRunID
	if query.RunID != "" {
		run, runErr := s.resolveRun(ctx, project, query.RunID)
		if runErr != nil {
			return ComponentResponse{}, runErr
		}
		runID = run.RunID
	}

	component, err := s.componentOfProject(ctx, projectID, componentID)
	if err != nil {
		return ComponentResponse{}, err
	}

	response := ComponentResponse{
		ProjectPosition: project.LastPosition,
		RunID:           nonEmpty(runID),
		Component:       component,
		Feedback:        []FeedbackEntry{},
		Diffs:           []Diff{},
		Risks:           []Risk{},
		Problems:        []Problem{},
		ActiveChanges:   []ActiveChange{},
	}
	if runID == "" {
		// The project exists but no run has ever been opened, so there is no
		// evidence to attribute to one. Empty lists, no guessing.
		return response, nil
	}

	workStep, err := s.currentWorkStep(ctx, projectID, runID, componentID)
	if err != nil {
		return ComponentResponse{}, err
	}
	response.CurrentWorkStep = workStep

	responsibleAgentID := ""
	switch {
	case workStep != nil:
		responsibleAgentID = workStep.AgentID
	case component != nil && component.AppliedRunID == runID:
		// No work step named this component in this run, but the component was
		// applied here — the applying agent is the reported responsibility.
		responsibleAgentID = component.AppliedByAgentID
	}
	if responsibleAgentID != "" {
		agent, agentErr := s.agent(ctx, projectID, runID, responsibleAgentID)
		if agentErr != nil {
			return ComponentResponse{}, agentErr
		}
		response.ResponsibleAgent = agent
	}

	// Every collection below narrows through its join table first and then
	// through (project_id, run_id) on the entry itself.
	linked := func(model any, column string) *gorm.DB {
		return s.db.WithContext(ctx).Model(model).
			Select(column).
			Where("project_id = ? AND component_id = ?", projectID, componentID)
	}

	var feedbackRows []store.FeedbackEntry
	if err := s.db.WithContext(ctx).
		Model(&store.FeedbackEntry{}).
		Where("project_id = ? AND run_id = ? AND feedback_id IN (?)",
			projectID, runID, linked(&store.FeedbackComponent{}, "feedback_id")).
		Order("source_position DESC").
		Find(&feedbackRows).Error; err != nil {
		return ComponentResponse{}, err
	}
	for _, row := range feedbackRows {
		response.Feedback = append(response.Feedback, FeedbackEntry{
			FeedbackID: row.FeedbackID,
			RunID:      row.RunID,
			AgentID:    row.AgentID,
			Format:     row.Format,
			Title:      row.Title,
			Body:       row.Body,
			CreatedAt:  utc(row.CreatedAt),
			Position:   row.SourcePosition,
		})
	}

	diffQuery := s.db.WithContext(ctx).
		Model(&store.Diff{}).
		Where("project_id = ? AND run_id = ? AND diff_id IN (?)",
			projectID, runID, linked(&store.DiffComponent{}, "diff_id"))
	if page.Cursor != "" {
		position, ok := parsePositionCursor(page.Cursor)
		if !ok {
			return ComponentResponse{}, &ValidationError{Errors: []FieldError{{
				Field:   "/diffCursor",
				Code:    codeInvalid,
				Message: "cursor does not belong to the diff collection",
			}}}
		}
		diffQuery = diffQuery.Where("source_position < ?", position)
	}
	var diffRows []store.Diff
	if err := diffQuery.
		Order("source_position DESC").
		Limit(page.Limit + 1).
		Find(&diffRows).Error; err != nil {
		return ComponentResponse{}, err
	}
	if len(diffRows) > page.Limit {
		cursor := positionCursor(diffRows[page.Limit-1].SourcePosition)
		response.NextDiffCursor = &cursor
		diffRows = diffRows[:page.Limit]
	}
	for _, row := range diffRows {
		response.Diffs = append(response.Diffs, Diff{
			DiffID:      row.DiffID,
			RunID:       row.RunID,
			AgentID:     row.AgentID,
			ChangeID:    row.ChangeID,
			FilePath:    row.FilePath,
			UnifiedDiff: row.UnifiedDiff,
			CreatedAt:   utc(row.CreatedAt),
			Position:    row.SourcePosition,
		})
	}

	var riskRows []store.Risk
	if err := s.db.WithContext(ctx).
		Model(&store.Risk{}).
		Where("project_id = ? AND run_id = ? AND risk_id IN (?)",
			projectID, runID, linked(&store.RiskComponent{}, "risk_id")).
		Order("source_position DESC").
		Find(&riskRows).Error; err != nil {
		return ComponentResponse{}, err
	}
	for _, row := range riskRows {
		response.Risks = append(response.Risks, Risk{
			RiskID:    row.RiskID,
			RunID:     row.RunID,
			AgentID:   row.AgentID,
			Title:     row.Title,
			Detail:    row.Detail,
			Severity:  row.Severity,
			CreatedAt: utc(row.CreatedAt),
			Position:  row.SourcePosition,
		})
	}

	var problemRows []store.Problem
	if err := s.db.WithContext(ctx).
		Model(&store.Problem{}).
		Where("project_id = ? AND run_id = ? AND problem_id IN (?)",
			projectID, runID, linked(&store.ProblemComponent{}, "problem_id")).
		Order("source_position DESC").
		Find(&problemRows).Error; err != nil {
		return ComponentResponse{}, err
	}
	for _, row := range problemRows {
		response.Problems = append(response.Problems, Problem{
			ProblemID: row.ProblemID,
			RunID:     row.RunID,
			AgentID:   row.AgentID,
			Title:     row.Title,
			Detail:    row.Detail,
			CreatedAt: utc(row.CreatedAt),
			Position:  row.SourcePosition,
		})
	}

	changes, err := s.plannedChanges(ctx, projectID, runID, componentID)
	if err != nil {
		return ComponentResponse{}, err
	}
	response.ActiveChanges = changes

	return response, nil
}

// History pages through every event that touched one component, across all runs
// of the project, descending by project position.
//
// Three statements: project, the existence probe for the component and one page
// of events. The events are reached through `event_components`, the join table
// the store maintains precisely so that component history is an index lookup
// instead of a JSONB scan over the log.
func (s *Service) History(ctx context.Context, projectID, componentID, rawLimit, rawCursor string) (HistoryResponse, error) {
	project, err := s.project(ctx, projectID)
	if err != nil {
		return HistoryResponse{}, err
	}
	page, invalid := parsePage("limit", "cursor", rawLimit, rawCursor)
	if invalid != nil {
		return HistoryResponse{}, invalid
	}
	if _, err := s.componentOfProject(ctx, projectID, componentID); err != nil {
		return HistoryResponse{}, err
	}

	positions := s.db.WithContext(ctx).
		Model(&store.EventComponent{}).
		Select("position").
		Where("project_id = ? AND component_id = ?", projectID, componentID)

	query := s.db.WithContext(ctx).
		Model(&store.Event{}).
		Where("project_id = ? AND position IN (?)", projectID, positions)
	if page.Cursor != "" {
		position, ok := parsePositionCursor(page.Cursor)
		if !ok {
			return HistoryResponse{}, &ValidationError{Errors: []FieldError{{
				Field:   "/cursor",
				Code:    codeInvalid,
				Message: "cursor does not belong to the history collection",
			}}}
		}
		query = query.Where("position < ?", position)
	}

	var rows []store.Event
	if err := query.
		Order("position DESC").
		Limit(page.Limit + 1).
		Find(&rows).Error; err != nil {
		return HistoryResponse{}, err
	}

	response := HistoryResponse{ProjectPosition: project.LastPosition}
	if len(rows) > page.Limit {
		cursor := positionCursor(rows[page.Limit-1].Position)
		response.NextCursor = &cursor
		rows = rows[:page.Limit]
	}

	response.Entries = make([]HistoryEntry, 0, len(rows))
	for _, row := range rows {
		response.Entries = append(response.Entries, HistoryEntry{
			Position:      row.Position,
			ServerEventID: row.ID,
			ClientEventID: row.ClientEventID,
			RunID:         row.RunID,
			AgentID:       row.AgentID,
			ParentAgentID: row.ParentAgentID,
			Type:          row.Type,
			SchemaVersion: row.SchemaVersion,
			OccurredAt:    utc(row.OccurredAt),
			ReceivedAt:    utc(row.ReceivedAt),
			Payload:       rawJSON(row.Payload, "{}"),
		})
	}
	return response, nil
}

// componentOfProject resolves a component of the applied model.
//
// A component that was removed from the model still has a history, so a miss in
// `components` is only a 404 when `event_components` has never heard of it
// either. The second statement runs only in that case.
func (s *Service) componentOfProject(ctx context.Context, projectID, componentID string) (*Component, error) {
	var row store.Component
	err := s.db.WithContext(ctx).
		Where("project_id = ? AND component_id = ?", projectID, componentID).
		Take(&row).Error
	switch {
	case err == nil:
		component := componentOf(row)
		return &component, nil
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return nil, err
	}

	var touched int64
	if err := s.db.WithContext(ctx).
		Model(&store.EventComponent{}).
		Where("project_id = ? AND component_id = ?", projectID, componentID).
		Limit(1).
		Count(&touched).Error; err != nil {
		return nil, err
	}
	if touched == 0 {
		return nil, ErrComponentNotFound
	}
	return nil, nil
}

// currentWorkStep returns the work step of one run that the inspector shows for
// a component: an open one if there is any, otherwise the most recently started.
//
// The ordering does the selection, so this is one statement returning one row.
func (s *Service) currentWorkStep(ctx context.Context, projectID, runID, componentID string) (*WorkStep, error) {
	linked := s.db.WithContext(ctx).
		Model(&store.WorkStepComponent{}).
		Select("work_step_id").
		Where("project_id = ? AND component_id = ?", projectID, componentID)

	var rows []store.WorkStep
	if err := s.db.WithContext(ctx).
		Model(&store.WorkStep{}).
		Where("project_id = ? AND run_id = ? AND work_step_id IN (?)", projectID, runID, linked).
		Order("(completed_at IS NULL) DESC, started_at DESC, work_step_id DESC").
		Limit(1).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}

	row := rows[0]
	return &WorkStep{
		WorkStepID:  row.WorkStepID,
		RunID:       row.RunID,
		AgentID:     row.AgentID,
		PlanStepID:  row.PlanStepID,
		Title:       row.Title,
		StartedAt:   utc(row.StartedAt),
		CompletedAt: utcPtr(row.CompletedAt),
		Summary:     row.Summary,
		Position:    row.LastAppliedProjectPosition,
	}, nil
}

// agent loads one agent of a run, or nil when it never reported agent.started.
func (s *Service) agent(ctx context.Context, projectID, runID, agentID string) (*Agent, error) {
	var row store.Agent
	err := s.db.WithContext(ctx).
		Where("project_id = ? AND run_id = ? AND agent_id = ?", projectID, runID, agentID).
		Take(&row).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return nil, nil
	case err != nil:
		return nil, err
	default:
		agent := agentOf(row)
		return &agent, nil
	}
}
