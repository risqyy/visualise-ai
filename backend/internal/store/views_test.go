package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestSharedViewResolutionFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../api/examples/model-view-mcp/view-resolution.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name     string
		Model    ModelSnapshot
		View     SavedView
		Expected ViewResolution
	}
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			actual := ResolveArchitectureView(fixture.Model, fixture.View)
			if !reflect.DeepEqual(actual, fixture.Expected) {
				t.Fatalf("got %+v, want %+v", actual, fixture.Expected)
			}
		})
	}
}

func seedView(t *testing.T, s *scenario) SavedView {
	t.Helper()
	view := SavedView{ViewID: "detail-view", Name: "Original", Kind: "architecture", Selection: ViewSelection{Mode: "all"}, Orientation: "top-down", CollapsedComponentIDs: []string{}}
	raw, _ := json.Marshal(view)
	if err := s.db.Create(&ArchitectureView{ProjectID: s.projectID, ViewID: view.ViewID, Definition: JSON(raw), Revision: 1, Position: 2}).Error; err != nil {
		t.Fatal(err)
	}
	return view
}

func TestCaptureViewSnapshotExactRevisionsAndTombstone(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	s.append(mutation(s, 0, addPair))
	view := seedView(t, s)
	request := ViewSnapshotRequest{s.projectID, view.ViewID, 1, 1}
	captured, err := s.store.CaptureViewSnapshot(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if captured.Model.ModelRevision != 1 || captured.ViewRevision != 1 || captured.Model.ProjectPosition != 2 || captured.View.Name != "Original" {
		t.Fatal(captured)
	}
	for _, changed := range []ViewSnapshotRequest{{s.projectID, view.ViewID, 0, 1}, {s.projectID, view.ViewID, 1, 0}} {
		_, err := s.store.CaptureViewSnapshot(context.Background(), changed)
		expectDomain(t, err, "revision_conflict")
		var domain *DomainError
		errors.As(err, &domain)
		if domain.CurrentModelRevision == nil || *domain.CurrentModelRevision != 1 || domain.CurrentViewRevision == nil || *domain.CurrentViewRevision != 1 {
			t.Fatal(domain)
		}
	}
	_, err = s.store.CaptureViewSnapshot(context.Background(), ViewSnapshotRequest{"unknown-project", view.ViewID, 1, 1})
	expectDomain(t, err, "project_not_found")
	if err := s.db.Model(&ArchitectureView{}).Where("project_id = ?", s.projectID).Updates(map[string]any{"removed": true, "revision": 2}).Error; err != nil {
		t.Fatal(err)
	}
	_, err = s.store.CaptureViewSnapshot(context.Background(), request)
	expectDomain(t, err, "view_not_found")
	if captured.View.Name != "Original" || len(captured.Model.Components) != 2 {
		t.Fatal("snapshot changed after later writes")
	}
}

func TestCaptureViewSnapshotUsesOneDatabaseSnapshotDuringConcurrentWrite(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	s.append(mutation(s, 0, addPair))
	view := seedView(t, s)
	readHead := make(chan struct{})
	written := make(chan struct{})
	var intercepted atomic.Bool
	callback := "test:view_snapshot_barrier"
	err := s.db.Callback().Query().After("gorm:query").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "projects" && intercepted.CompareAndSwap(false, true) {
			close(readHead)
			select {
			case <-written:
			case <-time.After(10 * time.Second):
				tx.AddError(errors.New("concurrent write timed out"))
			}
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Callback().Query().Remove(callback)
	type outcome struct {
		snapshot ViewSnapshot
		err      error
	}
	done := make(chan outcome, 1)
	go func() {
		snapshot, err := s.store.CaptureViewSnapshot(context.Background(), ViewSnapshotRequest{s.projectID, view.ViewID, 1, 1})
		done <- outcome{snapshot, err}
	}()
	select {
	case <-readHead:
	case <-time.After(10 * time.Second):
		t.Fatal("capture never read project")
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Project{}).Where("project_id = ?", s.projectID).Updates(map[string]any{"model_revision": 2, "last_position": 3}).Error; err != nil {
			return err
		}
		if err := tx.Model(&Component{}).Where("project_id = ? AND component_id = ?", s.projectID, "node-aa").Update("name", "Changed").Error; err != nil {
			return err
		}
		view.Name = "Changed"
		raw, _ := json.Marshal(view)
		return tx.Model(&ArchitectureView{}).Where("project_id = ?", s.projectID).Updates(map[string]any{"definition": JSON(raw), "revision": 2, "position": 3}).Error
	})
	close(written)
	if err != nil {
		t.Fatal(err)
	}
	result := <-done
	if result.err != nil {
		t.Fatal(result.err)
	}
	if result.snapshot.View.Name != "Original" || result.snapshot.ViewRevision != 1 || result.snapshot.Model.ModelRevision != 1 || result.snapshot.Model.ProjectPosition != 2 || result.snapshot.Model.Components[0].Name != "A" {
		t.Fatalf("mixed snapshot: %+v", result.snapshot)
	}
	fresh, err := s.store.CaptureViewSnapshot(context.Background(), ViewSnapshotRequest{s.projectID, view.ViewID, 2, 2})
	if err != nil || fresh.View.Name != "Changed" || fresh.Model.Components[0].Name != "Changed" {
		t.Fatalf("fresh snapshot: %+v %v", fresh, err)
	}
}
