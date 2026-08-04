package readapi_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// ---------------------------------------------------------------------------
// Empty project and unknown project
// ---------------------------------------------------------------------------

// A project that has only opened a run has no architecture, no plan and no
// component evidence. Every endpoint must still answer with empty collections
// rather than null or a panic — the shell renders before anything was reported.
func TestEmptyProjectAnswersEveryEndpointWithEmptyCollections(t *testing.T) {
	h := newHarness(t)
	h.run("visualise-ai", "run-2026-08-04-0001").startRoot("orchestrator-root", "Deliver the v0 cockpit.")

	position := h.lastPosition("visualise-ai")

	var projects readapi.ProjectsResponse
	h.getJSON("/api/v1/projects", &projects)
	if len(projects.Projects) != 1 || projects.Projects[0].ProjectID != "visualise-ai" {
		t.Fatalf("want exactly the seeded project, got %+v", projects.Projects)
	}
	if projects.ProjectPosition != position {
		t.Fatalf("projects: want projectPosition %d, got %d", position, projects.ProjectPosition)
	}

	var detail readapi.ProjectResponse
	h.getJSON("/api/v1/projects/visualise-ai", &detail)
	if detail.Project.Counts.Runs != 1 || detail.Project.Counts.OpenRuns != 1 {
		t.Fatalf("want one open run, got %+v", detail.Project.Counts)
	}
	if detail.Project.Counts.Components != 0 || detail.Project.Counts.Relationships != 0 {
		t.Fatalf("want an empty architecture, got %+v", detail.Project.Counts)
	}

	// The JSON must carry `[]`, not `null`: a UI that maps over the collections
	// must not have to defend against a missing array.
	body := h.request("/api/v1/projects/visualise-ai/architecture").Body.String()
	for _, wanted := range []string{`"components":[]`, `"relationships":[]`, `"activeChanges":[]`} {
		if !strings.Contains(body, wanted) {
			t.Fatalf("architecture body lacks %s: %s", wanted, body)
		}
	}

	var plans readapi.PlansResponse
	h.getJSON("/api/v1/projects/visualise-ai/runs/current/plans", &plans)
	if len(plans.Plans) != 0 {
		t.Fatalf("want no plans, got %+v", plans.Plans)
	}

	var runs readapi.RunsResponse
	h.getJSON("/api/v1/projects/visualise-ai/runs", &runs)
	if len(runs.Runs) != 1 || !runs.Runs[0].IsOpen || !runs.Runs[0].IsCurrent {
		t.Fatalf("want one open, current run, got %+v", runs.Runs)
	}
	if runs.NextCursor != nil {
		t.Fatalf("a single run must not report a next page, got %q", *runs.NextCursor)
	}

	var agents readapi.AgentsResponse
	h.getJSON("/api/v1/projects/visualise-ai/runs/current/agents", &agents)
	if len(agents.Agents) != 1 || agents.Agents[0].ParentAgentID != nil {
		t.Fatalf("want the root orchestrator alone, got %+v", agents.Agents)
	}
	if agents.Agents[0].Progress != nil || agents.Agents[0].Status != "" {
		t.Fatalf("nothing was reported, so nothing may be shown: %+v", agents.Agents[0])
	}

	// A component the project never mentioned is a 404, not an empty inspector.
	problem := h.getProblem("/api/v1/projects/visualise-ai/components/shop-platform.orders", http.StatusNotFound)
	if problem.Code != "component_not_found" {
		t.Fatalf("want component_not_found, got %q", problem.Code)
	}
	problem = h.getProblem("/api/v1/projects/visualise-ai/components/shop-platform.orders/history", http.StatusNotFound)
	if problem.Code != "component_not_found" {
		t.Fatalf("want component_not_found for the history, got %q", problem.Code)
	}
}

// With no project at all the collection endpoint is empty and reports position 0.
func TestProjectListIsEmptyBeforeTheFirstEvent(t *testing.T) {
	h := newHarness(t)

	var projects readapi.ProjectsResponse
	h.getJSON("/api/v1/projects", &projects)
	if projects.ProjectPosition != 0 {
		t.Fatalf("want projectPosition 0, got %d", projects.ProjectPosition)
	}
	if len(projects.Projects) != 0 {
		t.Fatalf("want no projects, got %+v", projects.Projects)
	}
	if body := h.request("/api/v1/projects").Body.String(); !strings.Contains(body, `"projects":[]`) {
		t.Fatalf("want an empty array, got %s", body)
	}
}

// Every project scoped endpoint refuses an unknown project with the same code.
func TestUnknownProjectIsAlways404(t *testing.T) {
	h := newHarness(t)
	h.run("visualise-ai", "run-2026-08-04-0001").startRoot("orchestrator-root", "Deliver the v0 cockpit.")

	paths := []string{
		"/api/v1/projects/nope",
		"/api/v1/projects/nope/architecture",
		"/api/v1/projects/nope/runs",
		"/api/v1/projects/nope/runs/current",
		"/api/v1/projects/nope/runs/run-2026-08-04-0001/agents",
		"/api/v1/projects/nope/runs/run-2026-08-04-0001/plans",
		"/api/v1/projects/nope/components/shop-platform",
		"/api/v1/projects/nope/components/shop-platform/history",
	}
	for _, path := range paths {
		problem := h.getProblem(path, http.StatusNotFound)
		if problem.Code != "project_not_found" {
			t.Fatalf("GET %s: want project_not_found, got %q", path, problem.Code)
		}
	}
}

// ---------------------------------------------------------------------------
// Agent tree
// ---------------------------------------------------------------------------

// A run with a root orchestrator and several nested subagents must come back
// complete and unambiguous: every node keeps its parent, so the UI can rebuild
// the tree without the server flattening the hierarchy away.
func TestActiveRunReturnsTheCompleteNestedAgentTree(t *testing.T) {
	h := newHarness(t)
	run := h.run("visualise-ai", "run-2026-08-04-0001")

	run.startRoot("orchestrator-root", "Deliver the v0 cockpit.")
	run.startSub("subagent-contract", "orchestrator-root", "Define the event contract.")
	run.startSub("subagent-backend", "orchestrator-root", "Implement the backend.")
	run.startSub("subagent-store", "subagent-backend", "Implement the event store.")
	run.startSub("subagent-readapi", "subagent-backend", "Implement the read API.")
	run.startSub("subagent-queries", "subagent-readapi", "Write the projections queries.")

	run.emit("subagent-readapi", nil, store.TypeAgentStatusReported, `{"status":"working","note":"Writing queries."}`)
	run.emit("subagent-readapi", nil, store.TypeAgentProgressReported,
		`{"percent":40,"scope":"own_task","basis":"completed_steps"}`)
	run.emit("orchestrator-root", nil, store.TypeAgentProgressReported,
		`{"percent":55,"scope":"overall_estimate","basis":"reported_estimate"}`)
	run.emit("subagent-contract", nil, store.TypeAgentFinished, `{"outcome":"completed","summary":"Contract merged."}`)

	var agents readapi.AgentsResponse
	h.getJSON("/api/v1/projects/visualise-ai/runs/current/agents", &agents)
	if len(agents.Agents) != 6 {
		t.Fatalf("want six agents, got %d: %+v", len(agents.Agents), agents.Agents)
	}

	byID := make(map[string]readapi.Agent, len(agents.Agents))
	seen := make(map[string]bool, len(agents.Agents))
	for _, agent := range agents.Agents {
		byID[agent.AgentID] = agent
		// The list is ordered so a parent is emitted before its children, which
		// lets a consumer build the tree in a single pass.
		if agent.ParentAgentID != nil && !seen[*agent.ParentAgentID] {
			t.Fatalf("agent %q appears before its parent %q", agent.AgentID, *agent.ParentAgentID)
		}
		seen[agent.AgentID] = true
	}

	wantParents := map[string]string{
		"orchestrator-root": "",
		"subagent-contract": "orchestrator-root",
		"subagent-backend":  "orchestrator-root",
		"subagent-store":    "subagent-backend",
		"subagent-readapi":  "subagent-backend",
		"subagent-queries":  "subagent-readapi",
	}
	for agentID, wantParent := range wantParents {
		agent, ok := byID[agentID]
		if !ok {
			t.Fatalf("agent %q is missing from the tree", agentID)
		}
		got := ""
		if agent.ParentAgentID != nil {
			got = *agent.ParentAgentID
		}
		if got != wantParent {
			t.Fatalf("agent %q: want parent %q, got %q", agentID, wantParent, got)
		}
	}

	// Reported values are shown exactly where they were reported, and nowhere else.
	if progress := byID["subagent-readapi"].Progress; progress == nil ||
		progress.Percent != 40 || progress.Scope == nil || *progress.Scope != "own_task" {
		t.Fatalf("subagent progress was not reported through: %+v", byID["subagent-readapi"].Progress)
	}
	if progress := byID["orchestrator-root"].Progress; progress == nil ||
		progress.Scope == nil || *progress.Scope != "overall_estimate" {
		t.Fatalf("the orchestrator estimate lost its scope: %+v", byID["orchestrator-root"].Progress)
	}
	if byID["subagent-store"].Progress != nil {
		t.Fatalf("an agent that reported no progress must not show one: %+v", byID["subagent-store"].Progress)
	}
	if outcome := byID["subagent-contract"].FinishedOutcome; outcome == nil || *outcome != "completed" {
		t.Fatalf("want the reported outcome, got %v", outcome)
	}
	if byID["subagent-backend"].FinishedOutcome != nil {
		t.Fatalf("an unfinished agent must not carry an outcome")
	}
	if byID["subagent-readapi"].Status != "working" {
		t.Fatalf("want the last reported status, got %q", byID["subagent-readapi"].Status)
	}
}

// ---------------------------------------------------------------------------
// Current run versus history
// ---------------------------------------------------------------------------

// A finished run stays listed, but the current run is the one that was opened
// last. Historical runs never overlay the current view.
func TestFinishedRunStaysListedWhileCurrentResolvesToTheOpenRun(t *testing.T) {
	h := newHarness(t)

	past := h.run("visualise-ai", "run-2026-08-03-0001")
	past.startRoot("orchestrator-root", "Yesterday's run.")
	past.emit("orchestrator-root", nil, store.TypeRunFinished, `{"outcome":"completed","summary":"Done."}`)

	open := h.run("visualise-ai", "run-2026-08-04-0001")
	open.startRoot("orchestrator-root", "Today's run.")

	var runs readapi.RunsResponse
	h.getJSON("/api/v1/projects/visualise-ai/runs", &runs)
	if len(runs.Runs) != 2 {
		t.Fatalf("want both runs, got %+v", runs.Runs)
	}
	// Descending by start: the newest run comes first.
	if runs.Runs[0].RunID != "run-2026-08-04-0001" || runs.Runs[1].RunID != "run-2026-08-03-0001" {
		t.Fatalf("runs are not ordered newest first: %+v", runs.Runs)
	}
	if !runs.Runs[0].IsOpen || !runs.Runs[0].IsCurrent {
		t.Fatalf("the newest run must be open and current: %+v", runs.Runs[0])
	}
	if runs.Runs[1].IsOpen || runs.Runs[1].IsCurrent {
		t.Fatalf("the finished run must be neither open nor current: %+v", runs.Runs[1])
	}
	if outcome := runs.Runs[1].Outcome; outcome == nil || *outcome != "completed" {
		t.Fatalf("want the reported outcome on the finished run, got %v", outcome)
	}
	if runs.Runs[1].FinishedAt == nil {
		t.Fatalf("a finished run must report when it finished")
	}

	var current readapi.RunResponse
	h.getJSON("/api/v1/projects/visualise-ai/runs/current", &current)
	if current.Run.RunID != "run-2026-08-04-0001" {
		t.Fatalf("current resolved to %q", current.Run.RunID)
	}

	// The historical run stays addressable by its own id and keeps its state.
	var historical readapi.RunResponse
	h.getJSON("/api/v1/projects/visualise-ai/runs/run-2026-08-03-0001", &historical)
	if historical.Run.IsOpen || historical.Run.IsCurrent {
		t.Fatalf("the historical run changed state when addressed directly: %+v", historical.Run)
	}

	problem := h.getProblem("/api/v1/projects/visualise-ai/runs/run-does-not-exist", http.StatusNotFound)
	if problem.Code != "run_not_found" {
		t.Fatalf("want run_not_found, got %q", problem.Code)
	}
}

// Without a root orchestrator the project has no current run, and that is its
// own error code — "no run yet" is not the same as "wrong run id".
func TestCurrentRunIsItsOwnErrorCodeWhenNoRunWasOpened(t *testing.T) {
	h := newHarness(t)
	// A subagent event alone creates the run row but never makes it current.
	h.run("visualise-ai", "run-2026-08-04-0001").
		startSub("subagent-orphan", "orchestrator-root", "Work without an orchestrator.")

	for _, path := range []string{
		"/api/v1/projects/visualise-ai/runs/current",
		"/api/v1/projects/visualise-ai/runs/current/agents",
		"/api/v1/projects/visualise-ai/runs/current/plans",
	} {
		problem := h.getProblem(path, http.StatusNotFound)
		if problem.Code != "current_run_not_found" {
			t.Fatalf("GET %s: want current_run_not_found, got %q", path, problem.Code)
		}
	}

	// The run itself is listed and addressable — only "current" is undefined.
	var runs readapi.RunsResponse
	h.getJSON("/api/v1/projects/visualise-ai/runs", &runs)
	if len(runs.Runs) != 1 || runs.Runs[0].IsCurrent || runs.Runs[0].RootAgentID != nil {
		t.Fatalf("want one non-current run without a root agent, got %+v", runs.Runs)
	}
}

// The inspector shows the evidence of exactly one run; the history spans them
// all. Mixing the two would make "what is happening now" unreadable.
func TestInspectorIsRunScopedWhileHistorySpansRuns(t *testing.T) {
	h := newHarness(t)
	const componentID = "shop-platform.orders.domain.pricing"

	past := h.run("visualise-ai", "run-2026-08-03-0001")
	past.startRoot("orchestrator-root", "Yesterday's run.")
	past.emit("orchestrator-root", nil, store.TypeFeedbackPublished, feedbackPayload(
		"feedback-past", componentID, "Yesterday's review"))
	past.emit("orchestrator-root", nil, store.TypeDiffReported, diffPayload(
		"diff-past", componentID, "internal/orders/domain/pricing/old.go"))
	past.emit("orchestrator-root", nil, store.TypeRunFinished, `{"outcome":"completed","summary":"Done."}`)

	open := h.run("visualise-ai", "run-2026-08-04-0001")
	open.startRoot("orchestrator-root", "Today's run.")
	open.emit("orchestrator-root", nil, store.TypeFeedbackPublished, feedbackPayload(
		"feedback-today", componentID, "Today's review"))
	open.emit("orchestrator-root", nil, store.TypeDiffReported, diffPayload(
		"diff-today", componentID, "internal/orders/domain/pricing/pricing.go"))

	// No runId: the current run, and only it.
	var current readapi.ComponentResponse
	h.getJSON("/api/v1/projects/visualise-ai/components/"+componentID, &current)
	assertSingleEvidence(t, current, "run-2026-08-04-0001", "feedback-today", "diff-today")

	// The alias means the same thing explicitly.
	var alias readapi.ComponentResponse
	h.getJSON("/api/v1/projects/visualise-ai/components/"+componentID+"?runId=current", &alias)
	assertSingleEvidence(t, alias, "run-2026-08-04-0001", "feedback-today", "diff-today")

	// An explicit historical run yields that run's evidence and nothing else.
	var historical readapi.ComponentResponse
	h.getJSON("/api/v1/projects/visualise-ai/components/"+componentID+"?runId=run-2026-08-03-0001", &historical)
	assertSingleEvidence(t, historical, "run-2026-08-03-0001", "feedback-past", "diff-past")

	// The history is the run spanning view, descending by project position.
	var history readapi.HistoryResponse
	h.getJSON("/api/v1/projects/visualise-ai/components/"+componentID+"/history", &history)
	if len(history.Entries) != 4 {
		t.Fatalf("want the four component touching events, got %d: %+v", len(history.Entries), history.Entries)
	}
	runsSeen := map[string]int{}
	for i, entry := range history.Entries {
		runsSeen[entry.RunID]++
		if i > 0 && history.Entries[i-1].Position <= entry.Position {
			t.Fatalf("history is not strictly descending: %d then %d",
				history.Entries[i-1].Position, entry.Position)
		}
		if len(entry.Payload) == 0 {
			t.Fatalf("history entry %d carries no payload", i)
		}
	}
	if runsSeen["run-2026-08-03-0001"] != 2 || runsSeen["run-2026-08-04-0001"] != 2 {
		t.Fatalf("history did not span both runs: %v", runsSeen)
	}

	// An unknown run is rejected rather than silently falling back to current.
	problem := h.getProblem(
		"/api/v1/projects/visualise-ai/components/"+componentID+"?runId=run-does-not-exist",
		http.StatusNotFound)
	if problem.Code != "run_not_found" {
		t.Fatalf("want run_not_found, got %q", problem.Code)
	}
}

func assertSingleEvidence(t *testing.T, response readapi.ComponentResponse, wantRun, wantFeedback, wantDiff string) {
	t.Helper()
	if response.RunID == nil || *response.RunID != wantRun {
		t.Fatalf("want run %q, got %v", wantRun, response.RunID)
	}
	if len(response.Feedback) != 1 || response.Feedback[0].FeedbackID != wantFeedback {
		t.Fatalf("want exactly feedback %q, got %+v", wantFeedback, response.Feedback)
	}
	if len(response.Diffs) != 1 || response.Diffs[0].DiffID != wantDiff {
		t.Fatalf("want exactly diff %q, got %+v", wantDiff, response.Diffs)
	}
	if response.Feedback[0].RunID != wantRun || response.Diffs[0].RunID != wantRun {
		t.Fatalf("evidence of another run leaked in: %+v / %+v", response.Feedback[0], response.Diffs[0])
	}
}

// ---------------------------------------------------------------------------
// Project isolation
// ---------------------------------------------------------------------------

// Two projects deliberately reuse the same run, agent and component ids. Not a
// single row of one may appear in a response of the other.
func TestProjectsWithIdenticalIdentifiersStayIsolated(t *testing.T) {
	h := newHarness(t)

	const (
		runID       = "run-2026-08-04-0001"
		agentID     = "orchestrator-root"
		componentID = "shop-platform.orders"
	)

	for _, projectID := range []string{"alpha-project", "beta-project"} {
		run := h.run(projectID, runID)
		run.startRoot(agentID, "Deliver "+projectID+".")
		run.emit(agentID, nil, store.TypeArchitectureSnapshotPublished, fmt.Sprintf(`{
			"snapshotId": "snapshot-%s",
			"components": [
				{"componentId": %q, "name": %q, "kind": "service", "parentComponentId": null}
			],
			"relationships": []
		}`, projectID, componentID, projectID+" orders"))
		run.emit(agentID, nil, store.TypeFeedbackPublished, feedbackPayload(
			"feedback-"+projectID, componentID, projectID+" review"))
		run.emit(agentID, nil, store.TypeDiffReported, diffPayload(
			"diff-"+projectID, componentID, "internal/"+projectID+"/orders.go"))
		run.emit(agentID, nil, store.TypeRiskReported, fmt.Sprintf(
			`{"riskId":"risk-%s","componentIds":[%q],"title":"%s risk","severity":"low"}`,
			projectID, componentID, projectID))
	}

	// beta got one extra event, so the two projects also disagree on position.
	h.run("beta-project", runID).emit(agentID, nil, store.TypeProblemReported, fmt.Sprintf(
		`{"problemId":"problem-beta","componentIds":[%q],"title":"beta problem"}`, componentID))

	for _, projectID := range []string{"alpha-project", "beta-project"} {
		var architecture readapi.ArchitectureResponse
		h.getJSON("/api/v1/projects/"+projectID+"/architecture", &architecture)
		if len(architecture.Components) != 1 {
			t.Fatalf("%s: want exactly one component, got %+v", projectID, architecture.Components)
		}
		if want := projectID + " orders"; architecture.Components[0].Name != want {
			t.Fatalf("%s: want the own component %q, got %q", projectID, want, architecture.Components[0].Name)
		}

		var inspector readapi.ComponentResponse
		h.getJSON("/api/v1/projects/"+projectID+"/components/"+componentID, &inspector)
		if len(inspector.Feedback) != 1 || inspector.Feedback[0].FeedbackID != "feedback-"+projectID {
			t.Fatalf("%s: feedback of another project leaked in: %+v", projectID, inspector.Feedback)
		}
		if len(inspector.Diffs) != 1 || inspector.Diffs[0].DiffID != "diff-"+projectID {
			t.Fatalf("%s: diffs of another project leaked in: %+v", projectID, inspector.Diffs)
		}
		if len(inspector.Risks) != 1 || inspector.Risks[0].RiskID != "risk-"+projectID {
			t.Fatalf("%s: risks of another project leaked in: %+v", projectID, inspector.Risks)
		}

		var runs readapi.RunsResponse
		h.getJSON("/api/v1/projects/"+projectID+"/runs", &runs)
		if len(runs.Runs) != 1 {
			t.Fatalf("%s: want exactly one run, got %+v", projectID, runs.Runs)
		}

		var agents readapi.AgentsResponse
		h.getJSON("/api/v1/projects/"+projectID+"/runs/"+runID+"/agents", &agents)
		if len(agents.Agents) != 1 {
			t.Fatalf("%s: want exactly one agent, got %+v", projectID, agents.Agents)
		}
		if want := "Deliver " + projectID + "."; agents.Agents[0].AssignedTask != want {
			t.Fatalf("%s: agent of another project leaked in: %+v", projectID, agents.Agents[0])
		}

		other := "beta-project"
		if projectID == other {
			other = "alpha-project"
		}
		var history readapi.HistoryResponse
		h.getJSON("/api/v1/projects/"+projectID+"/components/"+componentID+"/history", &history)
		for _, entry := range history.Entries {
			if strings.Contains(string(entry.Payload), other) {
				t.Fatalf("%s: history entry of %s: %+v", projectID, other, entry)
			}
		}
	}

	// Positions are per project and must not be shared.
	alpha := h.lastPosition("alpha-project")
	beta := h.lastPosition("beta-project")
	if alpha == beta {
		t.Fatalf("the two projects should not share a position (%d)", alpha)
	}

	var alphaProject, betaProject readapi.ProjectResponse
	h.getJSON("/api/v1/projects/alpha-project", &alphaProject)
	h.getJSON("/api/v1/projects/beta-project", &betaProject)
	if alphaProject.ProjectPosition != alpha || betaProject.ProjectPosition != beta {
		t.Fatalf("projectPosition is not per project: %d/%d vs %d/%d",
			alphaProject.ProjectPosition, alpha, betaProject.ProjectPosition, beta)
	}
	if alphaProject.Project.Counts.Components != 1 || betaProject.Project.Counts.Components != 1 {
		t.Fatalf("the counts crossed the project boundary: %+v / %+v",
			alphaProject.Project.Counts, betaProject.Project.Counts)
	}
}

// ---------------------------------------------------------------------------
// Architecture read model
// ---------------------------------------------------------------------------

// The contract example carries four hierarchy levels and every relationship
// kind, including three separate NATS topic edges. All of it must survive the
// projection and the query unaggregated.
func TestArchitectureReadModelReturnsTheFullContractSnapshot(t *testing.T) {
	h := newHarness(t)
	run := h.run("visualise-ai", "run-2026-08-04-0001")
	run.startRoot("orchestrator-root", "Map the architecture.")
	run.emitExample("architecture-snapshot.json")

	var architecture readapi.ArchitectureResponse
	h.getJSON("/api/v1/projects/visualise-ai/architecture", &architecture)

	if len(architecture.Components) != 15 {
		t.Fatalf("want the 15 snapshot components, got %d: %v",
			len(architecture.Components), componentIDs(architecture.Components))
	}
	if len(architecture.Relationships) != 8 {
		t.Fatalf("want the 8 snapshot relationships, got %d", len(architecture.Relationships))
	}

	byID := make(map[string]readapi.Component, len(architecture.Components))
	for _, component := range architecture.Components {
		byID[component.ComponentID] = component
	}

	// Four levels of nesting: system -> service -> module -> module.
	chain := []string{
		"shop-platform",
		"shop-platform.orders",
		"shop-platform.orders.domain",
		"shop-platform.orders.domain.pricing",
	}
	for i, componentID := range chain {
		component, ok := byID[componentID]
		if !ok {
			t.Fatalf("component %q is missing", componentID)
		}
		switch {
		case i == 0:
			if component.ParentComponentID != nil {
				t.Fatalf("the root component must have no parent, got %v", component.ParentComponentID)
			}
		default:
			if component.ParentComponentID == nil || *component.ParentComponentID != chain[i-1] {
				t.Fatalf("component %q lost its parent %q: %v", componentID, chain[i-1], component.ParentComponentID)
			}
		}
	}

	// Reported technology and tags are handed through as documents, not flattened.
	storefront := byID["shop-platform.storefront"]
	if !strings.Contains(string(storefront.Technology), `"React"`) {
		t.Fatalf("technology was not handed through: %s", storefront.Technology)
	}
	if !strings.Contains(string(storefront.Tags), `"frontend"`) {
		t.Fatalf("tags were not handed through: %s", storefront.Tags)
	}
	// A component that reported neither must still carry an empty document.
	if got := string(byID["shop-platform"].Technology); got != "{}" {
		t.Fatalf("want an empty technology object, got %s", got)
	}
	if got := string(byID["shop-platform"].Tags); got != "[]" {
		t.Fatalf("want an empty tags array, got %s", got)
	}

	kinds := map[string]int{}
	topics := map[string]string{}
	for _, relationship := range architecture.Relationships {
		kinds[relationship.Kind]++
		if relationship.Kind == "nats_topic" {
			topics[relationship.RelationshipID] = relationship.Channel
		}
	}
	for _, kind := range []string{"http", "grpc", "data", "async", "nats_topic", "dependency"} {
		if kinds[kind] == 0 {
			t.Fatalf("relationship kind %q is missing: %v", kind, kinds)
		}
	}
	// Every topic keeps its own edge; they are never merged into one messaging edge.
	if len(topics) != 3 {
		t.Fatalf("want three separate nats_topic relationships, got %v", topics)
	}
	wantTopics := map[string]string{
		"rel-orders-publishes-order-created":         "orders.order.created",
		"rel-inventory-publishes-inventory-reserved": "inventory.item.reserved",
		"rel-inventory-consumes-order-created":       "orders.order.created",
	}
	for relationshipID, channel := range wantTopics {
		if topics[relationshipID] != channel {
			t.Fatalf("topic %q lost its channel: want %q, got %q", relationshipID, channel, topics[relationshipID])
		}
	}
}

// A planned change is a proposal: it shows up under activeChanges and leaves the
// applied model untouched until it is applied.
func TestPlannedChangeIsAProposalAndDoesNotTouchTheAppliedModel(t *testing.T) {
	h := newHarness(t)
	run := h.run("visualise-ai", "run-2026-08-04-0001")
	run.startRoot("orchestrator-root", "Extract VAT handling.")
	run.emitExample("architecture-snapshot.json")

	beforeIDs := func() []string {
		var architecture readapi.ArchitectureResponse
		h.getJSON("/api/v1/projects/visualise-ai/architecture", &architecture)
		return componentIDs(architecture.Components)
	}()

	run.emitExample("component-change-planned.json")

	var planned readapi.ArchitectureResponse
	h.getJSON("/api/v1/projects/visualise-ai/architecture", &planned)
	if got := componentIDs(planned.Components); len(got) != len(beforeIDs) {
		t.Fatalf("a planned change modified the applied model: %v -> %v", beforeIDs, got)
	}
	if contains(componentIDs(planned.Components), "shop-platform.orders.domain.tax") {
		t.Fatalf("the planned component reached the applied model")
	}
	if len(planned.ActiveChanges) != 1 {
		t.Fatalf("want exactly one pending change, got %+v", planned.ActiveChanges)
	}
	change := planned.ActiveChanges[0]
	if change.State != store.ChangeStatePlanned || change.ChangeID != "change-2026-08-04-0007" {
		t.Fatalf("unexpected pending change: %+v", change)
	}
	if change.TargetKind != store.ChangeTargetComponent || change.TargetID != "shop-platform.orders.domain.tax" {
		t.Fatalf("the change does not name its target: %+v", change)
	}
	// The reported descriptor travels with the proposal, so the canvas can draw
	// it next to the applied model without a second lookup.
	if !strings.Contains(string(change.Snapshot), `"Tax Calculation"`) {
		t.Fatalf("the proposal lost its descriptor: %s", change.Snapshot)
	}

	run.emitExample("component-change-applied.json")

	var applied readapi.ArchitectureResponse
	h.getJSON("/api/v1/projects/visualise-ai/architecture", &applied)
	if !contains(componentIDs(applied.Components), "shop-platform.orders.domain.tax") {
		t.Fatalf("the applied change did not reach the model: %v", componentIDs(applied.Components))
	}
	// Applied is no longer pending: it has become the model.
	if len(applied.ActiveChanges) != 0 {
		t.Fatalf("an applied change is not an active change any more: %+v", applied.ActiveChanges)
	}
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

// Plan revisions are append-only. A newer revision must not rewrite an older
// one, and a step update must only reach the revision that was current when it
// was reported.
func TestPlanRevisionsAreAppendOnlyAndComplete(t *testing.T) {
	h := newHarness(t)
	run := h.run("visualise-ai", "run-2026-08-04-0001")
	run.startRoot("orchestrator-root", "Deliver the cockpit.")

	run.emit("orchestrator-root", nil, store.TypePlanPublished, `{
		"planId": "plan-2026-08-04-0001",
		"revision": 1,
		"steps": [
			{"stepId": "step-contract", "order": 0, "title": "Define the contract", "state": "pending"},
			{"stepId": "step-store", "order": 1, "title": "Build the event store", "state": "pending"}
		]
	}`)
	run.emit("orchestrator-root", nil, store.TypePlanStepUpdated,
		`{"planId":"plan-2026-08-04-0001","stepId":"step-contract","state":"done"}`)

	run.emit("orchestrator-root", nil, store.TypePlanPublished, `{
		"planId": "plan-2026-08-04-0001",
		"revision": 2,
		"steps": [
			{"stepId": "step-contract", "order": 0, "title": "Define the contract", "state": "done"},
			{"stepId": "step-store", "order": 1, "title": "Build the event store", "state": "in_progress"},
			{"stepId": "step-readapi", "order": 2, "title": "Build the read API", "state": "pending"}
		]
	}`)
	run.emit("orchestrator-root", nil, store.TypePlanStepUpdated,
		`{"planId":"plan-2026-08-04-0001","stepId":"step-store","state":"done"}`)

	var plans readapi.PlansResponse
	h.getJSON("/api/v1/projects/visualise-ai/runs/current/plans", &plans)
	if len(plans.Plans) != 1 {
		t.Fatalf("want one plan, got %+v", plans.Plans)
	}
	plan := plans.Plans[0]
	if plan.CurrentRevision != 2 {
		t.Fatalf("want revision 2 to be current, got %d", plan.CurrentRevision)
	}
	if len(plan.Revisions) != 2 {
		t.Fatalf("want both revisions, got %d", len(plan.Revisions))
	}
	if plan.Revisions[0].Revision != 1 || plan.Revisions[1].Revision != 2 {
		t.Fatalf("revisions are not ascending: %+v", plan.Revisions)
	}
	if plan.Revisions[0].IsCurrent || !plan.Revisions[1].IsCurrent {
		t.Fatalf("the current revision is marked wrong: %+v", plan.Revisions)
	}

	first := plan.Revisions[0]
	if len(first.Steps) != 2 {
		t.Fatalf("revision 1 must keep exactly the two steps it was published with: %+v", first.Steps)
	}
	if first.Steps[0].StepID != "step-contract" || first.Steps[1].StepID != "step-store" {
		t.Fatalf("revision 1 lost its step order: %+v", first.Steps)
	}
	// The first update landed on revision 1 while it was current; the second one
	// went to revision 2 and must not have reached back.
	if first.Steps[0].State != "done" {
		t.Fatalf("revision 1 lost the update it received while current: %+v", first.Steps[0])
	}
	if first.Steps[1].State != "pending" {
		t.Fatalf("an update of a later revision rewrote revision 1: %+v", first.Steps[1])
	}

	second := plan.Revisions[1]
	if len(second.Steps) != 3 {
		t.Fatalf("revision 2 must carry all three steps: %+v", second.Steps)
	}
	if second.Steps[1].State != "done" {
		t.Fatalf("revision 2 did not receive its own update: %+v", second.Steps[1])
	}
	if second.Steps[2].State != "pending" {
		t.Fatalf("an unrelated step of revision 2 changed: %+v", second.Steps[2])
	}
}

// ---------------------------------------------------------------------------
// Component inspector
// ---------------------------------------------------------------------------

// The inspector shows every kind of evidence of its own component and nothing of
// its neighbour, even when both were reported by the same agent in the same run.
func TestComponentInspectorCarriesOnlyItsOwnEvidence(t *testing.T) {
	h := newHarness(t)
	const (
		mine    = "shop-platform.orders.domain.pricing"
		theirs  = "shop-platform.orders.domain.tax"
		project = "visualise-ai"
	)

	run := h.run(project, "run-2026-08-04-0001")
	run.startRoot("orchestrator-root", "Extract VAT handling.")
	run.startSub("subagent-implementer", "orchestrator-root", "Change the pricing module.")
	run.emitExample("architecture-snapshot.json")

	run.emit("subagent-implementer", nil, store.TypeWorkStepStarted, fmt.Sprintf(
		`{"workStepId":"work-pricing","title":"Rework Total()","componentIds":[%q]}`, mine))
	run.emit("subagent-implementer", nil, store.TypeFeedbackPublished, feedbackPayload("feedback-mine", mine, "Mine"))
	run.emit("subagent-implementer", nil, store.TypeDiffReported, diffPayload("diff-mine", mine, "internal/pricing.go"))
	run.emit("subagent-implementer", nil, store.TypeRiskReported, fmt.Sprintf(
		`{"riskId":"risk-mine","componentIds":[%q],"title":"Rounding is undefined","severity":"medium"}`, mine))
	run.emit("subagent-implementer", nil, store.TypeProblemReported, fmt.Sprintf(
		`{"problemId":"problem-mine","componentIds":[%q],"title":"Test fixture missing"}`, mine))
	run.emit("subagent-implementer", nil, store.TypeComponentChangePlanned, fmt.Sprintf(`{
		"changeId": "change-mine",
		"operation": "modify",
		"component": {"componentId": %q, "name": "Pricing", "kind": "module",
			"parentComponentId": "shop-platform.orders.domain"},
		"rationale": "Split VAT out."
	}`, mine))

	// The same agent reports the same kinds of evidence for the neighbour.
	run.emit("subagent-implementer", nil, store.TypeFeedbackPublished, feedbackPayload("feedback-theirs", theirs, "Theirs"))
	run.emit("subagent-implementer", nil, store.TypeDiffReported, diffPayload("diff-theirs", theirs, "internal/tax.go"))
	run.emit("subagent-implementer", nil, store.TypeRiskReported, fmt.Sprintf(
		`{"riskId":"risk-theirs","componentIds":[%q],"title":"Unmapped country","severity":"high"}`, theirs))
	run.emit("subagent-implementer", nil, store.TypeProblemReported, fmt.Sprintf(
		`{"problemId":"problem-theirs","componentIds":[%q],"title":"Rate table stale"}`, theirs))

	var inspector readapi.ComponentResponse
	h.getJSON("/api/v1/projects/"+project+"/components/"+mine, &inspector)

	if inspector.Component == nil || inspector.Component.ComponentID != mine {
		t.Fatalf("want the applied component, got %+v", inspector.Component)
	}
	if inspector.CurrentWorkStep == nil || inspector.CurrentWorkStep.WorkStepID != "work-pricing" {
		t.Fatalf("want the open work step, got %+v", inspector.CurrentWorkStep)
	}
	if inspector.CurrentWorkStep.CompletedAt != nil {
		t.Fatalf("the work step was never completed: %+v", inspector.CurrentWorkStep)
	}
	if inspector.ResponsibleAgent == nil || inspector.ResponsibleAgent.AgentID != "subagent-implementer" {
		t.Fatalf("want the agent of the work step, got %+v", inspector.ResponsibleAgent)
	}
	if parent := inspector.ResponsibleAgent.ParentAgentID; parent == nil || *parent != "orchestrator-root" {
		t.Fatalf("the responsible agent lost its place in the tree: %v", parent)
	}

	assertOnlyOwn := func(kind string, ids []string) {
		t.Helper()
		if len(ids) != 1 || !strings.HasSuffix(ids[0], "-mine") {
			t.Fatalf("%s: want exactly the own evidence, got %v", kind, ids)
		}
	}
	assertOnlyOwn("feedback", mapIDs(len(inspector.Feedback), func(i int) string { return inspector.Feedback[i].FeedbackID }))
	assertOnlyOwn("diffs", mapIDs(len(inspector.Diffs), func(i int) string { return inspector.Diffs[i].DiffID }))
	assertOnlyOwn("risks", mapIDs(len(inspector.Risks), func(i int) string { return inspector.Risks[i].RiskID }))
	assertOnlyOwn("problems", mapIDs(len(inspector.Problems), func(i int) string { return inspector.Problems[i].ProblemID }))
	assertOnlyOwn("activeChanges", mapIDs(len(inspector.ActiveChanges), func(i int) string {
		return inspector.ActiveChanges[i].ChangeID
	}))

	if inspector.Feedback[0].Body == "" || inspector.Diffs[0].UnifiedDiff == "" {
		t.Fatalf("the inspector must carry the reported bodies verbatim: %+v", inspector.Feedback[0])
	}

	// The neighbour sees its own evidence, and only its own.
	var neighbour readapi.ComponentResponse
	h.getJSON("/api/v1/projects/"+project+"/components/"+theirs, &neighbour)
	if len(neighbour.Feedback) != 1 || neighbour.Feedback[0].FeedbackID != "feedback-theirs" {
		t.Fatalf("the neighbour inspector is wrong: %+v", neighbour.Feedback)
	}
	if neighbour.CurrentWorkStep != nil {
		t.Fatalf("no work step named the neighbour, so none may be shown: %+v", neighbour.CurrentWorkStep)
	}
}

// A component that a snapshot removed keeps its history and stays inspectable;
// only the applied descriptor is gone.
func TestRemovedComponentKeepsItsHistory(t *testing.T) {
	h := newHarness(t)
	const componentID = "shop-platform.legacy"
	run := h.run("visualise-ai", "run-2026-08-04-0001")
	run.startRoot("orchestrator-root", "Retire the legacy module.")
	run.emit("orchestrator-root", nil, store.TypeArchitectureSnapshotPublished, fmt.Sprintf(`{
		"snapshotId": "snapshot-1",
		"components": [{"componentId": %q, "name": "Legacy", "kind": "module", "parentComponentId": null}],
		"relationships": []
	}`, componentID))
	run.emit("orchestrator-root", nil, store.TypeFeedbackPublished, feedbackPayload("feedback-legacy", componentID, "Retire it"))
	// A second snapshot without the component removes it from the applied model.
	run.emit("orchestrator-root", nil, store.TypeArchitectureSnapshotPublished,
		`{"snapshotId":"snapshot-2","components":[],"relationships":[]}`)

	var inspector readapi.ComponentResponse
	h.getJSON("/api/v1/projects/visualise-ai/components/"+componentID, &inspector)
	if inspector.Component != nil {
		t.Fatalf("the component left the applied model, so it must be null: %+v", inspector.Component)
	}
	if len(inspector.Feedback) != 1 {
		t.Fatalf("the evidence must survive the removal: %+v", inspector.Feedback)
	}

	// The removing snapshot names no component at all, so it links to none: the
	// history holds the two events that actually mentioned this component.
	var history readapi.HistoryResponse
	h.getJSON("/api/v1/projects/visualise-ai/components/"+componentID+"/history", &history)
	if len(history.Entries) != 2 {
		t.Fatalf("want the first snapshot and the feedback, got %d: %+v", len(history.Entries), history.Entries)
	}
	if history.Entries[1].Type != store.TypeArchitectureSnapshotPublished {
		t.Fatalf("the oldest entry must be the snapshot that introduced the component: %+v", history.Entries)
	}
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

// Paging through the run list must visit every run exactly once.
func TestRunPaginationIsGapFreeAndDuplicateFree(t *testing.T) {
	h := newHarness(t)

	const total = 7
	want := make(map[string]bool, total)
	for i := 1; i <= total; i++ {
		runID := fmt.Sprintf("run-2026-08-04-%04d", i)
		want[runID] = false
		h.run("visualise-ai", runID).startRoot("orchestrator-root", "Run "+runID)
	}

	path := "/api/v1/projects/visualise-ai/runs?limit=3"
	pages := 0
	seen := 0
	var previous *readapi.RunSummary
	for {
		pages++
		if pages > total+1 {
			t.Fatalf("pagination does not terminate")
		}
		var page readapi.RunsResponse
		h.getJSON(path, &page)
		for i := range page.Runs {
			run := page.Runs[i]
			already, known := want[run.RunID]
			if !known {
				t.Fatalf("unknown run %q in a page", run.RunID)
			}
			if already {
				t.Fatalf("run %q was returned twice", run.RunID)
			}
			want[run.RunID] = true
			seen++
			// The ordering must hold across the page boundary as well.
			if previous != nil && !previous.StartedAt.After(run.StartedAt) {
				t.Fatalf("ordering broke at %q -> %q", previous.RunID, run.RunID)
			}
			previous = &run
		}
		if page.NextCursor == nil {
			break
		}
		path = "/api/v1/projects/visualise-ai/runs?limit=3&cursor=" + *page.NextCursor
	}
	if seen != total {
		t.Fatalf("want %d runs across the pages, got %d", total, seen)
	}
	if pages != 3 {
		t.Fatalf("want three pages of 3+3+1, got %d", pages)
	}
}

// The same for the component history, whose cursor is a project position.
func TestHistoryPaginationIsGapFreeAndDuplicateFree(t *testing.T) {
	h := newHarness(t)
	const componentID = "shop-platform.orders"
	run := h.run("visualise-ai", "run-2026-08-04-0001")
	run.startRoot("orchestrator-root", "Report a lot.")

	const total = 5
	for i := 1; i <= total; i++ {
		run.emit("orchestrator-root", nil, store.TypeFeedbackPublished,
			feedbackPayload(fmt.Sprintf("feedback-%02d", i), componentID, fmt.Sprintf("Review %d", i)))
	}

	path := "/api/v1/projects/visualise-ai/components/" + componentID + "/history?limit=2"
	var positions []int64
	for {
		var page readapi.HistoryResponse
		h.getJSON(path, &page)
		for _, entry := range page.Entries {
			positions = append(positions, entry.Position)
		}
		if page.NextCursor == nil {
			break
		}
		path = "/api/v1/projects/visualise-ai/components/" + componentID +
			"/history?limit=2&cursor=" + *page.NextCursor
	}

	if len(positions) != total {
		t.Fatalf("want %d history entries, got %d: %v", total, len(positions), positions)
	}
	for i := 1; i < len(positions); i++ {
		if positions[i] >= positions[i-1] {
			t.Fatalf("history positions are not strictly descending: %v", positions)
		}
	}
}

// The inspector pages its diffs, because one component can accumulate more
// unified diffs than a single response should carry.
func TestInspectorPagesItsDiffs(t *testing.T) {
	h := newHarness(t)
	const componentID = "shop-platform.orders"
	run := h.run("visualise-ai", "run-2026-08-04-0001")
	run.startRoot("orchestrator-root", "Change many files.")

	const total = 5
	for i := 1; i <= total; i++ {
		run.emit("orchestrator-root", nil, store.TypeDiffReported, diffPayload(
			fmt.Sprintf("diff-%02d", i), componentID, fmt.Sprintf("internal/orders/file%02d.go", i)))
	}

	path := "/api/v1/projects/visualise-ai/components/" + componentID + "?diffLimit=2"
	seen := map[string]bool{}
	for {
		var page readapi.ComponentResponse
		h.getJSON(path, &page)
		for _, diff := range page.Diffs {
			if seen[diff.DiffID] {
				t.Fatalf("diff %q was returned twice", diff.DiffID)
			}
			seen[diff.DiffID] = true
		}
		if page.NextDiffCursor == nil {
			break
		}
		path = "/api/v1/projects/visualise-ai/components/" + componentID +
			"?diffLimit=2&diffCursor=" + *page.NextDiffCursor
	}
	if len(seen) != total {
		t.Fatalf("want %d diffs across the pages, got %d", total, len(seen))
	}
}

// A limit outside the documented range is a client error, not a silently
// clamped page: a UI must not believe it received everything.
func TestInvalidPaginationParametersAreRejected(t *testing.T) {
	h := newHarness(t)
	h.run("visualise-ai", "run-2026-08-04-0001").startRoot("orchestrator-root", "Deliver.")

	cases := []struct {
		path      string
		wantField string
	}{
		{"/api/v1/projects/visualise-ai/runs?limit=0", "/limit"},
		{"/api/v1/projects/visualise-ai/runs?limit=201", "/limit"},
		{"/api/v1/projects/visualise-ai/runs?limit=-1", "/limit"},
		{"/api/v1/projects/visualise-ai/runs?limit=many", "/limit"},
		{"/api/v1/projects/visualise-ai/runs?cursor=not-a-cursor", "/cursor"},
	}
	for _, testCase := range cases {
		problem := h.getProblem(testCase.path, http.StatusBadRequest)
		if problem.Code != "invalid_query_parameter" {
			t.Fatalf("GET %s: want invalid_query_parameter, got %q", testCase.path, problem.Code)
		}
		if len(problem.Errors) != 1 || problem.Errors[0].Field != testCase.wantField {
			t.Fatalf("GET %s: want a field error on %s, got %+v", testCase.path, testCase.wantField, problem.Errors)
		}
	}

	// The upper bound itself is still accepted.
	var runs readapi.RunsResponse
	h.getJSON("/api/v1/projects/visualise-ai/runs?limit=200", &runs)
	if len(runs.Runs) != 1 {
		t.Fatalf("the maximum limit must be accepted, got %+v", runs.Runs)
	}
}

// ---------------------------------------------------------------------------
// projectPosition
// ---------------------------------------------------------------------------

// Every project scoped response repeats projects.last_position, which is what
// makes an HTTP snapshot and the SSE stream comparable.
func TestEveryResponseRepeatsTheProjectPosition(t *testing.T) {
	h := newHarness(t)
	const componentID = "shop-platform.orders"
	run := h.run("visualise-ai", "run-2026-08-04-0001")
	run.startRoot("orchestrator-root", "Deliver.")
	run.emit("orchestrator-root", nil, store.TypeArchitectureSnapshotPublished, fmt.Sprintf(`{
		"snapshotId": "snapshot-1",
		"components": [{"componentId": %q, "name": "Orders", "kind": "service", "parentComponentId": null}],
		"relationships": []
	}`, componentID))
	run.emit("orchestrator-root", nil, store.TypePlanPublished, `{
		"planId": "plan-1", "revision": 1,
		"steps": [{"stepId":"step-1","order":0,"title":"Start","state":"pending"}]
	}`)

	assertPositions := func(want int64) {
		t.Helper()
		type positioned struct {
			ProjectPosition int64 `json:"projectPosition"`
		}
		paths := []string{
			"/api/v1/projects",
			"/api/v1/projects/visualise-ai",
			"/api/v1/projects/visualise-ai/architecture",
			"/api/v1/projects/visualise-ai/runs",
			"/api/v1/projects/visualise-ai/runs/current",
			"/api/v1/projects/visualise-ai/runs/current/agents",
			"/api/v1/projects/visualise-ai/runs/current/plans",
			"/api/v1/projects/visualise-ai/components/" + componentID,
			"/api/v1/projects/visualise-ai/components/" + componentID + "/history",
		}
		for _, path := range paths {
			var body positioned
			h.getJSON(path, &body)
			if body.ProjectPosition != want {
				t.Fatalf("GET %s: want projectPosition %d, got %d", path, want, body.ProjectPosition)
			}
		}
	}

	assertPositions(h.lastPosition("visualise-ai"))

	// One more event moves the position of every response together.
	result := run.emit("orchestrator-root", nil, store.TypeAgentStatusReported, `{"status":"working"}`)
	if result.Position != h.lastPosition("visualise-ai") {
		t.Fatalf("the store and the projection disagree on the position")
	}
	assertPositions(result.Position)
}

// ---------------------------------------------------------------------------
// Acceptance: a UI rebuilds the whole v0 state from the read endpoints alone
// ---------------------------------------------------------------------------

// This is the acceptance criterion of the issue: after a realistic event
// sequence, architecture, runs, the agent tree, the plans and the component
// evidence are reconstructed exclusively through the read endpoints — no query
// touches the event log, and none of them needs a second round trip per row.
func TestUIRebuildsTheFullV0StateFromReadEndpointsOnly(t *testing.T) {
	h := newHarness(t)
	const project = "visualise-ai"

	// A finished run from yesterday, so the reconstruction has to separate
	// current work from history.
	past := h.run(project, "run-2026-08-03-0001")
	past.startRoot("orchestrator-root", "Yesterday's run.")
	past.emit("orchestrator-root", nil, store.TypeFeedbackPublished, feedbackPayload(
		"feedback-yesterday", "shop-platform.orders.domain.pricing", "Yesterday"))
	past.emit("orchestrator-root", nil, store.TypeRunFinished, `{"outcome":"completed","summary":"Done."}`)

	run := h.run(project, "run-2026-08-04-0001")
	run.startRoot("orchestrator-root", "Extract VAT handling out of pricing.")
	run.emitExample("subagent-started.json")
	run.startSub("subagent-architecture-mapper", "orchestrator-root", "Map the architecture.")
	run.startSub("subagent-implementer", "orchestrator-root", "Implement the extraction.")
	run.startSub("subagent-reviewer", "subagent-implementer", "Review the extraction.")

	run.emit("orchestrator-root", nil, store.TypePlanPublished, `{
		"planId": "plan-2026-08-04-0001",
		"revision": 1,
		"steps": [
			{"stepId":"step-map","order":0,"title":"Map the architecture","state":"pending",
			 "componentIds":["shop-platform.orders.domain"]},
			{"stepId":"step-extract","order":1,"title":"Extract the tax module","state":"pending",
			 "componentIds":["shop-platform.orders.domain.pricing"]}
		]
	}`)
	run.emitExample("architecture-snapshot.json")
	run.emit("orchestrator-root", nil, store.TypePlanStepUpdated,
		`{"planId":"plan-2026-08-04-0001","stepId":"step-map","state":"done"}`)

	run.emitExample("component-change-planned.json")
	run.emit("subagent-implementer", nil, store.TypeWorkStepStarted, `{
		"workStepId": "work-extract-tax",
		"title": "Move VAT handling into its own module",
		"componentIds": ["shop-platform.orders.domain.pricing"],
		"planStepId": "step-extract"
	}`)
	run.emitExample("diff-reported.json")
	run.emitExample("component-change-applied.json")
	run.emitExample("feedback-published.json")
	run.emit("subagent-implementer", nil, store.TypeAgentProgressReported,
		`{"percent":80,"scope":"own_task","basis":"completed_steps"}`)
	// A pending proposal that is deliberately left open.
	run.emit("subagent-architecture-mapper", nil, store.TypeRelationshipChangePlanned, `{
		"changeId": "change-pricing-tax-dependency",
		"operation": "add",
		"relationship": {
			"relationshipId": "rel-pricing-tax",
			"sourceComponentId": "shop-platform.orders.domain.pricing",
			"targetComponentId": "shop-platform.orders.domain.tax",
			"kind": "dependency",
			"label": "Delegates VAT"
		},
		"rationale": "Pricing will call into the new tax module."
	}`)

	position := h.lastPosition(project)

	// 1. The project list and the project itself.
	var projects readapi.ProjectsResponse
	h.getJSON("/api/v1/projects", &projects)
	if len(projects.Projects) != 1 || projects.Projects[0].CurrentRunID == nil ||
		*projects.Projects[0].CurrentRunID != "run-2026-08-04-0001" {
		t.Fatalf("the project list does not point at the current run: %+v", projects.Projects)
	}

	var detail readapi.ProjectResponse
	h.getJSON("/api/v1/projects/"+project, &detail)
	if detail.Project.Counts.Runs != 2 || detail.Project.Counts.OpenRuns != 1 {
		t.Fatalf("want two runs, one open, got %+v", detail.Project.Counts)
	}

	// 2. The architecture, including the applied change and the open proposal.
	var architecture readapi.ArchitectureResponse
	h.getJSON("/api/v1/projects/"+project+"/architecture", &architecture)
	ids := componentIDs(architecture.Components)
	if !contains(ids, "shop-platform.orders.domain.tax") {
		t.Fatalf("the applied change is missing from the model: %v", ids)
	}
	if len(architecture.Relationships) != 8 {
		t.Fatalf("want the eight applied relationships, got %d", len(architecture.Relationships))
	}
	if len(architecture.ActiveChanges) != 1 ||
		architecture.ActiveChanges[0].ChangeID != "change-pricing-tax-dependency" {
		t.Fatalf("want exactly the open proposal, got %+v", architecture.ActiveChanges)
	}
	// The proposal must not have reached the applied edges.
	for _, relationship := range architecture.Relationships {
		if relationship.RelationshipID == "rel-pricing-tax" {
			t.Fatalf("a planned relationship reached the applied model")
		}
	}

	// 3. Runs: the current one and the history, cleanly separated.
	var runs readapi.RunsResponse
	h.getJSON("/api/v1/projects/"+project+"/runs", &runs)
	if len(runs.Runs) != 2 || !runs.Runs[0].IsCurrent || runs.Runs[1].IsOpen {
		t.Fatalf("runs are not separated into current and history: %+v", runs.Runs)
	}

	// 4. The agent tree of the current run.
	var agents readapi.AgentsResponse
	h.getJSON("/api/v1/projects/"+project+"/runs/current/agents", &agents)
	if len(agents.Agents) != 5 {
		t.Fatalf("want the root and its four subagents, got %d: %+v", len(agents.Agents), agents.Agents)
	}
	children := map[string]int{}
	for _, agent := range agents.Agents {
		if agent.ParentAgentID != nil {
			children[*agent.ParentAgentID]++
		}
	}
	if children["orchestrator-root"] != 3 || children["subagent-implementer"] != 1 {
		t.Fatalf("the spawn hierarchy is wrong: %v", children)
	}

	// 5. The plans with their revisions and steps.
	var plans readapi.PlansResponse
	h.getJSON("/api/v1/projects/"+project+"/runs/current/plans", &plans)
	if len(plans.Plans) != 1 || len(plans.Plans[0].Revisions) != 1 {
		t.Fatalf("want one plan with one revision, got %+v", plans.Plans)
	}
	steps := plans.Plans[0].Revisions[0].Steps
	if len(steps) != 2 || steps[0].State != "done" || steps[1].State != "pending" {
		t.Fatalf("the plan steps were not reconstructed: %+v", steps)
	}

	// 6. The component inspector of the current run.
	var inspector readapi.ComponentResponse
	h.getJSON("/api/v1/projects/"+project+"/components/shop-platform.orders.domain.pricing", &inspector)
	if inspector.ProjectPosition != position {
		t.Fatalf("want projectPosition %d, got %d", position, inspector.ProjectPosition)
	}
	if inspector.Component == nil || inspector.Component.Name != "Pricing" {
		t.Fatalf("the inspector lost its component: %+v", inspector.Component)
	}
	if inspector.CurrentWorkStep == nil || inspector.CurrentWorkStep.WorkStepID != "work-extract-tax" {
		t.Fatalf("want the open work step, got %+v", inspector.CurrentWorkStep)
	}
	if step := inspector.CurrentWorkStep.PlanStepID; step == nil || *step != "step-extract" {
		t.Fatalf("the work step lost its link into the plan: %v", step)
	}
	if inspector.ResponsibleAgent == nil || inspector.ResponsibleAgent.AgentID != "subagent-implementer" {
		t.Fatalf("want the implementing subagent, got %+v", inspector.ResponsibleAgent)
	}
	if len(inspector.Diffs) != 1 || inspector.Diffs[0].DiffID != "diff-2026-08-04-0011" {
		t.Fatalf("want the reported diff of this run, got %+v", inspector.Diffs)
	}
	if !strings.Contains(inspector.Diffs[0].UnifiedDiff, "@@") {
		t.Fatalf("the unified diff was not handed through verbatim")
	}
	if len(inspector.Feedback) != 1 || inspector.Feedback[0].FeedbackID != "feedback-2026-08-04-0003" {
		t.Fatalf("want the review of this run, got %+v", inspector.Feedback)
	}
	// Yesterday's feedback belongs to the history, not to the current inspector.
	for _, entry := range inspector.Feedback {
		if entry.FeedbackID == "feedback-yesterday" {
			t.Fatalf("the inspector mixed in evidence of a historical run")
		}
	}

	// 7. The run spanning history of the same component.
	var history readapi.HistoryResponse
	h.getJSON("/api/v1/projects/"+project+"/components/shop-platform.orders.domain.pricing/history", &history)
	types := map[string]int{}
	runsSeen := map[string]bool{}
	for _, entry := range history.Entries {
		types[entry.Type]++
		runsSeen[entry.RunID] = true
	}
	if !runsSeen["run-2026-08-03-0001"] || !runsSeen["run-2026-08-04-0001"] {
		t.Fatalf("the history does not span both runs: %v", runsSeen)
	}
	for _, wanted := range []string{
		store.TypeArchitectureSnapshotPublished,
		store.TypeWorkStepStarted,
		store.TypeDiffReported,
		store.TypeFeedbackPublished,
		store.TypePlanPublished,
	} {
		if types[wanted] == 0 {
			t.Fatalf("the history is missing %s: %v", wanted, types)
		}
	}
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

func feedbackPayload(feedbackID, componentID, title string) string {
	return fmt.Sprintf(`{
		"feedbackId": %q,
		"componentIds": [%q],
		"format": "markdown",
		"title": %q,
		"body": "## %s\n\nReported observation."
	}`, feedbackID, componentID, title, title)
}

func diffPayload(diffID, componentID, filePath string) string {
	return fmt.Sprintf(`{
		"diffId": %q,
		"componentIds": [%q],
		"filePath": %q,
		"unifiedDiff": "--- a/%s\n+++ b/%s\n@@ -1,2 +1,2 @@\n-old\n+new\n"
	}`, diffID, componentID, filePath, filePath, filePath)
}

func mapIDs(count int, at func(int) string) []string {
	out := make([]string, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, at(i))
	}
	return out
}
