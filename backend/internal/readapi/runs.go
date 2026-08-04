package readapi

import (
	"context"
	"time"

	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// Runs lists current and historical runs of a project, newest start first.
//
// Two statements: the project head row and one page of runs. The page is read
// with limit+1 rows so the presence of a next page is known without a count.
func (s *Service) Runs(ctx context.Context, projectID, rawLimit, rawCursor string) (RunsResponse, error) {
	project, err := s.project(ctx, projectID)
	if err != nil {
		return RunsResponse{}, err
	}
	page, invalid := parsePage("limit", "cursor", rawLimit, rawCursor)
	if invalid != nil {
		return RunsResponse{}, invalid
	}

	query := s.db.WithContext(ctx).
		Model(&store.Run{}).
		Where("project_id = ?", projectID)
	if page.Cursor != "" {
		nanos, runID, ok := parseRunCursor(page.Cursor)
		if !ok {
			return RunsResponse{}, &ValidationError{Errors: []FieldError{{
				Field:   "/cursor",
				Code:    codeInvalid,
				Message: "cursor does not belong to the run collection",
			}}}
		}
		// Strictly after the cursor row in the very ordering below, so a page
		// boundary neither repeats nor skips a run.
		startedAt := time.Unix(0, nanos).UTC()
		query = query.Where("(started_at, run_id) < (?, ?)", startedAt, runID)
	}

	var rows []store.Run
	if err := query.
		Order("started_at DESC, run_id DESC").
		Limit(page.Limit + 1).
		Find(&rows).Error; err != nil {
		return RunsResponse{}, err
	}

	response := RunsResponse{ProjectPosition: project.LastPosition}
	if len(rows) > page.Limit {
		last := rows[page.Limit-1]
		cursor := runCursor(last.StartedAt.UTC().UnixNano(), last.RunID)
		response.NextCursor = &cursor
		rows = rows[:page.Limit]
	}

	response.Runs = make([]RunSummary, 0, len(rows))
	for _, row := range rows {
		response.Runs = append(response.Runs, runSummary(row, project.CurrentRunID))
	}
	return response, nil
}

// Run returns one run of a project. The literal `current` resolves to
// `projects.current_run_id`.
//
// Three statements: the project head row, the run row and one row of scalar
// subqueries for the counts.
func (s *Service) Run(ctx context.Context, projectID, runID string) (RunResponse, error) {
	project, err := s.project(ctx, projectID)
	if err != nil {
		return RunResponse{}, err
	}
	run, err := s.resolveRun(ctx, project, runID)
	if err != nil {
		return RunResponse{}, err
	}

	var counts RunCounts
	if err := s.db.WithContext(ctx).Raw(`
		SELECT
			(SELECT count(*) FROM agents     WHERE project_id = ? AND run_id = ?) AS agents,
			(SELECT count(*) FROM plans      WHERE project_id = ? AND run_id = ?) AS plans,
			(SELECT count(*) FROM work_steps WHERE project_id = ? AND run_id = ?) AS work_steps`,
		projectID, run.RunID, projectID, run.RunID, projectID, run.RunID,
	).Scan(&counts).Error; err != nil {
		return RunResponse{}, err
	}

	return RunResponse{
		ProjectPosition: project.LastPosition,
		Run: RunDetail{
			RunSummary: runSummary(run, project.CurrentRunID),
			Counts:     counts,
		},
	}, nil
}

// Agents returns the agent tree of one run as a flat list.
//
// Three statements: project, run and the agents. The list is ordered by start
// time so a parent is emitted before the subagents it spawned, which lets a
// consumer build the tree in a single pass.
func (s *Service) Agents(ctx context.Context, projectID, runID string) (AgentsResponse, error) {
	project, err := s.project(ctx, projectID)
	if err != nil {
		return AgentsResponse{}, err
	}
	run, err := s.resolveRun(ctx, project, runID)
	if err != nil {
		return AgentsResponse{}, err
	}

	var rows []store.Agent
	if err := s.db.WithContext(ctx).
		Model(&store.Agent{}).
		Where("project_id = ? AND run_id = ?", projectID, run.RunID).
		Order("started_at ASC, agent_id ASC").
		Find(&rows).Error; err != nil {
		return AgentsResponse{}, err
	}

	response := AgentsResponse{
		ProjectPosition: project.LastPosition,
		Agents:          make([]Agent, 0, len(rows)),
	}
	for _, row := range rows {
		response.Agents = append(response.Agents, agentOf(row))
	}
	return response, nil
}

// Plans returns every plan of one run with all of its revisions and steps.
//
// Five statements regardless of how many plans, revisions or steps exist:
// project, run, plans, then the revisions and the steps of exactly those plans.
// Grouping happens in memory, so no query runs per plan or per revision.
func (s *Service) Plans(ctx context.Context, projectID, runID string) (PlansResponse, error) {
	project, err := s.project(ctx, projectID)
	if err != nil {
		return PlansResponse{}, err
	}
	run, err := s.resolveRun(ctx, project, runID)
	if err != nil {
		return PlansResponse{}, err
	}

	var planRows []store.Plan
	if err := s.db.WithContext(ctx).
		Model(&store.Plan{}).
		Where("project_id = ? AND run_id = ?", projectID, run.RunID).
		Order("plan_id ASC").
		Find(&planRows).Error; err != nil {
		return PlansResponse{}, err
	}

	response := PlansResponse{
		ProjectPosition: project.LastPosition,
		Plans:           make([]Plan, 0, len(planRows)),
	}
	if len(planRows) == 0 {
		return response, nil
	}

	planIDs := make([]string, 0, len(planRows))
	for _, row := range planRows {
		planIDs = append(planIDs, row.PlanID)
	}

	// plan_revisions and plan_steps are keyed by (project, plan, revision) and
	// carry no run column: a plan id belongs to exactly one run, so narrowing by
	// the plan ids of this run is the run filter.
	var revisionRows []store.PlanRevision
	if err := s.db.WithContext(ctx).
		Model(&store.PlanRevision{}).
		Where("project_id = ? AND plan_id IN ?", projectID, planIDs).
		Order("plan_id ASC, revision ASC").
		Find(&revisionRows).Error; err != nil {
		return PlansResponse{}, err
	}

	var stepRows []store.PlanStep
	if err := s.db.WithContext(ctx).
		Model(&store.PlanStep{}).
		Where("project_id = ? AND plan_id IN ?", projectID, planIDs).
		Order("plan_id ASC, revision ASC, step_order ASC, step_id ASC").
		Find(&stepRows).Error; err != nil {
		return PlansResponse{}, err
	}

	type revisionKey struct {
		planID   string
		revision int
	}
	stepsByRevision := make(map[revisionKey][]PlanStep, len(revisionRows))
	for _, row := range stepRows {
		key := revisionKey{planID: row.PlanID, revision: row.Revision}
		stepsByRevision[key] = append(stepsByRevision[key], PlanStep{
			StepID:   row.StepID,
			Order:    row.StepOrder,
			Title:    row.Title,
			State:    row.State,
			Position: row.LastAppliedProjectPosition,
		})
	}

	revisionsByPlan := make(map[string][]PlanRevision, len(planRows))
	for _, row := range revisionRows {
		steps := stepsByRevision[revisionKey{planID: row.PlanID, revision: row.Revision}]
		if steps == nil {
			steps = []PlanStep{}
		}
		revisionsByPlan[row.PlanID] = append(revisionsByPlan[row.PlanID], PlanRevision{
			Revision:         row.Revision,
			CreatedAt:        utc(row.CreatedAt),
			CreatedByAgentID: row.CreatedByAgentID,
			Steps:            steps,
			Position:         row.LastAppliedProjectPosition,
		})
	}

	for _, row := range planRows {
		revisions := revisionsByPlan[row.PlanID]
		if revisions == nil {
			revisions = []PlanRevision{}
		}
		for i := range revisions {
			revisions[i].IsCurrent = revisions[i].Revision == row.CurrentRevision
		}
		response.Plans = append(response.Plans, Plan{
			PlanID:          row.PlanID,
			RunID:           row.RunID,
			AgentID:         row.AgentID,
			CurrentRevision: row.CurrentRevision,
			Revisions:       revisions,
			Position:        row.LastAppliedProjectPosition,
		})
	}
	return response, nil
}

func runSummary(row store.Run, currentRunID string) RunSummary {
	return RunSummary{
		RunID:       row.RunID,
		RootAgentID: nonEmpty(row.RootAgentID),
		StartedAt:   utc(row.StartedAt),
		FinishedAt:  utcPtr(row.FinishedAt),
		Outcome:     row.Outcome,
		IsOpen:      row.IsOpen,
		IsCurrent:   currentRunID != "" && row.RunID == currentRunID,
		Position:    row.LastAppliedProjectPosition,
	}
}

func agentOf(row store.Agent) Agent {
	agent := Agent{
		AgentID:         row.AgentID,
		RunID:           row.RunID,
		ParentAgentID:   row.ParentAgentID,
		Role:            row.Role,
		DisplayName:     row.DisplayName,
		AssignedTask:    row.AssignedTask,
		Status:          row.Status,
		StatusNote:      row.StatusNote,
		FinishedOutcome: row.FinishedOutcome,
		StartedAt:       utc(row.StartedAt),
		LastEventAt:     utc(row.LastEventAt),
		Position:        row.LastAppliedProjectPosition,
	}
	// Progress stays null until the agent reported a number itself; a zero
	// percent that was never reported would read as "nothing done yet".
	if row.ProgressPercent != nil {
		agent.Progress = &AgentProgress{
			Percent: *row.ProgressPercent,
			Scope:   row.ProgressScope,
			Basis:   row.ProgressBasis,
		}
	}
	return agent
}
