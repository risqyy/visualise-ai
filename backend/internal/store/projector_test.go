package store

import (
	"testing"
)

// A snapshot is authoritative: everything missing from it stops existing.
func TestArchitectureSnapshotReplacesTheAppliedModel(t *testing.T) {
	s := newScenario(t)
	s.startRun()

	s.append(s.loadExample("architecture-snapshot.json"))

	if got := s.mustCount(&Component{}, "project_id = ?", s.projectID); got != 15 {
		t.Fatalf("components after the first snapshot = %d, want 15", got)
	}
	if got := s.mustCount(&Relationship{}, "project_id = ?", s.projectID); got != 8 {
		t.Fatalf("relationships after the first snapshot = %d, want 8", got)
	}

	// The hierarchy is carried by parentComponentId, four levels deep.
	pricing := s.component("shop-platform.orders.domain.pricing")
	if pricing.ParentComponentID == nil || *pricing.ParentComponentID != "shop-platform.orders.domain" {
		t.Errorf("pricing.parent_component_id = %v, want shop-platform.orders.domain", pricing.ParentComponentID)
	}
	root := s.component("shop-platform")
	if root.ParentComponentID != nil {
		t.Errorf("the root component has parent %v, want NULL", *root.ParentComponentID)
	}
	storefront := s.component("shop-platform.storefront")
	if string(storefront.Tags) == "" || string(storefront.Technology) == "" {
		t.Errorf("technology/tags were not stored: %q / %q", storefront.Technology, storefront.Tags)
	}
	// Every NATS topic keeps its own edge; nothing is merged.
	if got := s.mustCount(&Relationship{}, "project_id = ? AND kind = ?", s.projectID, "nats_topic"); got != 3 {
		t.Errorf("nats_topic relationships = %d, want 3", got)
	}

	s.emit("subagent-architecture-mapper", ptr("orchestrator-root"), TypeArchitectureSnapshotPublished, `{
		"snapshotId": "snapshot-2026-08-04-0002",
		"components": [
			{"componentId": "shop-platform", "name": "Shop Platform", "kind": "system", "parentComponentId": null}
		],
		"relationships": []
	}`)

	if got := s.mustCount(&Component{}, "project_id = ?", s.projectID); got != 1 {
		t.Errorf("components after the replacing snapshot = %d, want 1", got)
	}
	if got := s.mustCount(&Relationship{}, "project_id = ?", s.projectID); got != 0 {
		t.Errorf("relationships after the replacing snapshot = %d, want 0", got)
	}
}

// A planned change is a proposal. It must be visible as such and must not touch
// the applied model.
func TestComponentChangePlannedDoesNotTouchTheAppliedModel(t *testing.T) {
	s := newScenario(t)
	s.startRun()

	s.append(s.loadExample("component-change-planned.json"))

	const componentID = "shop-platform.orders.domain.tax"
	if got := s.mustCount(&Component{}, "project_id = ? AND component_id = ?", s.projectID, componentID); got != 0 {
		t.Fatalf("the planned change created %d component rows, want 0", got)
	}

	change := s.activeChange("change-2026-08-04-0007")
	if change.State != ChangeStatePlanned {
		t.Errorf("change state = %q, want %q", change.State, ChangeStatePlanned)
	}
	if change.TargetKind != ChangeTargetComponent || change.TargetID != componentID {
		t.Errorf("change target = %s/%s, want component/%s", change.TargetKind, change.TargetID, componentID)
	}
	if change.Operation != OperationAdd {
		t.Errorf("change operation = %q, want %q", change.Operation, OperationAdd)
	}
	if change.PlannedAt == nil {
		t.Error("planned_at was not written")
	}
	if change.AppliedAt != nil || change.RetractedAt != nil {
		t.Error("a planned change must not carry applied_at or retracted_at")
	}
	if len(change.Snapshot) == 0 {
		t.Error("the reported descriptor was not stored in snapshot")
	}
}

// Applying a change merges it into the model and closes the planned change.
func TestComponentChangeAppliedUpdatesTheModelAndClosesThePlannedChange(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	s.append(s.loadExample("component-change-planned.json"))
	planned := s.activeChange("change-2026-08-04-0007")

	s.append(s.loadExample("component-change-applied.json"))

	const componentID = "shop-platform.orders.domain.tax"
	component := s.component(componentID)
	if component.Name != "Tax Calculation" || component.Kind != "module" {
		t.Errorf("applied component = %+v, want the reported descriptor", component)
	}
	if component.ParentComponentID == nil || *component.ParentComponentID != "shop-platform.orders.domain" {
		t.Errorf("applied component parent = %v", component.ParentComponentID)
	}
	if component.AppliedByAgentID != "subagent-architecture-mapper" || component.AppliedRunID != s.runID {
		t.Errorf("applied metadata = %s/%s", component.AppliedByAgentID, component.AppliedRunID)
	}

	change := s.activeChange("change-2026-08-04-0007")
	if change.State != ChangeStateApplied {
		t.Errorf("change state = %q, want %q", change.State, ChangeStateApplied)
	}
	if change.AppliedAt == nil {
		t.Error("applied_at was not written")
	}
	if change.PlannedAt == nil || !change.PlannedAt.Equal(*planned.PlannedAt) {
		t.Error("applying a change must keep the moment it was planned")
	}

	// Removing it again drops the row from the applied model.
	s.emit("subagent-architecture-mapper", ptr("orchestrator-root"), TypeComponentChangeApplied, `{
		"changeId": "change-2026-08-04-0008",
		"operation": "remove",
		"component": {
			"componentId": "shop-platform.orders.domain.tax",
			"name": "Tax Calculation",
			"kind": "module",
			"parentComponentId": "shop-platform.orders.domain"
		}
	}`)
	if got := s.mustCount(&Component{}, "project_id = ? AND component_id = ?", s.projectID, componentID); got != 0 {
		t.Errorf("component rows after the remove = %d, want 0", got)
	}
}

// run.finished is optional. A run stays open until it arrives; the backend
// never infers a terminal state from silence.
func TestRunStaysOpenUntilRunFinishedArrives(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	s.emit("orchestrator-root", nil, TypeAgentFinished, `{"outcome":"completed","summary":"done"}`)

	if run := s.run(); !run.IsOpen || run.FinishedAt != nil || run.Outcome != nil {
		t.Fatalf("the run closed without run.finished: %+v", run)
	}

	s.append(s.loadExample("run-finished.json"))

	run := s.run()
	if run.IsOpen {
		t.Error("run.finished did not close the run")
	}
	if run.FinishedAt == nil {
		t.Error("finished_at was not written")
	}
	if run.Outcome == nil || *run.Outcome != "completed" {
		t.Errorf("run outcome = %v, want completed", run.Outcome)
	}
	if run.RootAgentID != "orchestrator-root" {
		t.Errorf("root_agent_id = %q, want orchestrator-root", run.RootAgentID)
	}
}

// The agent tree is expressed through parentAgentId and may nest arbitrarily.
func TestNestedAgentTreeIsProjected(t *testing.T) {
	s := newScenario(t)
	s.startRun()

	s.emit("subagent-contract", ptr("orchestrator-root"), TypeAgentStarted, `{
		"role": "subagent", "displayName": "Contract Agent", "assignedTask": "Define the event contract."
	}`)
	s.emit("subagent-store", ptr("orchestrator-root"), TypeAgentStarted, `{
		"role": "subagent", "displayName": "Store Agent", "assignedTask": "Implement the event store."
	}`)
	s.emit("subagent-projections", ptr("subagent-store"), TypeAgentStarted, `{
		"role": "subagent", "displayName": "Projection Agent", "assignedTask": "Implement the read models."
	}`)
	s.emit("subagent-migrations", ptr("subagent-projections"), TypeAgentStarted, `{
		"role": "subagent", "displayName": "Migration Agent", "assignedTask": "Wire AutoMigrate into the bootstrap."
	}`)

	if got := s.mustCount(&Agent{}, "project_id = ? AND run_id = ?", s.projectID, s.runID); got != 5 {
		t.Fatalf("agents = %d, want 5", got)
	}

	root := s.agent("orchestrator-root")
	if root.ParentAgentID != nil {
		t.Errorf("the root orchestrator has parent %v, want NULL", *root.ParentAgentID)
	}
	if root.Role != roleOrchestrator {
		t.Errorf("root role = %q, want %q", root.Role, roleOrchestrator)
	}

	for child, wantParent := range map[string]string{
		"subagent-contract":    "orchestrator-root",
		"subagent-store":       "orchestrator-root",
		"subagent-projections": "subagent-store",
		"subagent-migrations":  "subagent-projections",
	} {
		agent := s.agent(child)
		if agent.ParentAgentID == nil || *agent.ParentAgentID != wantParent {
			t.Errorf("%s.parent_agent_id = %v, want %s", child, agent.ParentAgentID, wantParent)
		}
		if agent.Role != "subagent" {
			t.Errorf("%s.role = %q, want subagent", child, agent.Role)
		}
	}

	// Only the root orchestrator owns the run and the project's current run.
	if run := s.run(); run.RootAgentID != "orchestrator-root" {
		t.Errorf("root_agent_id = %q, want orchestrator-root", run.RootAgentID)
	}
	if project := s.project(); project.CurrentRunID != s.runID {
		t.Errorf("projects.current_run_id = %q, want %q", project.CurrentRunID, s.runID)
	}
}

// Every projection an event touches records the position it was written at.
func TestLastAppliedProjectPositionAdvancesOnTouchedProjections(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	s.emit("subagent-reviewer", ptr("orchestrator-root"), TypeAgentStarted, `{
		"role": "subagent", "displayName": "Reviewer", "assignedTask": "Review the extraction."
	}`)

	feedback := s.append(s.loadExample("feedback-published.json"))

	if project := s.project(); project.LastAppliedProjectPosition != feedback.Position {
		t.Errorf("projects.last_applied_project_position = %d, want %d",
			project.LastAppliedProjectPosition, feedback.Position)
	}
	if run := s.run(); run.LastAppliedProjectPosition != feedback.Position {
		t.Errorf("runs.last_applied_project_position = %d, want %d",
			run.LastAppliedProjectPosition, feedback.Position)
	}
	if agent := s.agent("subagent-reviewer"); agent.LastAppliedProjectPosition != feedback.Position {
		t.Errorf("agents.last_applied_project_position = %d, want %d",
			agent.LastAppliedProjectPosition, feedback.Position)
	}

	var entry FeedbackEntry
	if err := s.db.Where("project_id = ? AND feedback_id = ?", s.projectID, "feedback-2026-08-04-0003").
		Take(&entry).Error; err != nil {
		t.Fatalf("loading the feedback entry: %v", err)
	}
	if entry.LastAppliedProjectPosition != feedback.Position || entry.SourcePosition != feedback.Position {
		t.Errorf("feedback positions = %d/%d, want %d",
			entry.SourcePosition, entry.LastAppliedProjectPosition, feedback.Position)
	}

	// An untouched projection keeps the position it was last written at.
	orchestrator := s.agent("orchestrator-root")
	if orchestrator.LastAppliedProjectPosition >= feedback.Position {
		t.Errorf("the orchestrator row advanced to %d although it reported nothing",
			orchestrator.LastAppliedProjectPosition)
	}
}

// Component history is served by the join table, in position order, without
// scanning payloads.
func TestComponentHistoryIsOrderedByPosition(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	s.emit("subagent-implementer", ptr("orchestrator-root"), TypeAgentStarted, `{
		"role": "subagent", "displayName": "Implementer", "assignedTask": "Extract VAT handling."
	}`)

	const pricing = "shop-platform.orders.domain.pricing"
	const tax = "shop-platform.orders.domain.tax"

	snapshot := s.append(s.loadExample("architecture-snapshot.json"))
	work := s.emit("subagent-implementer", ptr("orchestrator-root"), TypeWorkStepStarted, `{
		"workStepId": "work-2026-08-04-0004",
		"title": "Extract VAT handling into its own module",
		"componentIds": ["shop-platform.orders.domain.pricing"]
	}`)
	diff := s.append(s.loadExample("diff-reported.json"))
	planned := s.append(s.loadExample("component-change-planned.json"))

	type row struct {
		Position int64
		Type     string
	}
	var history []row
	err := s.db.Table("event_components AS ec").
		Select("ec.position, e.type").
		Joins("JOIN events AS e ON e.project_id = ec.project_id AND e.position = ec.position").
		Where("ec.project_id = ? AND ec.component_id = ?", s.projectID, pricing).
		Order("ec.position").
		Scan(&history).Error
	if err != nil {
		t.Fatalf("reading the component history: %v", err)
	}

	want := []row{
		{snapshot.Position, TypeArchitectureSnapshotPublished},
		{work.Position, TypeWorkStepStarted},
		{diff.Position, TypeDiffReported},
	}
	if len(history) != len(want) {
		t.Fatalf("history for %s = %+v, want %+v", pricing, history, want)
	}
	for i, entry := range want {
		if history[i] != entry {
			t.Errorf("history[%d] = %+v, want %+v", i, history[i], entry)
		}
	}

	// The planned change is linked to the component it proposes, even though it
	// does not exist in the applied model yet.
	var taxPositions []int64
	if err := s.db.Model(&EventComponent{}).
		Where("project_id = ? AND component_id = ?", s.projectID, tax).
		Order("position").Pluck("position", &taxPositions).Error; err != nil {
		t.Fatalf("reading the history of %s: %v", tax, err)
	}
	if len(taxPositions) != 1 || taxPositions[0] != planned.Position {
		t.Errorf("history for %s = %v, want [%d]", tax, taxPositions, planned.Position)
	}
}

// A correction is a new event. The original stays in the log untouched and the
// read models show the corrected content.
func TestCorrectionProjectsTheCorrectedPayloadAndKeepsTheOriginal(t *testing.T) {
	s := newScenario(t)
	s.startRun()

	original := s.loadExample("diff-reported.json")
	// The correction example references this exact idempotency key.
	original.ClientEventID = "5d41402a-bc4b-4a76-b971-9d911017c592"
	originalResult := s.append(original)

	correction := s.append(s.loadExample("correction-issued.json"))

	// The corrected payload adds the tax module to the diff's components.
	if got := s.mustCount(&DiffComponent{}, "project_id = ? AND diff_id = ?", s.projectID, "diff-2026-08-04-0011"); got != 2 {
		t.Errorf("diff component links = %d, want 2", got)
	}

	var record EventCorrection
	if err := s.db.Where("project_id = ? AND position = ?", s.projectID, correction.Position).
		Take(&record).Error; err != nil {
		t.Fatalf("loading the correction record: %v", err)
	}
	if record.Kind != CorrectionKindCorrection {
		t.Errorf("correction kind = %q, want %q", record.Kind, CorrectionKindCorrection)
	}
	if record.TargetClientEventID != original.ClientEventID {
		t.Errorf("correction target = %q, want %q", record.TargetClientEventID, original.ClientEventID)
	}
	if record.CorrectedType == nil || *record.CorrectedType != TypeDiffReported {
		t.Errorf("corrected_type = %v, want %s", record.CorrectedType, TypeDiffReported)
	}

	var stored Event
	if err := s.db.Where("project_id = ? AND position = ?", s.projectID, originalResult.Position).
		Take(&stored).Error; err != nil {
		t.Fatalf("loading the corrected event: %v", err)
	}
	if stored.Type != TypeDiffReported || stored.ClientEventID != original.ClientEventID {
		t.Errorf("the original event was rewritten: %+v", stored)
	}
}

// A retraction withdraws an announced change without deleting anything.
func TestRetractionMarksTheChangeAndKeepsTheLog(t *testing.T) {
	s := newScenario(t)
	s.startRun()

	planned := s.loadExample("component-change-planned.json")
	plannedResult := s.append(planned)

	s.emit("subagent-architecture-mapper", ptr("orchestrator-root"), TypeRetractionIssued, `{
		"retractsClientEventId": "`+planned.ClientEventID+`",
		"reason": "The tax rules stay inside the pricing module for now."
	}`)

	change := s.activeChange("change-2026-08-04-0007")
	if change.State != ChangeStateRetracted {
		t.Errorf("change state = %q, want %q", change.State, ChangeStateRetracted)
	}
	if change.RetractedAt == nil {
		t.Error("retracted_at was not written")
	}
	if change.PlannedAt == nil {
		t.Error("the retraction dropped the moment the change was planned")
	}

	if got := s.mustCount(&Event{}, "project_id = ?", s.projectID); got != 3 {
		t.Errorf("stored events = %d, want 3 — a retraction never removes an event", got)
	}
	if got := s.mustCount(&Event{}, "project_id = ? AND position = ?", s.projectID, plannedResult.Position); got != 1 {
		t.Error("the retracted event is gone from the log")
	}
	if got := s.mustCount(&EventCorrection{}, "project_id = ? AND kind = ?", s.projectID, CorrectionKindRetraction); got != 1 {
		t.Errorf("retraction records = %d, want 1", got)
	}
}

// The catalogue is closed and the projector must be total over it: an event
// type without a projection branch fails the append.
func TestEveryCatalogueTypeIsProjected(t *testing.T) {
	s := newScenario(t)
	s.startRun()

	const parent = "orchestrator-root"
	subagent := ptr(parent)

	s.emit("subagent-implementer", subagent, TypeAgentStarted, `{
		"role": "subagent", "displayName": "Implementer", "assignedTask": "Extract VAT handling."
	}`)
	s.emit("subagent-implementer", subagent, TypeAgentStatusReported, `{"status":"working","note":"Writing the module."}`)
	s.emit("subagent-implementer", subagent, TypeAgentProgressReported, `{"percent":40,"scope":"own_task","basis":"completed_steps"}`)
	s.emit(parent, nil, TypePlanPublished, `{
		"planId": "plan-2026-08-04-0001",
		"revision": 1,
		"steps": [
			{"stepId": "step-1", "order": 0, "title": "Map the architecture", "state": "done", "componentIds": ["shop-platform"]},
			{"stepId": "step-2", "order": 1, "title": "Extract the tax module", "state": "pending"}
		]
	}`)
	s.emit(parent, nil, TypePlanStepUpdated, `{
		"planId": "plan-2026-08-04-0001", "stepId": "step-2", "state": "in_progress"
	}`)
	s.emit("subagent-implementer", subagent, TypeWorkStepStarted, `{
		"workStepId": "work-1", "title": "Create the tax module",
		"componentIds": ["shop-platform.orders.domain.pricing"], "planStepId": "step-2"
	}`)
	s.emit("subagent-implementer", subagent, TypeWorkStepCompleted, `{
		"workStepId": "work-1", "summary": "Tax rules live in their own module now."
	}`)
	s.append(s.loadExample("architecture-snapshot.json"))
	s.append(s.loadExample("component-change-planned.json"))
	s.append(s.loadExample("component-change-applied.json"))
	relationshipPlanned := s.event("subagent-implementer", subagent, TypeRelationshipChangePlanned, `{
		"changeId": "change-2026-08-04-0009",
		"operation": "add",
		"relationship": {
			"relationshipId": "rel-pricing-tax-dependency",
			"sourceComponentId": "shop-platform.orders.domain.pricing",
			"targetComponentId": "shop-platform.orders.domain.tax",
			"kind": "dependency", "label": "Tax rules"
		},
		"rationale": "Pricing delegates VAT handling to the new module."
	}`)
	s.append(relationshipPlanned)
	s.emit("subagent-implementer", subagent, TypeRelationshipChangeApplied, `{
		"changeId": "change-2026-08-04-0009",
		"operation": "add",
		"relationship": {
			"relationshipId": "rel-pricing-tax-dependency",
			"sourceComponentId": "shop-platform.orders.domain.pricing",
			"targetComponentId": "shop-platform.orders.domain.tax",
			"kind": "dependency", "label": "Tax rules"
		}
	}`)
	s.append(s.loadExample("feedback-published.json"))
	diff := s.loadExample("diff-reported.json")
	diff.ClientEventID = "5d41402a-bc4b-4a76-b971-9d911017c592"
	s.append(diff)
	s.emit("subagent-implementer", subagent, TypeRiskReported, `{
		"riskId": "risk-1", "componentIds": ["shop-platform.orders.domain.pricing"],
		"title": "Discount and tax order changed", "detail": "Percentage discounts now apply before VAT.",
		"severity": "medium"
	}`)
	s.emit("subagent-implementer", subagent, TypeProblemReported, `{
		"problemId": "problem-1", "componentIds": ["shop-platform.orders.domain.tax"],
		"title": "No rounding rule stated"
	}`)
	s.append(s.loadExample("correction-issued.json"))
	s.emit("subagent-implementer", subagent, TypeRetractionIssued, `{
		"retractsClientEventId": "`+relationshipPlanned.ClientEventID+`",
		"reason": "Superseded by the applied change."
	}`)
	s.emit("subagent-implementer", subagent, TypeAgentFinished, `{"outcome":"completed","summary":"VAT extracted."}`)
	s.append(s.loadExample("run-finished.json"))

	var storedTypes []string
	if err := s.db.Model(&Event{}).
		Where("project_id = ?", s.projectID).
		Distinct().Pluck("type", &storedTypes).Error; err != nil {
		t.Fatalf("reading the stored event types: %v", err)
	}
	stored := make(map[string]bool, len(storedTypes))
	for _, evType := range storedTypes {
		stored[evType] = true
	}

	catalogue := EventTypes()
	if len(catalogue) != 20 {
		t.Fatalf("the catalogue has %d types, want 20", len(catalogue))
	}
	for _, evType := range catalogue {
		if !stored[evType] {
			t.Errorf("event type %q was never exercised", evType)
		}
	}

	// The plan step update reached the published revision only.
	var step PlanStep
	if err := s.db.Where("project_id = ? AND plan_id = ? AND revision = ? AND step_id = ?",
		s.projectID, "plan-2026-08-04-0001", 1, "step-2").Take(&step).Error; err != nil {
		t.Fatalf("loading the plan step: %v", err)
	}
	if step.State != "in_progress" {
		t.Errorf("plan step state = %q, want in_progress", step.State)
	}
	if step.StepOrder != 1 {
		t.Errorf("plan step order = %d, want 1", step.StepOrder)
	}

	// The work step was started and completed.
	var work WorkStep
	if err := s.db.Where("project_id = ? AND run_id = ? AND work_step_id = ?", s.projectID, s.runID, "work-1").
		Take(&work).Error; err != nil {
		t.Fatalf("loading the work step: %v", err)
	}
	if work.CompletedAt == nil || work.Summary == nil {
		t.Errorf("work step was not completed: %+v", work)
	}
	if work.PlanStepID == nil || *work.PlanStepID != "step-2" {
		t.Errorf("work step plan link = %v, want step-2", work.PlanStepID)
	}

	// The retracted relationship change is marked, the applied one is not.
	if change := s.activeChange("change-2026-08-04-0009"); change.State != ChangeStateRetracted {
		t.Errorf("relationship change state = %q, want %q", change.State, ChangeStateRetracted)
	}
	if change := s.activeChange("change-2026-08-04-0007"); change.State != ChangeStateApplied {
		t.Errorf("component change state = %q, want %q", change.State, ChangeStateApplied)
	}
	if run := s.run(); run.IsOpen {
		t.Error("the run is still open after run.finished")
	}
}
