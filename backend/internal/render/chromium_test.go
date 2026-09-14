package render

import (
	"context"
	"encoding/json"
	"github.com/risqyy/visualise-ai/backend/internal/store"
	"os"
	"testing"
	"time"
)

// Opt-in real Chromium test, run in the shipped Linux runtime against the
// production frontend. Unit suites never silently substitute a fake browser.
func TestNativeChromium(t *testing.T) {
	entry := os.Getenv("TEST_RENDER_ENTRY_URL")
	if entry == "" {
		t.Skip("set TEST_RENDER_ENTRY_URL to the built /render.html")
	}
	executable := os.Getenv("TEST_RENDER_BROWSER")
	if executable == "" {
		executable = "/usr/bin/chromium"
	}
	browser, err := NewChromium(executable, entry)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot store.ViewSnapshot
	err = json.Unmarshal([]byte(`{"model":{"projectId":"project-aa","modelRevision":3,"projectPosition":19,"components":[{"componentId":"service-aa","name":"Gateway ÄÖÜ","kind":"service","parentComponentId":null},{"componentId":"service-bb","name":"Worker","kind":"service","parentComponentId":null}],"relationships":[{"relationshipId":"gateway-worker","sourceComponentId":"service-aa","targetComponentId":"service-bb","kind":"dependency"}]},"view":{"viewId":"view-aa","name":"Original","kind":"architecture","selection":{"mode":"all"},"orientation":"top-down","collapsedComponentIds":[]},"viewRevision":2}`), &snapshot)
	if err != nil {
		t.Fatal(err)
	}
	s := New(providerFunc(func(context.Context, store.ViewSnapshotRequest) (store.ViewSnapshot, error) { return snapshot, nil }), browser)
	request := requestFixture()
	request.Viewport = Viewport{800, 600, 2}
	started := time.Now()
	result, err := s.Render(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Metadata.VisibleIDs.ComponentIDs) != 2 || len(result.Metadata.VisibleIDs.RelationshipIDs) != 1 || result.Metadata.VisibleIDs.RelationshipIDs[0] != "gateway-worker" || result.Metadata.Clipped {
		t.Fatalf("incorrect paint evidence: %+v", result.Metadata)
	}
	t.Logf("native render: %d bytes, %s, %+v", len(result.PNG), time.Since(started), result.Metadata)
	if output := os.Getenv("TEST_RENDER_OUTPUT"); output != "" {
		if err = os.WriteFile(output, result.PNG, 0600); err != nil {
			t.Fatal(err)
		}
	}
	shutdown, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err = s.Shutdown(shutdown); err != nil {
		t.Fatal(err)
	}
}
