package httpapi

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/risqyy/visualise-ai/backend/internal/ingest"
	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/store"
	"github.com/rs/zerolog"
)

func TestViewRESTCommandsReadsReplayAndSinglePublication(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()
	service, err := ingest.NewService(ingest.HandlerOptions{Store: store.New(f.db), Contract: ingestContract, Publisher: f.publisher, MaxEventBytes: defaultTestMaxEventBytes})
	if err != nil {
		t.Fatal(err)
	}
	env := f.event("orchestrator-root", nil, store.TypeViewSaved, `{"expectedModelRevision":0e0,"expectedViewRevision":0.0,"view":{"viewId":"all-view","name":"All","kind":"architecture","selection":{"mode":"all"},"orientation":"top-down","collapsedComponentIds":[]}}`)
	env.SchemaVersion = "2.0"
	body := strings.Replace(f.encode(env), `"schemaVersion":"2.0",`, `"schemaVersion":"2.0","parentAgentId":null,`, 1)
	response := f.post(body)
	if response.Code != http.StatusCreated {
		t.Fatal(response.Code, response.Body)
	}
	var receipt store.Result
	_ = json.Unmarshal(response.Body.Bytes(), &receipt)
	if receipt.ModelRevision != 0 || receipt.ViewRevision == nil || *receipt.ViewRevision != 1 {
		t.Fatal(receipt)
	}
	replay, err := service.Submit(context.Background(), []byte(body))
	if err != nil || !replay.Duplicate || replay.ServerEventID != receipt.ServerEventID {
		t.Fatal(replay, err)
	}
	requireProblem(t, f.post(strings.Replace(body, `"expectedModelRevision":0e0`, `"expectedModelRevision":0`, 1)), http.StatusConflict, "client_event_id_conflict")
	changed := strings.Replace(body, env.ClientEventID, "9321c9e1-1079-4cc1-8d72-d6f8c35ef461", 1)
	conflict := f.post(changed)
	requireProblem(t, conflict, http.StatusConflict, "revision_conflict")
	var problem map[string]any
	_ = json.Unmarshal(conflict.Body.Bytes(), &problem)
	if problem["currentModelRevision"] != float64(0) || problem["currentViewRevision"] != float64(1) {
		t.Fatal(problem)
	}
	router := New(Options{Read: readapi.New(f.db), Logger: zerolog.Nop()})
	for _, id := range []string{"team/api", "space view", "50%", "Übersicht", "with|separator", ".", "..", "a+b?c#d"} {
		opaque := strings.Replace(body, `"viewId":"all-view"`, `"viewId":`+strconv.Quote(id), 1)
		opaque = strings.Replace(opaque, env.ClientEventID, uuid.NewString(), 1)
		if response := f.post(opaque); response.Code != http.StatusCreated {
			t.Fatal(response.Code, response.Body)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, APIPrefix+"/projects/"+f.projectID+"/view?viewId="+url.QueryEscape(id), nil))
		if recorder.Code != http.StatusOK {
			t.Fatal(id, recorder.Code, recorder.Body)
		}
		var read store.ViewResponse
		_ = json.Unmarshal(recorder.Body.Bytes(), &read)
		if read.View.ViewID != id {
			t.Fatalf("opaque ID changed: %q != %q", read.View.ViewID, id)
		}
	}
	for _, path := range []string{"/views", "/view?viewId=all-view"} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, APIPrefix+"/projects/"+f.projectID+path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatal(recorder.Code, recorder.Body)
		}
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, APIPrefix+"/projects/"+f.projectID+"/view?viewId=missing-view", nil))
	requireProblem(t, recorder, http.StatusNotFound, "view_not_found")
	if len(f.publisher.published()) != 10 || f.lastPosition() != 10 {
		t.Fatal("retry/failure published or wrote")
	}
}
