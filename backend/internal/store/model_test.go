package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func mutation(s *scenario, revision int64, ops string) Envelope {
	env := s.event("orchestrator-root", nil, TypeModelMutationApplied, fmt.Sprintf(`{"expectedModelRevision":%d,"operations":%s}`, revision, ops))
	env.SchemaVersion = "2.0"
	return env
}

const addPair = `[{"op":"relationship.add","relationship":{"relationshipId":"edge-1","sourceComponentId":"node-aa","targetComponentId":"node-bb","kind":"dependency"}},{"op":"component.add","component":{"componentId":"node-bb","name":"B","kind":"service","parentComponentId":"node-aa","description":"keep","tags":["old"]}},{"op":"component.add","component":{"componentId":"node-aa","name":"A","kind":"system","parentComponentId":null}}]`

func expectDomain(t *testing.T, err error, code string) {
	t.Helper()
	var domain *DomainError
	if !errors.As(err, &domain) || domain.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}
func TestModelAtomicBatchPatchAndExplicitRemoval(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	r := s.append(mutation(s, 0, addPair))
	if r.ModelRevision != 1 || r.Position != 2 || !reflect.DeepEqual(r.Affected.ComponentIDs, []string{"node-aa", "node-bb"}) || r.Affected.RelationshipIDs[0] != "edge-1" {
		t.Fatalf("receipt %+v", r)
	}
	s.append(mutation(s, 1, `[{"op":"component.update","componentId":"node-bb","set":{"name":"New","description":null,"tags":["new"]}},{"op":"relationship.update","relationshipId":"edge-1","set":{"label":"Changed","targetComponentId":"node-aa"}}]`))
	child := s.component("node-bb")
	if child.Name != "New" || child.Description != "" || child.Kind != "service" || child.ParentComponentID == nil || string(child.Tags) != `["new"]` {
		t.Fatalf("partial update %+v", child)
	}
	head := s.project()
	_, err := s.store.Append(context.Background(), mutation(s, 2, `[{"op":"component.remove","componentId":"node-aa"}]`))
	expectDomain(t, err, "reference_invalid")
	if s.project().LastPosition != head.LastPosition || s.project().ModelRevision != head.ModelRevision {
		t.Fatal("rejected remove moved counters")
	}
	// Remove incident edge and explicitly reparent child in the same batch, with
	// component removal ordered first. No implicit cascade is permitted.
	r = s.append(mutation(s, 2, `[{"op":"component.remove","componentId":"node-aa"},{"op":"component.update","componentId":"node-bb","set":{"parentComponentId":null}},{"op":"relationship.remove","relationshipId":"edge-1"}]`))
	if r.ModelRevision != 3 {
		t.Fatal(r)
	}
	if s.component("node-bb").ParentComponentID != nil {
		t.Fatal("child was not reparented")
	}
	_, err = s.store.Append(context.Background(), mutation(s, 3, `[{"op":"component.add","component":{"componentId":"node-aa","name":"Reuse","kind":"system","parentComponentId":null}}]`))
	expectDomain(t, err, "element_exists")
}
func TestModelCASConcurrencyAndFullReplayIdentity(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	seed := mutation(s, 0, addPair)
	first := s.append(seed)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, name := range []string{"Left", "Right"} {
		env := mutation(s, 1, fmt.Sprintf(`[{"op":"component.update","componentId":"node-aa","set":{"name":%q}}]`, name))
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.store.Append(context.Background(), env); results <- err }()
	}
	wg.Wait()
	close(results)
	ok, conflicts := 0, 0
	for err := range results {
		if err == nil {
			ok++
		} else {
			expectDomain(t, err, "revision_conflict")
			conflicts++
		}
	}
	if ok != 1 || conflicts != 1 {
		t.Fatalf("%d success, %d conflicts", ok, conflicts)
	}
	s.emit("orchestrator-root", nil, TypeRunFinished, `{"outcome":"completed","summary":"done"}`)
	replay, err := s.store.AppendGuarded(context.Background(), seed, func(*gorm.DB, Envelope) error { t.Fatal("replay ran lifecycle guard"); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Duplicate || replay.Position != first.Position || replay.ModelRevision != first.ModelRevision {
		t.Fatalf("replay %+v", replay)
	}
	for _, change := range []func(*Envelope){func(e *Envelope) { e.AgentID = "other-agent" }, func(e *Envelope) { e.RunID = "other-run" }, func(e *Envelope) { e.ParentAgentID = ptr("parent") }, func(e *Envelope) { e.OccurredAtText = "2026-08-04T09:00:02.000Z" }, func(e *Envelope) {
		e.Payload = json.RawMessage(`{"expectedModelRevision":2,"operations":` + addPair + `}`)
	}} {
		env := seed
		change(&env)
		_, err = s.store.Append(context.Background(), env)
		if !errors.Is(err, ErrClientEventIDConflict) {
			t.Fatalf("changed identity accepted: %v", err)
		}
	}
	legacy := s.event("orchestrator-root", nil, TypeAgentStatusReported, `{"status":"working"}`)
	s.append(legacy)
	other := seed
	other.ClientEventID = legacy.ClientEventID
	_, err = s.store.Append(context.Background(), other)
	if !errors.Is(err, ErrClientEventIDConflict) {
		t.Fatal(err)
	}
}
func TestModelRollbackIncludesReservationsHistoryReceiptsAndPosition(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	env := mutation(s, 0, addPair)
	// A projection failure after writing candidate state must roll back every row.
	original := s.store.apply
	s.store.apply = func(tx *gorm.DB, e *Event) error {
		if err := original(tx, e); err != nil {
			return err
		}
		return errors.New("injected projection failure")
	}
	if _, err := s.store.Append(context.Background(), env); err == nil {
		t.Fatal("expected failure")
	}
	s.store.apply = original
	for _, model := range []any{&Component{}, &Relationship{}, &ModelIdentity{}, &EventComponent{}} {
		if n := s.mustCount(model, "project_id = ?", s.projectID); n != 0 {
			t.Fatalf("%T leaked %d rows", model, n)
		}
	}
	if s.project().LastPosition != 1 || s.project().ModelRevision != 0 || s.mustCount(&CommandReceipt{}, "project_id = ?", s.projectID) != 1 {
		t.Fatal("rollback leaked receipt/counters")
	}
	accepted := s.append(env)
	if accepted.Position != 2 || accepted.Duplicate {
		t.Fatal(accepted)
	}
	for _, ops := range []string{`[{"op":"component.update","componentId":"node-aa","set":{"parentComponentId":"node-bb"}}]`, `[{"op":"relationship.update","relationshipId":"edge-1","set":{"sourceComponentId":"missing"}}]`, `[{"op":"component.update","componentId":"node-aa","set":{"name":"x"}},{"op":"component.remove","componentId":"node-aa"}]`} {
		_, err := s.store.Append(context.Background(), mutation(s, 1, ops))
		if err == nil {
			t.Fatal("invalid final graph/duplicate accepted")
		}
	}
	if s.project().LastPosition != 2 || s.project().ModelRevision != 1 {
		t.Fatal("invalid graph moved head")
	}
}
func TestLegacyModelWritesAdvanceRevisionAndCannotRestoreRetiredIDs(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	s.append(mutation(s, 0, addPair))
	s.emit("orchestrator-root", nil, TypeAgentStatusReported, `{"status":"working"}`)
	if s.project().ModelRevision != 1 {
		t.Fatal("status moved model revision")
	}
	_, err := s.store.Append(context.Background(), s.event("orchestrator-root", nil, TypeComponentChangeApplied, `{"operation":"remove","component":{"componentId":"node-aa"}}`))
	expectDomain(t, err, "reference_invalid")
	s.emit("orchestrator-root", nil, TypeArchitectureSnapshotPublished, `{"snapshotId":"replacement","components":[{"componentId":"node-aa","name":"Kept","kind":"system","parentComponentId":null}],"relationships":[]}`)
	if s.project().ModelRevision != 2 {
		t.Fatal("legacy snapshot did not advance")
	}
	_, err = s.store.Append(context.Background(), mutation(s, 1, `[{"op":"component.update","componentId":"node-aa","set":{"name":"stale"}}]`))
	expectDomain(t, err, "revision_conflict")
	for _, kind := range []string{TypeComponentChangeApplied, TypeArchitectureSnapshotPublished, TypeCorrectionIssued} {
		payload := `{"operation":"add","component":{"componentId":"node-bb","name":"Retired","kind":"service","parentComponentId":null}}`
		if kind == TypeArchitectureSnapshotPublished {
			payload = `{"snapshotId":"restore","components":[{"componentId":"node-bb","name":"Retired","kind":"service","parentComponentId":null}],"relationships":[]}`
		}
		if kind == TypeCorrectionIssued {
			payload = `{"correctsClientEventId":"` + uuid.NewString() + `","reason":"restore","correctedType":"component.change_applied","correctedPayload":` + payload + `}`
		}
		_, err = s.store.Append(context.Background(), s.event("orchestrator-root", nil, kind, payload))
		expectDomain(t, err, "element_exists")
	}
}
func TestModelMigrationReservesOnlyMaterializedIDsAndAllowsExplicitRepair(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	// Simulate pre-activation events by using the old projector directly. The log
	// remains immutable and contains planned, effective correction and retired IDs.
	appendOld := func(kind, payload string) {
		env := s.event("orchestrator-root", nil, kind, payload)
		ev := Event{ID: uuid.NewString(), ProjectID: env.ProjectID, ClientEventID: env.ClientEventID, RunID: env.RunID, AgentID: env.AgentID, Type: kind, SchemaVersion: "1.0", OccurredAt: env.OccurredAt, ReceivedAt: env.OccurredAt, Payload: JSON(payload), PayloadHash: "old", Position: s.project().LastPosition + 1}
		if err := s.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&ev).Error; err != nil {
				return err
			}
			return NewProjector().Apply(tx, &ev)
		}); err != nil {
			t.Fatal(err)
		}
	}
	appendOld(TypeComponentChangePlanned, `{"changeId":"proposal","operation":"add","component":{"componentId":"planned-only","name":"Planned","kind":"service","parentComponentId":null}}`)
	appendOld(TypeArchitectureSnapshotPublished, `{"snapshotId":"old","components":[{"componentId":"retired-aa","name":"Old","kind":"service","parentComponentId":null},{"componentId":"live-aa","name":"Live","kind":"service","parentComponentId":null}],"relationships":[{"relationshipId":"dangling","sourceComponentId":"live-aa","targetComponentId":"never-existed","kind":"dependency"}]}`)
	appendOld(TypeComponentChangeApplied, `{"operation":"remove","component":{"componentId":"retired-aa"}}`)
	appendOld(TypeCorrectionIssued, `{"correctsClientEventId":"`+uuid.NewString()+`","reason":"effective","correctedType":"component.change_applied","correctedPayload":{"operation":"add","component":{"componentId":"corrected-aa","name":"Effective","kind":"service","parentComponentId":null}}}`)
	appendOld(TypeComponentChangeApplied, `{"operation":"remove","component":{"componentId":"corrected-aa"}}`)
	position := s.project().LastPosition
	if err := s.db.Model(&Project{}).Where("project_id = ?", s.projectID).Update("model_activated_at_position", nil).Error; err != nil {
		t.Fatal(err)
	}
	if err := Migrate(s.db); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(s.db); err != nil {
		t.Fatal(err)
	}
	p := s.project()
	if p.ModelRevision != 0 || p.LastPosition != position || p.ModelActivatedAtPosition == nil || *p.ModelActivatedAtPosition != position {
		t.Fatal(p)
	}
	for _, id := range []string{"retired-aa", "corrected-aa", "live-aa"} {
		if s.mustCount(&ModelIdentity{}, "project_id = ? AND id = ?", s.projectID, id) != 1 {
			t.Fatalf("missing reservation %s", id)
		}
	}
	if s.mustCount(&ModelIdentity{}, "project_id = ? AND id = ?", s.projectID, "planned-only") != 0 {
		t.Fatal("planned ID was reserved")
	}
	read, err := s.store.ReadModel(context.Background(), s.projectID)
	if err != nil || len(read.Diagnostics) != 1 || read.Diagnostics[0].Target.ID != "dangling" {
		t.Fatalf("old graph unreadable %+v %v", read, err)
	}
	_, err = s.store.Append(context.Background(), mutation(s, 0, `[{"op":"component.update","componentId":"live-aa","set":{"name":"Rename"}}]`))
	expectDomain(t, err, "reference_invalid")
	s.append(mutation(s, 0, `[{"op":"relationship.remove","relationshipId":"dangling"},{"op":"component.update","componentId":"live-aa","set":{"name":"Rename"}},{"op":"component.add","component":{"componentId":"planned-only","name":"Now real","kind":"service","parentComponentId":null}}]`))
	if s.project().ModelRevision != 1 {
		t.Fatal("repair failed")
	}
}
func TestModelReadNeverMixesRevisionAndProjection(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	s.append(mutation(s, 0, `[{"op":"component.add","component":{"componentId":"node-aa","name":"1","kind":"service","parentComponentId":null}}]`))
	var wg sync.WaitGroup
	errorsCh := make(chan error, 1)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := int64(1); i < 30; i++ {
			env := Envelope{ProjectID: s.projectID, RunID: s.runID, AgentID: "orchestrator-root", ClientEventID: uuid.NewString(), Type: TypeModelMutationApplied, SchemaVersion: "2.0", OccurredAt: baseTime, Payload: json.RawMessage(fmt.Sprintf(`{"expectedModelRevision":%d,"operations":[{"op":"component.update","componentId":"node-aa","set":{"name":"%d"}}]}`, i, i+1))}
			if _, err := s.store.Append(context.Background(), env); err != nil {
				errorsCh <- err
				return
			}
		}
	}()
	for i := 0; i < 50; i++ {
		snapshot, err := s.store.ReadModel(context.Background(), s.projectID)
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Components[0].Name != fmt.Sprint(snapshot.ModelRevision) || snapshot.ProjectPosition != snapshot.ModelRevision+1 {
			t.Fatalf("mixed snapshot %+v", snapshot)
		}
	}
	wg.Wait()
	select {
	case err := <-errorsCh:
		t.Fatal(err)
	default:
	}
}
func TestModelIntegralRevisionSpellingAndRelationshipHistory(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	env := mutation(s, 0, addPair)
	env.Payload = []byte(strings.Replace(string(env.Payload), `"expectedModelRevision":0`, `"expectedModelRevision":0e0`, 1))
	s.append(env)
	edit := mutation(s, 1, `[{"op":"relationship.update","relationshipId":"edge-1","set":{"sourceComponentId":"node-bb","targetComponentId":"node-bb"}}]`)
	result := s.append(edit)
	for _, id := range []string{"node-aa", "node-bb"} {
		if s.mustCount(&EventComponent{}, "project_id = ? AND position = ? AND component_id = ?", s.projectID, result.Position, id) != 1 {
			t.Fatalf("retarget lost endpoint history %s", id)
		}
	}
	if len(result.Affected.ComponentIDs) != 0 || !reflect.DeepEqual(result.Affected.RelationshipIDs, []string{"edge-1"}) {
		t.Fatalf("receipt includes implicit endpoints %+v", result)
	}
	remove := s.append(mutation(s, 2, `[{"op":"relationship.remove","relationshipId":"edge-1"}]`))
	if s.mustCount(&EventComponent{}, "project_id = ? AND position = ? AND component_id = ?", s.projectID, remove.Position, "node-bb") != 1 {
		t.Fatal("removed relationship lost endpoint history")
	}
}
func TestAppendActivatesLegacyProjectBeforeBackgroundMigration(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	if err := s.db.Model(&Project{}).Where("project_id = ?", s.projectID).Update("model_activated_at_position", nil).Error; err != nil {
		t.Fatal(err)
	}
	// Deterministically block migration behind an append holding the project row.
	entered := make(chan struct{})
	release := make(chan struct{})
	appendDone := make(chan error, 1)
	migrationDone := make(chan error, 1)
	env := mutation(s, 0, addPair)
	go func() {
		_, err := s.store.AppendGuarded(context.Background(), env, func(*gorm.DB, Envelope) error { close(entered); <-release; return nil })
		appendDone <- err
	}()
	<-entered
	go func() { migrationDone <- migrateModelTracking(s.db) }()
	close(release)
	if err := <-appendDone; err != nil {
		t.Fatal(err)
	}
	if err := <-migrationDone; err != nil {
		t.Fatal(err)
	}
	p := s.project()
	if p.ModelRevision != 1 || p.LastPosition != 2 || p.ModelActivatedAtPosition == nil || *p.ModelActivatedAtPosition != 1 {
		t.Fatalf("migration reset post-activation write %+v", p)
	}
}
func TestReceiptFailureRollsBackCompletedModelProjection(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	env := mutation(s, 0, addPair)
	const callback = "test:receipt_failure"
	if err := s.db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "command_receipts" {
			tx.AddError(errors.New("injected receipt failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	_, err := s.store.Append(context.Background(), env)
	if removeErr := s.db.Callback().Create().Remove(callback); removeErr != nil {
		t.Fatal(removeErr)
	}
	if err == nil {
		t.Fatal("receipt failure accepted")
	}
	for _, model := range []any{&Component{}, &Relationship{}, &ModelIdentity{}, &EventComponent{}} {
		if s.mustCount(model, "project_id = ?", s.projectID) != 0 {
			t.Fatalf("%T leaked from completed projection", model)
		}
	}
	if s.project().ModelRevision != 0 || s.project().LastPosition != 1 || s.mustCount(&Event{}, "project_id = ?", s.projectID) != 1 {
		t.Fatal("receipt failure leaked counters/log")
	}
	if result := s.append(env); result.Position != 2 || result.ModelRevision != 1 {
		t.Fatal(result)
	}
}
func TestMigrationRecordsAmbiguousReuseAndLeavesCyclesReadable(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	snapshots := []string{`{"snapshotId":"first","components":[{"componentId":"node-aa","name":"First","kind":"system","parentComponentId":null}],"relationships":[]}`, `{"snapshotId":"removed","components":[],"relationships":[]}`, `{"snapshotId":"reused","components":[{"componentId":"node-aa","name":"Reused","kind":"system","parentComponentId":"node-aa"}],"relationships":[]}`}
	for _, payload := range snapshots {
		ev := Event{ID: uuid.NewString(), ClientEventID: uuid.NewString(), ProjectID: s.projectID, RunID: s.runID, AgentID: "orchestrator-root", Type: TypeArchitectureSnapshotPublished, SchemaVersion: "1.0", OccurredAt: baseTime, ReceivedAt: baseTime, Position: s.project().LastPosition + 1, Payload: JSON(payload), PayloadHash: "old"}
		if err := s.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&ev).Error; err != nil {
				return err
			}
			return NewProjector().Apply(tx, &ev)
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.db.Model(&Project{}).Where("project_id = ?", s.projectID).Update("model_activated_at_position", nil).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateModelTracking(s.db); err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.store.ReadModel(context.Background(), s.projectID)
	if err != nil {
		t.Fatal(err)
	}
	codes := map[string]bool{}
	for _, d := range snapshot.Diagnostics {
		codes[d.Code] = true
	}
	if !codes["historical_id_reuse"] || !codes["hierarchy_cycle"] || snapshot.Components[0].ParentComponentID == nil {
		t.Fatalf("migration hid legacy defects %+v", snapshot)
	}
	s.append(mutation(s, 0, `[{"op":"component.update","componentId":"node-aa","set":{"parentComponentId":null}}]`))
	if s.mustCount(&Event{}, "project_id = ?", s.projectID) != 5 {
		t.Fatal("migration rewrote history")
	}
}
