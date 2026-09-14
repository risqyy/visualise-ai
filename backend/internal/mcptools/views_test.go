package mcptools

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/store"
)

func viewArgs(f *fixture, id string, modelRevision, viewRevision any) map[string]any {
	args := f.identity("root-agent")
	args["expectedModelRevision"], args["expectedViewRevision"] = modelRevision, viewRevision
	args["view"] = map[string]any{"viewId": id, "name": id, "kind": "architecture", "selection": map[string]any{"mode": "all"}, "orientation": "top-down", "collapsedComponentIds": []string{}}
	return args
}

func TestSDKViewsSharedIdentityBoundariesPagingAndReplay(t *testing.T) {
	f := setup(t)
	f.open("root-agent")
	firstArgs := viewArgs(f, "all-view", json.Number("0e0"), json.Number("0.0"))
	first := f.call("visualise_view_put", firstArgs, "")
	if first["modelRevision"] != float64(0) || first["viewRevision"] != float64(1) {
		t.Fatal(first)
	}
	f.call("visualise_model_mutate", f.mutate(0, component("node-aa"), component("node-bb"), component("node-cc"), map[string]any{"op": "relationship.add", "relationship": map[string]any{"relationshipId": "edge-aa", "sourceComponentId": "node-aa", "targetComponentId": "node-bb", "kind": "dependency"}}), "")
	detailArgs := viewArgs(f, "detail-view", 1, 0)
	detailArgs["view"].(map[string]any)["selection"] = map[string]any{"mode": "explicit", "scope": map[string]any{"componentIds": []string{"node-aa", "node-bb"}, "relationshipIds": []string{"edge-aa"}}}
	detail := f.call("visualise_view_put", detailArgs, "")
	if detail["modelRevision"] != float64(1) || detail["viewRevision"] != float64(1) {
		t.Fatal(detail)
	}
	listingArgs := f.readArgs()
	listingArgs["limit"] = 1
	listing := f.call("visualise_views_list", listingArgs, "")
	if len(listing["items"].([]any)) != 1 || listing["nextCursor"] == nil {
		t.Fatal(listing)
	}
	rest := readapi.New(f.db)
	restPage, err := rest.Views(context.Background(), f.project, "1", "")
	if err != nil || len(restPage.Items) != 1 || restPage.NextCursor == nil {
		t.Fatalf("REST page %+v %v", restPage, err)
	}
	f.call("visualise_model_mutate", f.mutate(1, map[string]any{"op": "relationship.update", "relationshipId": "edge-aa", "set": map[string]any{"targetComponentId": "node-cc"}}, map[string]any{"op": "component.update", "componentId": "node-aa", "set": map[string]any{"name": "Shared rename"}}), "")
	listingArgs["cursor"] = listing["nextCursor"]
	f.call("visualise_views_list", listingArgs, "stale_cursor")
	_, err = rest.Views(context.Background(), f.project, "1", *restPage.NextCursor)
	if domain, ok := err.(*store.DomainError); !ok || domain.Code != "stale_cursor" {
		t.Fatal(err)
	}
	getArgs := f.readArgs()
	getArgs["viewId"] = "detail-view"
	got := f.call("visualise_view_get", getArgs, "")
	if got["modelRevision"] != float64(2) || got["viewRevision"] != float64(1) || len(got["boundaryRelationshipIds"].([]any)) != 1 {
		t.Fatal(got)
	}
	restView, err := rest.View(context.Background(), f.project, "detail-view")
	if err != nil || restView.ViewRevision != 1 || len(restView.BoundaryRelationshipIDs) != 1 {
		t.Fatalf("REST view %+v %v", restView, err)
	}
	// A save against the new model cannot preserve the now-invalid boundary.
	invalid := viewArgs(f, "invalid-view", 2, 0)
	invalid["view"].(map[string]any)["selection"] = detailArgs["view"].(map[string]any)["selection"]
	f.call("visualise_view_put", invalid, "reference_invalid")
	invalid["view"].(map[string]any)["kind"] = "sequence"
	f.call("visualise_view_put", invalid, "invalid_input")
	// An exact retry returns its ORIGINAL model/view/position even after writes.
	_ = f.session.Close()
	f.connect()
	retry := f.call("visualise_view_put", firstArgs, "")
	if retry["duplicate"] != true || retry["projectPosition"] != first["projectPosition"] || retry["modelRevision"] != first["modelRevision"] {
		t.Fatal(retry)
	}
	firstArgs["expectedViewRevision"] = 0
	f.call("visualise_view_put", firstArgs, "client_event_id_conflict")
	remove := f.identity("root-agent")
	remove["viewId"] = "detail-view"
	remove["expectedViewRevision"] = json.Number("1e0")
	removed := f.call("visualise_view_remove", remove, "")
	if removed["modelRevision"] != float64(2) || removed["viewRevision"] != float64(2) {
		t.Fatal(removed)
	}
	f.call("visualise_view_get", getArgs, "view_not_found")
	recreate := viewArgs(f, "detail-view", 2, 0)
	f.call("visualise_view_put", recreate, "element_exists")
	missing := f.identity("root-agent")
	missing["viewId"] = "missing-view"
	missing["expectedViewRevision"] = 0
	f.call("visualise_view_remove", missing, "view_not_found")
	f.call("visualise_work_report", report(f, "root-agent", "run_finish", map[string]any{"outcome": "completed", "summary": "done"}), "")
	f.call("visualise_view_remove", remove, "")
	remove["clientEventId"] = uuid.NewString()
	f.call("visualise_view_remove", remove, "run_already_finished")
	snapshot, err := store.New(f.db).ReadModel(context.Background(), f.project)
	if err != nil || len(snapshot.Components) != 3 || len(snapshot.Relationships) != 1 || snapshot.Components[0].Name != "Shared rename" {
		t.Fatalf("views modified model %+v %v", snapshot, err)
	}
}
