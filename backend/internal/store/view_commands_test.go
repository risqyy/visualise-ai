package store

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/google/uuid"
)

func saveView(s *scenario, id string, modelRevision, viewRevision int) Envelope {
	env := s.event("orchestrator-root", nil, TypeViewSaved, fmt.Sprintf(`{"expectedModelRevision":%d,"expectedViewRevision":%d,"view":{"viewId":%q,"name":"Shared view","kind":"architecture","selection":{"mode":"all"},"orientation":"top-down","collapsedComponentIds":[]}}`, modelRevision, viewRevision, id))
	env.SchemaVersion = "2.0"
	return env
}
func TestViewCASConcurrencyRollbackAndIndependentRevisions(t *testing.T) {
	s := newScenario(t)
	s.startRun()
	s.append(mutation(s, 0, addPair))
	created := s.append(saveView(s, "all-view", 1, 0))
	if created.ModelRevision != 1 || created.ViewRevision == nil || *created.ViewRevision != 1 || created.Position != 3 {
		t.Fatal(created)
	}
	original := saveView(s, "all-view", 1, 1)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		env := original
		env.ClientEventID = uuid.NewString()
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.store.Append(context.Background(), env); results <- err }()
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else {
			expectDomain(t, err, "revision_conflict")
			conflict++
		}
	}
	if success != 1 || conflict != 1 || s.project().ModelRevision != 1 || s.project().LastPosition != 4 {
		t.Fatalf("success=%d conflict=%d head=%+v", success, conflict, s.project())
	}
	bad := saveView(s, "bad-view", 1, 0)
	bad.Payload = []byte(`{"expectedModelRevision":1,"expectedViewRevision":0,"view":{"viewId":"bad-view","name":"Bad","kind":"architecture","selection":{"mode":"explicit","scope":{"componentIds":["node-bb"],"relationshipIds":["edge-1"]}},"orientation":"top-down","collapsedComponentIds":[]}}`)
	_, err := s.store.Append(context.Background(), bad)
	expectDomain(t, err, "reference_invalid")
	// Parent node-aa is structural only and cannot authorize edge-1.
	if s.mustCount(&ArchitectureView{}, "project_id = ? AND view_id = ?", s.projectID, "bad-view") != 0 || s.mustCount(&CommandReceipt{}, "project_id = ? AND client_event_id = ?", s.projectID, bad.ClientEventID) != 0 || s.project().LastPosition != 4 {
		t.Fatal("invalid view partially committed")
	}
	s.append(saveView(s, "bad-view", 1, 0)) // rejected ID was never reserved
	snapshot, err := s.store.CaptureViewSnapshot(context.Background(), ViewSnapshotRequest{s.projectID, "all-view", 1, 2})
	if err != nil || len(snapshot.Model.Components) != 2 {
		t.Fatalf("snapshot %+v %v", snapshot, err)
	}
}
