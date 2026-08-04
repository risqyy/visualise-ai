package readapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"gorm.io/gorm"

	"github.com/risqyy/visualise-ai/backend/internal/database"
	"github.com/risqyy/visualise-ai/backend/internal/health"
	"github.com/risqyy/visualise-ai/backend/internal/httpapi"
	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// The read API is tested against a real PostgreSQL instance and against the
// real event store: the fixtures are built by appending events through
// store.Append, never by writing into the projection tables. Only that exercises
// the chain the cockpit actually depends on — contract payload, projection,
// query, handler.
//
//	docker run -d --name vai-test-pg-8 -e POSTGRES_PASSWORD=test \
//	  -e POSTGRES_USER=test -e POSTGRES_DB=test -p 55435:5432 postgres:17-alpine
//	TEST_DATABASE_URL='postgres://test:test@127.0.0.1:55435/test?sslmode=disable' \
//	  go test ./internal/readapi/...
//
// Without TEST_DATABASE_URL every test here skips, so `go test ./...` stays
// green on a machine without a database.
const testDatabaseURLEnv = "TEST_DATABASE_URL"

// testSchema keeps these tests in a PostgreSQL schema of their own.
//
// `go test ./...` runs packages in parallel, and every test here truncates the
// whole schema before it seeds. Without the separation the store tests and
// these would wipe each other's fixtures on a shared TEST_DATABASE_URL.
const testSchema = "readapi_test"

var (
	migrateOnce sync.Once
	migrateErr  error
)

// baseTime anchors the reported timestamps so ordering assertions are exact.
var baseTime = time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)

// harness owns the database, the read service and the fully wired HTTP router
// of one test.
type harness struct {
	t       *testing.T
	db      *gorm.DB
	store   *store.Store
	service *readapi.Service
	handler http.Handler
	seq     int
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	dsn := strings.TrimSpace(os.Getenv(testDatabaseURLEnv))
	if dsn == "" {
		t.Skipf("%s is not set: skipping the PostgreSQL backed read API tests", testDatabaseURLEnv)
	}

	db, err := database.Open(context.Background(), withSearchPath(dsn, testSchema), 30*time.Second, zerolog.Nop())
	if err != nil {
		t.Fatalf("opening the test database: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := database.Close(db); closeErr != nil {
			t.Errorf("closing the test database: %v", closeErr)
		}
	})

	migrateOnce.Do(func() {
		if migrateErr = db.Exec(`CREATE SCHEMA IF NOT EXISTS "` + testSchema + `"`).Error; migrateErr != nil {
			return
		}
		migrateErr = store.Migrate(db)
	})
	if migrateErr != nil {
		t.Fatalf("migrating the test schema: %v", migrateErr)
	}
	truncateAll(t, db)

	service := readapi.New(db)
	checker := health.NewChecker(func(context.Context) error { return nil })
	checker.MarkBootstrapped()

	return &harness{
		t:       t,
		db:      db,
		store:   store.New(db),
		service: service,
		handler: httpapi.New(httpapi.Options{
			Logger:  zerolog.New(io.Discard),
			Health:  checker,
			Version: "test",
			Read:    service,
		}),
	}
}

// withSearchPath pins the connection to one schema. `search_path` is not a
// libpq keyword but a server runtime parameter, and both supported DSN forms
// pass unknown keys straight through to the server.
func withSearchPath(dsn, schema string) string {
	if parsed, err := url.Parse(dsn); err == nil && parsed.Scheme != "" {
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	return dsn + " search_path=" + schema
}

// truncateAll empties every table so each test starts from a known state.
func truncateAll(t *testing.T, db *gorm.DB) {
	t.Helper()

	names := make([]string, 0, len(store.Models()))
	for _, model := range store.Models() {
		named, ok := model.(interface{ TableName() string })
		if !ok {
			t.Fatalf("model %T does not pin its table name", model)
		}
		names = append(names, `"`+named.TableName()+`"`)
	}
	if err := db.Exec("TRUNCATE " + strings.Join(names, ", ") + " RESTART IDENTITY CASCADE").Error; err != nil {
		t.Fatalf("truncating the test schema: %v", err)
	}
}

// nextTime keeps every reported timestamp of a test strictly increasing, which
// makes "newest first" orderings deterministic.
func (h *harness) nextTime() time.Time {
	h.seq++
	return baseTime.Add(time.Duration(h.seq) * time.Second)
}

// runContext appends events for one (project, run) pair.
type runContext struct {
	h         *harness
	projectID string
	runID     string
}

func (h *harness) run(projectID, runID string) *runContext {
	return &runContext{h: h, projectID: projectID, runID: runID}
}

// emit appends one event through the real store, so every projection this test
// later reads was written by the production projector.
func (r *runContext) emit(agentID string, parent *string, evType, payload string) store.Result {
	r.h.t.Helper()
	result, err := r.h.store.Append(context.Background(), store.Envelope{
		ProjectID:     r.projectID,
		ClientEventID: uuid.NewString(),
		RunID:         r.runID,
		AgentID:       agentID,
		ParentAgentID: parent,
		Type:          evType,
		SchemaVersion: "1.0",
		OccurredAt:    r.h.nextTime(),
		Payload:       json.RawMessage(payload),
	})
	if err != nil {
		r.h.t.Fatalf("appending %s to %s/%s: %v", evType, r.projectID, r.runID, err)
	}
	return result
}

// startRoot opens the run with a root orchestrator, which is what makes it the
// current run of the project.
func (r *runContext) startRoot(agentID, task string) store.Result {
	r.h.t.Helper()
	return r.emit(agentID, nil, store.TypeAgentStarted, fmt.Sprintf(`{
		"role": "orchestrator",
		"displayName": %q,
		"assignedTask": %q
	}`, agentID, task))
}

// startSub spawns a subagent below parentID.
func (r *runContext) startSub(agentID, parentID, task string) store.Result {
	r.h.t.Helper()
	parent := parentID
	return r.emit(agentID, &parent, store.TypeAgentStarted, fmt.Sprintf(`{
		"role": "subagent",
		"displayName": %q,
		"assignedTask": %q
	}`, agentID, task))
}

// emitExample replays one of the contract examples from api/examples, rebound to
// this run. Contract and read API are exercised against the very same documents.
func (r *runContext) emitExample(name string) store.Result {
	r.h.t.Helper()

	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "api", "examples", name))
	if err != nil {
		r.h.t.Fatalf("reading example %s: %v", name, err)
	}
	var example struct {
		AgentID       string          `json:"agentId"`
		ParentAgentID *string         `json:"parentAgentId"`
		Type          string          `json:"type"`
		Payload       json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(raw, &example); err != nil {
		r.h.t.Fatalf("decoding example %s: %v", name, err)
	}
	return r.emit(example.AgentID, example.ParentAgentID, example.Type, string(example.Payload))
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

func (h *harness) request(path string) *httptest.ResponseRecorder {
	h.t.Helper()
	recorder := httptest.NewRecorder()
	h.handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	return recorder
}

// getJSON performs one request, insists on 200 and decodes the body into target.
func (h *harness) getJSON(path string, target any) {
	h.t.Helper()
	recorder := h.request(path)
	if recorder.Code != http.StatusOK {
		h.t.Fatalf("GET %s: want 200, got %d: %s", path, recorder.Code, recorder.Body.String())
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), target); err != nil {
		h.t.Fatalf("GET %s: decoding body: %v: %s", path, err, recorder.Body.String())
	}
}

// problemBody is the RFC 9457 document the read endpoints serve on failure.
type problemBody struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail"`
	Code   string `json:"code"`
	Errors []struct {
		Field   string `json:"field"`
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
}

// getProblem performs one request, insists on the given status and decodes the
// problem document, including its media type.
func (h *harness) getProblem(path string, wantStatus int) problemBody {
	h.t.Helper()
	recorder := h.request(path)
	if recorder.Code != wantStatus {
		h.t.Fatalf("GET %s: want %d, got %d: %s", path, wantStatus, recorder.Code, recorder.Body.String())
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "application/problem+json") {
		h.t.Fatalf("GET %s: want an RFC 9457 media type, got %q", path, contentType)
	}
	var problem problemBody
	if err := json.Unmarshal(recorder.Body.Bytes(), &problem); err != nil {
		h.t.Fatalf("GET %s: decoding problem: %v: %s", path, err, recorder.Body.String())
	}
	if problem.Status != wantStatus {
		h.t.Fatalf("GET %s: problem repeats status %d, want %d", path, problem.Status, wantStatus)
	}
	if problem.Code == "" {
		h.t.Fatalf("GET %s: problem carries no machine readable code", path)
	}
	return problem
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

// lastPosition reads projects.last_position straight from the projection, which
// is what every response must repeat as projectPosition.
func (h *harness) lastPosition(projectID string) int64 {
	h.t.Helper()
	var project store.Project
	if err := h.db.Where("project_id = ?", projectID).Take(&project).Error; err != nil {
		h.t.Fatalf("loading project %q: %v", projectID, err)
	}
	return project.LastPosition
}

func componentIDs(components []readapi.Component) []string {
	out := make([]string, 0, len(components))
	for _, component := range components {
		out = append(out, component.ComponentID)
	}
	return out
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
