package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
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
	"github.com/risqyy/visualise-ai/backend/internal/ingest"
	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// The ingestion tests drive the real Gin engine against a real PostgreSQL.
// Both halves matter: the status codes come out of the HTTP layer, while
// idempotency, position assignment and "a rejected event changes nothing" are
// transaction properties that only a real database can demonstrate.
//
//	docker run -d --name vai-test-pg-5 -e POSTGRES_PASSWORD=test \
//	  -e POSTGRES_USER=test -e POSTGRES_DB=test -p 55434:5432 postgres:17-alpine
//	TEST_DATABASE_URL='postgres://test:test@127.0.0.1:55434/test?sslmode=disable' \
//	  go test ./internal/httpapi/...
//
// Without TEST_DATABASE_URL these tests skip, so `go test ./...` stays green on
// a machine without a database.
const testDatabaseURLEnv = "TEST_DATABASE_URL"

// defaultTestMaxEventBytes matches the contract default; the size test lowers it.
const defaultTestMaxEventBytes = 2 * 1024 * 1024

// ingestTestSchema keeps these tests out of the way of the store tests.
//
// `go test ./...` runs packages in parallel, and both packages truncate the
// whole schema between tests. Pointing this one at a schema of its own makes
// the two independent instead of making the suite depend on -p 1.
const ingestTestSchema = "httpapi_ingest_test"

var (
	ingestSchemaOnce  sync.Once
	ingestSchemaErr   error
	ingestMigrateOnce sync.Once
	ingestMigrateErr  error
	ingestContract    *ingest.Contract
	ingestContractErr error
	ingestContractOne sync.Once
)

// isolatedDSN points a connection at the test schema of this package.
func isolatedDSN(t *testing.T, dsn string) string {
	t.Helper()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parsing %s: %v", testDatabaseURLEnv, err)
	}
	query := parsed.Query()
	query.Set("search_path", ingestTestSchema)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

// ensureTestSchema creates the schema before anything connects into it.
func ensureTestSchema(dsn string) error {
	db, err := database.Open(context.Background(), dsn, 30*time.Second, zerolog.Nop())
	if err != nil {
		return err
	}
	defer func() { _ = database.Close(db) }()
	return db.Exec("CREATE SCHEMA IF NOT EXISTS " + ingestTestSchema).Error
}

// recordingPublisher counts what the ingestion layer publishes after a commit.
type recordingPublisher struct {
	mu     sync.Mutex
	events []ingest.CommittedEvent
}

// Publish implements ingest.Publisher.
func (p *recordingPublisher) Publish(_ context.Context, event ingest.CommittedEvent) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, event)
}

func (p *recordingPublisher) published() []ingest.CommittedEvent {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]ingest.CommittedEvent(nil), p.events...)
}

// ingestFixture is one isolated project on a freshly truncated schema.
type ingestFixture struct {
	t         *testing.T
	db        *gorm.DB
	engine    http.Handler
	publisher *recordingPublisher
	projectID string
	runID     string

	mu  sync.Mutex
	seq int
}

func newIngestFixture(t *testing.T, maxEventBytes int64) *ingestFixture {
	t.Helper()

	dsn := strings.TrimSpace(os.Getenv(testDatabaseURLEnv))
	if dsn == "" {
		t.Skipf("%s is not set: skipping the PostgreSQL backed ingestion tests", testDatabaseURLEnv)
	}

	ingestSchemaOnce.Do(func() { ingestSchemaErr = ensureTestSchema(dsn) })
	if ingestSchemaErr != nil {
		t.Fatalf("creating the %s schema: %v", ingestTestSchema, ingestSchemaErr)
	}

	db, err := database.Open(context.Background(), isolatedDSN(t, dsn), 30*time.Second, zerolog.Nop())
	if err != nil {
		t.Fatalf("opening the test database: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := database.Close(db); closeErr != nil {
			t.Errorf("closing the test database: %v", closeErr)
		}
	})

	ingestMigrateOnce.Do(func() { ingestMigrateErr = store.Migrate(db) })
	if ingestMigrateErr != nil {
		t.Fatalf("migrating the test schema: %v", ingestMigrateErr)
	}
	truncateSchema(t, db)

	ingestContractOne.Do(func() { ingestContract, ingestContractErr = ingest.LoadContract() })
	if ingestContractErr != nil {
		t.Fatalf("loading the event contract: %v", ingestContractErr)
	}

	publisher := &recordingPublisher{}
	handler, err := ingest.NewHandler(ingest.HandlerOptions{
		Store:         store.New(db),
		Contract:      ingestContract,
		Publisher:     publisher,
		MaxEventBytes: maxEventBytes,
		Logger:        zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("building the ingestion handler: %v", err)
	}

	checker := health.NewChecker(func(context.Context) error { return nil })
	checker.MarkBootstrapped()

	return &ingestFixture{
		t:         t,
		db:        db,
		publisher: publisher,
		projectID: "visualise-ai",
		runID:     "run-2026-08-04-0001",
		engine: New(Options{
			Logger:  zerolog.Nop(),
			Health:  checker,
			Version: "test",
			Ingest:  handler,
		}),
	}
}

// truncateSchema empties every table so each test starts from a known state.
func truncateSchema(t *testing.T, db *gorm.DB) {
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

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

// testEvent mirrors the contract envelope so the tests build valid documents
// instead of hand-written JSON.
type testEvent struct {
	SchemaVersion string          `json:"schemaVersion"`
	ClientEventID string          `json:"clientEventId"`
	ProjectID     string          `json:"projectId"`
	RunID         string          `json:"runId"`
	AgentID       string          `json:"agentId"`
	ParentAgentID *string         `json:"parentAgentId,omitempty"`
	OccurredAt    string          `json:"occurredAt"`
	Type          string          `json:"type"`
	Payload       json.RawMessage `json:"payload"`
}

// nextOccurredAt keeps the reported timestamps strictly increasing.
func (f *ingestFixture) nextOccurredAt() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq++
	return time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC).
		Add(time.Duration(f.seq) * time.Second).Format(time.RFC3339)
}

// event builds a contract-valid envelope with a fresh idempotency key.
func (f *ingestFixture) event(agentID string, parent *string, eventType, payload string) testEvent {
	return testEvent{
		SchemaVersion: "1.0",
		ClientEventID: uuid.NewString(),
		ProjectID:     f.projectID,
		RunID:         f.runID,
		AgentID:       agentID,
		ParentAgentID: parent,
		OccurredAt:    f.nextOccurredAt(),
		Type:          eventType,
		Payload:       json.RawMessage(payload),
	}
}

func (f *ingestFixture) encode(event testEvent) string {
	f.t.Helper()
	raw, err := json.Marshal(event)
	if err != nil {
		f.t.Fatalf("encoding the test event: %v", err)
	}
	return string(raw)
}

// post sends one event body to the ingestion endpoint.
func (f *ingestFixture) post(body string) *httptest.ResponseRecorder {
	return f.postAs(body, "application/json")
}

func (f *ingestFixture) postAs(body, contentType string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, APIPrefix+"/events", strings.NewReader(body))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	recorder := httptest.NewRecorder()
	f.engine.ServeHTTP(recorder, request)
	return recorder
}

// send encodes and posts an event in one step.
func (f *ingestFixture) send(event testEvent) *httptest.ResponseRecorder {
	return f.post(f.encode(event))
}

// accept posts an event and requires it to be appended.
func (f *ingestFixture) accept(event testEvent) ingest.EventAccepted {
	f.t.Helper()
	recorder := f.send(event)
	if recorder.Code != http.StatusCreated {
		f.t.Fatalf("want 201 for %s, got %d: %s", event.Type, recorder.Code, recorder.Body.String())
	}
	return decodeAccepted(f.t, recorder)
}

// startRun appends the root agent.started that opens the fixture's run.
func (f *ingestFixture) startRun() ingest.EventAccepted {
	f.t.Helper()
	return f.accept(f.event("orchestrator-root", nil, "agent.started", `{
		"role": "orchestrator",
		"displayName": "Root Orchestrator",
		"assignedTask": "Deliver the v0 agent project cockpit."
	}`))
}

// startSubagent appends an agent.started below the root orchestrator.
func (f *ingestFixture) startSubagent(agentID string) ingest.EventAccepted {
	f.t.Helper()
	parent := "orchestrator-root"
	return f.accept(f.event(agentID, &parent, "agent.started", fmt.Sprintf(`{
		"role": "subagent",
		"displayName": %q,
		"assignedTask": "Do a part of the work."
	}`, agentID)))
}

func decodeAccepted(t *testing.T, recorder *httptest.ResponseRecorder) ingest.EventAccepted {
	t.Helper()
	var accepted ingest.EventAccepted
	if err := json.Unmarshal(recorder.Body.Bytes(), &accepted); err != nil {
		t.Fatalf("decoding the acknowledgement %q: %v", recorder.Body.String(), err)
	}
	return accepted
}

// requireProblem asserts the status, the media type and the error code of a
// rejection, and returns the parsed problem document.
func requireProblem(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string) ingest.Problem {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("want %d, got %d: %s", status, recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Errorf("want an RFC 9457 media type, got %q", got)
	}

	var problem ingest.Problem
	if err := json.Unmarshal(recorder.Body.Bytes(), &problem); err != nil {
		t.Fatalf("decoding the problem document %q: %v", recorder.Body.String(), err)
	}
	if problem.Code != code {
		t.Fatalf("want code %q, got %q (%s)", code, problem.Code, recorder.Body.String())
	}
	if problem.Status != status {
		t.Errorf("the problem repeats status %d, want %d", problem.Status, status)
	}
	if problem.Type == "" || problem.Title == "" || problem.Detail == "" {
		t.Errorf("the problem document is incomplete: %+v", problem)
	}
	return problem
}

// ---------------------------------------------------------------------------
// State assertions
// ---------------------------------------------------------------------------

func (f *ingestFixture) lastPosition() int64 {
	f.t.Helper()
	var project store.Project
	err := f.db.Where("project_id = ?", f.projectID).Take(&project).Error
	if err == gorm.ErrRecordNotFound {
		return 0
	}
	if err != nil {
		f.t.Fatalf("loading the project row: %v", err)
	}
	return project.LastPosition
}

func (f *ingestFixture) count(model any, query string, args ...any) int64 {
	f.t.Helper()
	var count int64
	tx := f.db.Model(model)
	if query != "" {
		tx = tx.Where(query, args...)
	}
	if err := tx.Count(&count).Error; err != nil {
		f.t.Fatalf("counting %T: %v", model, err)
	}
	return count
}

// ---------------------------------------------------------------------------
// Happy path and idempotency
// ---------------------------------------------------------------------------

func TestIngestAcceptsARootAgentStarted(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)

	event := f.event("orchestrator-root", nil, "agent.started", `{
		"role": "orchestrator",
		"displayName": "Root Orchestrator",
		"assignedTask": "Deliver the v0 agent project cockpit."
	}`)
	recorder := f.send(event)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	accepted := decodeAccepted(t, recorder)
	if accepted.Position != 1 {
		t.Errorf("the first event of a project takes position 1, got %d", accepted.Position)
	}
	if accepted.ProjectID != f.projectID {
		t.Errorf("want project %q, got %q", f.projectID, accepted.ProjectID)
	}
	if accepted.ClientEventID != event.ClientEventID {
		t.Errorf("the acknowledgement must echo the idempotency key, got %q", accepted.ClientEventID)
	}
	if accepted.Duplicate {
		t.Error("a first delivery is not a duplicate")
	}
	if _, err := uuid.Parse(accepted.ServerEventID); err != nil {
		t.Errorf("serverEventId %q is not a UUID: %v", accepted.ServerEventID, err)
	}
	if accepted.ReceivedAt.IsZero() {
		t.Error("the acknowledgement carries no receivedAt")
	}

	// The acknowledgement must not carry anything the contract does not declare.
	var fields map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &fields); err != nil {
		t.Fatalf("decoding the acknowledgement: %v", err)
	}
	for _, want := range []string{"projectId", "position", "serverEventId", "clientEventId", "duplicate", "receivedAt"} {
		if _, ok := fields[want]; !ok {
			t.Errorf("the acknowledgement is missing %q", want)
		}
	}
	if len(fields) != 6 {
		t.Errorf("the acknowledgement carries undeclared fields: %v", fields)
	}
}

func TestIdenticalRetryKeepsTheOriginalPosition(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)

	event := f.event("orchestrator-root", nil, "agent.started", `{
		"role": "orchestrator",
		"displayName": "Root Orchestrator",
		"assignedTask": "Deliver the v0 agent project cockpit."
	}`)
	body := f.encode(event)

	first := f.post(body)
	if first.Code != http.StatusCreated {
		t.Fatalf("want 201 for the first delivery, got %d: %s", first.Code, first.Body.String())
	}
	original := decodeAccepted(t, first)

	retry := f.post(body)
	if retry.Code != http.StatusOK {
		t.Fatalf("want 200 for a byte-identical retry, got %d: %s", retry.Code, retry.Body.String())
	}
	repeated := decodeAccepted(t, retry)

	if !repeated.Duplicate {
		t.Error("a retry must be reported as a duplicate")
	}
	if repeated.Position != original.Position {
		t.Errorf("a retry must repeat position %d, got %d", original.Position, repeated.Position)
	}
	if repeated.ServerEventID != original.ServerEventID {
		t.Errorf("a retry must repeat serverEventId %q, got %q", original.ServerEventID, repeated.ServerEventID)
	}
	if rows := f.count(&store.Event{}, ""); rows != 1 {
		t.Errorf("a retry must not append a second row, found %d", rows)
	}
	if position := f.lastPosition(); position != 1 {
		t.Errorf("a retry must not advance the project head, got %d", position)
	}
}

func TestReusedClientEventIdWithDifferentContentConflicts(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()

	first := f.event("orchestrator-root", nil, "agent.status_reported", `{"status": "working"}`)
	f.accept(first)

	second := first
	second.OccurredAt = f.nextOccurredAt()
	second.Payload = json.RawMessage(`{"status": "blocked"}`)

	problem := requireProblem(t, f.send(second), http.StatusConflict, "client_event_id_conflict")
	if !strings.Contains(problem.Detail, first.ClientEventID) {
		t.Errorf("the conflict must name the reused key, got %q", problem.Detail)
	}
	if rows := f.count(&store.Event{}, ""); rows != 2 {
		t.Errorf("a conflict must not append, found %d rows", rows)
	}
}

// ---------------------------------------------------------------------------
// Contract rejections
// ---------------------------------------------------------------------------

func TestUnknownEventTypeIsRejected(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)

	event := f.event("orchestrator-root", nil, "tool.invoked", `{"tool": "bash", "command": "ls -la"}`)
	problem := requireProblem(t, f.send(event), http.StatusBadRequest, "unsupported_event_type")

	if len(problem.Errors) == 0 {
		t.Fatal("a validation problem must carry at least one field error")
	}
	if problem.Errors[0].Field != "/type" {
		t.Errorf("want the violation at /type, got %q", problem.Errors[0].Field)
	}
	if f.lastPosition() != 0 {
		t.Error("a rejected event must not open a project")
	}
}

func TestUnsupportedSchemaVersionIsRejected(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)

	event := f.event("orchestrator-root", nil, "agent.started", `{
		"role": "orchestrator",
		"displayName": "Root Orchestrator",
		"assignedTask": "Deliver the v0 agent project cockpit."
	}`)
	event.SchemaVersion = "2.0"

	problem := requireProblem(t, f.send(event), http.StatusBadRequest, "unsupported_schema_version")
	if len(problem.Errors) == 0 || problem.Errors[0].Field != "/schemaVersion" {
		t.Errorf("want the violation at /schemaVersion, got %+v", problem.Errors)
	}
}

// TestEveryFieldViolationIsReported is the difference between a usable and a
// useless error response: an agent must learn about all its mistakes at once
// rather than fixing them one redelivery at a time.
func TestEveryFieldViolationIsReported(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)

	body := `{
		"schemaVersion": "1.0",
		"clientEventId": "not-a-uuid",
		"projectId": "Visualise-AI",
		"runId": "run-2026-08-04-0001",
		"agentId": "subagent-one",
		"occurredAt": "yesterday",
		"type": "agent.progress_reported",
		"payload": {
			"percent": 140,
			"scope": "guesswork",
			"rawTerminalOutput": "$ npm test"
		}
	}`

	problem := requireProblem(t, f.post(body), http.StatusBadRequest, "invalid_field")

	want := map[string]string{
		"/clientEventId":             "invalid_format",
		"/projectId":                 "pattern_mismatch",
		"/occurredAt":                "invalid_format",
		"/payload/percent":           "out_of_range",
		"/payload/scope":             "invalid_enum",
		"/payload/basis":             "required",
		"/payload/rawTerminalOutput": "unknown_property",
	}
	got := make(map[string]string, len(problem.Errors))
	for _, violation := range problem.Errors {
		got[violation.Field] = violation.Code
		if !strings.HasPrefix(violation.Field, "/") {
			t.Errorf("field %q is not a JSON Pointer", violation.Field)
		}
		if violation.Message == "" {
			t.Errorf("%s carries no message", violation.Field)
		}
	}
	for field, code := range want {
		if got[field] != code {
			t.Errorf("want %s -> %q, got %q (all: %v)", field, code, got[field], got)
		}
	}
	if len(got) != len(want) {
		t.Errorf("want %d violations, got %d: %v", len(want), len(got), got)
	}
}

func TestMalformedJSONIsRejectedWithALocation(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)

	problem := requireProblem(t,
		f.post(`{"projectId": "visualise-ai", "payload": {"percent": tru}}`),
		http.StatusBadRequest, "invalid_field")

	if len(problem.Errors) != 1 {
		t.Fatalf("want one violation, got %+v", problem.Errors)
	}
	if problem.Errors[0].Field != "/payload/percent" {
		t.Errorf("want the syntax error located at /payload/percent, got %q", problem.Errors[0].Field)
	}
}

func TestBodyAboveTheLimitIsRejected(t *testing.T) {
	const limit = 4096
	f := newIngestFixture(t, limit)

	event := f.event("orchestrator-root", nil, "agent.started", fmt.Sprintf(`{
		"role": "orchestrator",
		"displayName": "Root Orchestrator",
		"assignedTask": %q
	}`, strings.Repeat("x", 2*limit)))

	problem := requireProblem(t, f.send(event), http.StatusRequestEntityTooLarge, "event_too_large")
	if !strings.Contains(problem.Detail, fmt.Sprint(limit)) {
		t.Errorf("the rejection must name the configured limit, got %q", problem.Detail)
	}
	if f.lastPosition() != 0 {
		t.Error("an oversized event must not open a project")
	}
}

func TestWrongContentTypeIsRejected(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)

	event := f.event("orchestrator-root", nil, "agent.started", `{
		"role": "orchestrator",
		"displayName": "Root Orchestrator",
		"assignedTask": "Deliver the v0 agent project cockpit."
	}`)

	requireProblem(t, f.postAs(f.encode(event), "text/plain"),
		http.StatusUnsupportedMediaType, "unsupported_media_type")
	requireProblem(t, f.postAs(f.encode(event), ""),
		http.StatusUnsupportedMediaType, "unsupported_media_type")

	// A charset parameter is part of the media type, not a different one.
	if recorder := f.postAs(f.encode(event), "application/json; charset=utf-8"); recorder.Code != http.StatusCreated {
		t.Errorf("want 201 for application/json with a charset, got %d", recorder.Code)
	}
}

// ---------------------------------------------------------------------------
// Lifecycle rules
// ---------------------------------------------------------------------------

func TestEventForANeverStartedRunIsRejected(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)

	event := f.event("orchestrator-root", nil, "agent.status_reported", `{"status": "working"}`)
	requireProblem(t, f.send(event), http.StatusUnprocessableEntity, "run_not_started")

	if f.lastPosition() != 0 {
		t.Error("an event of an unopened run must not take a position")
	}
}

func TestEventOfAnUnknownAgentIsRejected(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()

	event := f.event("subagent-ghost", nil, "agent.status_reported", `{"status": "working"}`)
	problem := requireProblem(t, f.send(event), http.StatusUnprocessableEntity, "unknown_agent")

	if !strings.Contains(problem.Detail, "subagent-ghost") {
		t.Errorf("the rejection must name the unknown agent, got %q", problem.Detail)
	}
	if position := f.lastPosition(); position != 1 {
		t.Errorf("only the accepted root event may have taken a position, got %d", position)
	}
}

func TestUnknownParentAgentIsRejected(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()

	parent := "subagent-never-started"
	event := f.event("subagent-one", &parent, "agent.started", `{
		"role": "subagent",
		"displayName": "Subagent One",
		"assignedTask": "Do a part of the work."
	}`)

	problem := requireProblem(t, f.send(event), http.StatusUnprocessableEntity, "parent_agent_unknown")
	if !strings.Contains(problem.Detail, parent) {
		t.Errorf("the rejection must name the unknown parent, got %q", problem.Detail)
	}
	if agents := f.count(&store.Agent{}, ""); agents != 1 {
		t.Errorf("the rejected subagent must not appear in the agent tree, found %d agents", agents)
	}
}

func TestASecondRootAgentStartedIsRejected(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()

	event := f.event("orchestrator-second", nil, "agent.started", `{
		"role": "orchestrator",
		"displayName": "Another Orchestrator",
		"assignedTask": "Open the same run once more."
	}`)

	requireProblem(t, f.send(event), http.StatusUnprocessableEntity, "run_already_started")
	if agents := f.count(&store.Agent{}, ""); agents != 1 {
		t.Errorf("a run has exactly one root orchestrator, found %d agents", agents)
	}
}

func TestOnlyTheOrchestratorMayFinishTheRun(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()
	f.startSubagent("subagent-one")

	parent := "orchestrator-root"
	bySubagent := f.event("subagent-one", &parent, "run.finished", `{"outcome": "completed"}`)
	requireProblem(t, f.send(bySubagent), http.StatusUnprocessableEntity, "terminal_event_not_allowed")

	var run store.Run
	if err := f.db.Where("project_id = ? AND run_id = ?", f.projectID, f.runID).Take(&run).Error; err != nil {
		t.Fatalf("loading the run row: %v", err)
	}
	if !run.IsOpen {
		t.Error("a refused terminal event must leave the run open")
	}

	// The orchestrator itself may close it.
	f.accept(f.event("orchestrator-root", nil, "run.finished", `{"outcome": "completed"}`))
}

func TestFinishedRunRefusesWorkButAcceptsCorrections(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()

	reported := f.event("orchestrator-root", nil, "risk.reported", `{
		"riskId": "risk-1",
		"componentIds": ["backend"],
		"title": "The estimate is optimistic",
		"severity": "medium"
	}`)
	f.accept(reported)
	f.accept(f.event("orchestrator-root", nil, "run.finished", `{"outcome": "completed"}`))

	work := f.event("orchestrator-root", nil, "work.step_started", `{
		"workStepId": "work-1",
		"title": "Start more work",
		"componentIds": ["backend"]
	}`)
	requireProblem(t, f.send(work), http.StatusUnprocessableEntity, "run_already_finished")

	// A finished run must stay correctable, otherwise its last reported state
	// could never be put right again.
	correction := f.event("orchestrator-root", nil, "correction.issued", fmt.Sprintf(`{
		"correctsClientEventId": %q,
		"reason": "The severity was overstated.",
		"correctedType": "risk.reported",
		"correctedPayload": {
			"riskId": "risk-1",
			"componentIds": ["backend"],
			"title": "The estimate is optimistic",
			"severity": "low"
		}
	}`, reported.ClientEventID))
	f.accept(correction)

	retraction := f.event("orchestrator-root", nil, "retraction.issued", fmt.Sprintf(`{
		"retractsClientEventId": %q,
		"reason": "The risk no longer applies."
	}`, reported.ClientEventID))
	f.accept(retraction)
}

func TestCorrectionOfAnUnknownEventIsRejected(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()

	unknown := uuid.NewString()
	correction := f.event("orchestrator-root", nil, "correction.issued", fmt.Sprintf(`{
		"correctsClientEventId": %q,
		"reason": "Correcting something that was never reported.",
		"correctedType": "agent.status_reported",
		"correctedPayload": {"status": "blocked"}
	}`, unknown))

	problem := requireProblem(t, f.send(correction), http.StatusUnprocessableEntity, "correction_target_unknown")
	if !strings.Contains(problem.Detail, unknown) {
		t.Errorf("the rejection must name the unknown target, got %q", problem.Detail)
	}

	retraction := f.event("orchestrator-root", nil, "retraction.issued", fmt.Sprintf(`{
		"retractsClientEventId": %q,
		"reason": "Retracting something that was never reported."
	}`, uuid.NewString()))
	requireProblem(t, f.send(retraction), http.StatusUnprocessableEntity, "correction_target_unknown")
}

// ---------------------------------------------------------------------------
// Acceptance criteria of the issue
// ---------------------------------------------------------------------------

// TestRejectedEventsOccupyNoPositionAndChangeNoProjection is the acceptance
// criterion that ties the ingestion layer to the store: whatever a rejection
// costs, it must not cost a project position, because that position is the SSE
// replay cursor and a gap in it cannot be repaired afterwards.
func TestRejectedEventsOccupyNoPositionAndChangeNoProjection(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()
	f.startSubagent("subagent-one")

	positionBefore := f.lastPosition()
	eventsBefore := f.count(&store.Event{}, "")
	agentsBefore := f.count(&store.Agent{}, "")
	stepsBefore := f.count(&store.WorkStep{}, "")
	risksBefore := f.count(&store.Risk{}, "")

	unknownParent := "subagent-never-started"
	rejections := []struct {
		name  string
		event testEvent
	}{
		{"unknown event type", f.event("orchestrator-root", nil, "tool.invoked", `{"tool": "bash"}`)},
		{"unknown agent", f.event("subagent-ghost", nil, "work.step_started", `{
			"workStepId": "work-ghost", "title": "Ghost work", "componentIds": ["backend"]
		}`)},
		{"unknown parent", f.event("subagent-two", &unknownParent, "agent.started", `{
			"role": "subagent", "displayName": "Subagent Two", "assignedTask": "Work."
		}`)},
		{"correction target unknown", f.event("orchestrator-root", nil, "correction.issued", fmt.Sprintf(`{
			"correctsClientEventId": %q, "reason": "Nothing to correct.",
			"correctedType": "agent.status_reported", "correctedPayload": {"status": "idle"}
		}`, uuid.NewString()))},
		{"second root agent", f.event("orchestrator-other", nil, "agent.started", `{
			"role": "orchestrator", "displayName": "Other", "assignedTask": "Reopen the run."
		}`)},
		{"field violations", f.event("orchestrator-root", nil, "risk.reported", `{
			"riskId": "risk-bad", "componentIds": [], "title": "", "severity": "catastrophic"
		}`)},
	}

	for _, rejection := range rejections {
		recorder := f.send(rejection.event)
		if recorder.Code < 400 || recorder.Code >= 500 {
			t.Fatalf("%s: want a client error, got %d: %s",
				rejection.name, recorder.Code, recorder.Body.String())
		}
	}

	if position := f.lastPosition(); position != positionBefore {
		t.Errorf("the project head moved from %d to %d despite only rejections", positionBefore, position)
	}
	if events := f.count(&store.Event{}, ""); events != eventsBefore {
		t.Errorf("the log grew from %d to %d rows despite only rejections", eventsBefore, events)
	}
	if agents := f.count(&store.Agent{}, ""); agents != agentsBefore {
		t.Errorf("the agent tree grew from %d to %d rows despite only rejections", agentsBefore, agents)
	}
	if steps := f.count(&store.WorkStep{}, ""); steps != stepsBefore {
		t.Errorf("work steps grew from %d to %d despite only rejections", stepsBefore, steps)
	}
	if risks := f.count(&store.Risk{}, ""); risks != risksBefore {
		t.Errorf("risks grew from %d to %d despite only rejections", risksBefore, risks)
	}

	// The next accepted event continues without a gap.
	accepted := f.accept(f.event("orchestrator-root", nil, "agent.status_reported", `{"status": "working"}`))
	if accepted.Position != positionBefore+1 {
		t.Errorf("want the next position %d, got %d", positionBefore+1, accepted.Position)
	}
}

// TestConcurrentAgentsGetOneOrdering covers the acceptance criterion that
// parallel agents receive a single comprehensible project ordering: the
// positions handed out under concurrency are unique, gapless and monotonic.
func TestConcurrentAgentsGetOneOrdering(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	f.startRun()

	const agents = 6
	const perAgent = 5

	for i := 0; i < agents; i++ {
		f.startSubagent(fmt.Sprintf("subagent-%d", i))
	}
	base := f.lastPosition()

	parent := "orchestrator-root"
	positions := make(chan int64, agents*perAgent)
	var wg sync.WaitGroup
	for i := 0; i < agents; i++ {
		wg.Add(1)
		go func(agent int) {
			defer wg.Done()
			for step := 0; step < perAgent; step++ {
				event := f.event(fmt.Sprintf("subagent-%d", agent), &parent,
					"agent.progress_reported", fmt.Sprintf(`{
						"percent": %d, "scope": "own_task", "basis": "reported_estimate"
					}`, step*20))
				recorder := f.send(event)
				if recorder.Code != http.StatusCreated {
					t.Errorf("agent %d step %d: want 201, got %d: %s",
						agent, step, recorder.Code, recorder.Body.String())
					return
				}
				// Decoded inline rather than through the helper: a t.Fatalf
				// from this goroutine would strand the WaitGroup.
				var accepted ingest.EventAccepted
				if err := json.Unmarshal(recorder.Body.Bytes(), &accepted); err != nil {
					t.Errorf("agent %d step %d: decoding the acknowledgement: %v", agent, step, err)
					return
				}
				positions <- accepted.Position
			}
		}(i)
	}
	wg.Wait()
	close(positions)

	seen := make(map[int64]bool, agents*perAgent)
	for position := range positions {
		if seen[position] {
			t.Errorf("position %d was handed out twice", position)
		}
		seen[position] = true
	}
	if len(seen) != agents*perAgent {
		t.Fatalf("want %d positions, got %d", agents*perAgent, len(seen))
	}
	for offset := int64(1); offset <= agents*perAgent; offset++ {
		if !seen[base+offset] {
			t.Errorf("position %d is missing: the ordering has a gap", base+offset)
		}
	}
	if position := f.lastPosition(); position != base+agents*perAgent {
		t.Errorf("want the project head at %d, got %d", base+agents*perAgent, position)
	}
	if rows := f.count(&store.Event{}, ""); rows != base+agents*perAgent {
		t.Errorf("want %d stored events, got %d", base+agents*perAgent, rows)
	}
}

// TestPublisherSeesEveryAcceptedEventExactlyOnce pins the post-commit hook: a
// subscriber must receive each position once, and must never see a retry or a
// rejection, which would deliver a duplicate or an event that does not exist.
func TestPublisherSeesEveryAcceptedEventExactlyOnce(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)
	root := f.startRun()

	status := f.event("orchestrator-root", nil, "agent.status_reported", `{"status": "working"}`)
	body := f.encode(status)
	if recorder := f.post(body); recorder.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	// A retry: already published when it was first accepted.
	if recorder := f.post(body); recorder.Code != http.StatusOK {
		t.Fatalf("want 200 for the retry, got %d: %s", recorder.Code, recorder.Body.String())
	}
	// A rejection: never committed, so never published.
	rejected := f.event("subagent-ghost", nil, "agent.status_reported", `{"status": "working"}`)
	requireProblem(t, f.send(rejected), http.StatusUnprocessableEntity, "unknown_agent")

	published := f.publisher.published()
	if len(published) != 2 {
		t.Fatalf("want exactly the two accepted events published, got %d: %+v", len(published), published)
	}
	if published[0].Position != root.Position || published[0].Type != "agent.started" {
		t.Errorf("the first published event is wrong: %+v", published[0])
	}
	if published[1].Position != root.Position+1 || published[1].ClientEventID != status.ClientEventID {
		t.Errorf("the second published event is wrong: %+v", published[1])
	}
	for _, event := range published {
		if event.ProjectID != f.projectID || event.ServerEventID == "" || event.ReceivedAt.IsZero() {
			t.Errorf("a published event lacks its server-assigned metadata: %+v", event)
		}
		if len(event.Payload) == 0 {
			t.Errorf("a published event carries no payload: %+v", event)
		}
	}
}

// expectedFixtureRejections names the code each contract rejection fixture must
// produce. A new fixture without an entry fails the test on purpose: the
// contract and the backend have to agree on what it proves.
var expectedFixtureRejections = map[string]string{
	"unknown-event-type.json":         "unsupported_event_type",
	"unsupported-schema-version.json": "unsupported_schema_version",
	"unknown-payload-field.json":      "invalid_field",
	"diff-with-absolute-path.json":    "invalid_field",
	"progress-out-of-range.json":      "invalid_field",
}

// TestContractRejectionFixturesAreRefused runs the documents the contract
// declares unrepresentable through the real endpoint. They are what keeps the
// "closed catalogue" claim of the spec honest on the backend side.
func TestContractRejectionFixturesAreRefused(t *testing.T) {
	f := newIngestFixture(t, defaultTestMaxEventBytes)

	dir := filepath.Join("..", "..", "..", "api", "fixtures", "invalid")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("reading the rejection fixtures: %v", err)
	}

	found := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		found++
		t.Run(entry.Name(), func(t *testing.T) {
			wantCode, known := expectedFixtureRejections[entry.Name()]
			if !known {
				t.Fatalf("fixture %s has no expected rejection code; add it to expectedFixtureRejections",
					entry.Name())
			}

			raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
			if err != nil {
				t.Fatalf("reading %s: %v", entry.Name(), err)
			}
			// _reason documents what the fixture proves and is not part of the
			// contract, so it is stripped before the document is posted.
			var document map[string]json.RawMessage
			if err := json.Unmarshal(raw, &document); err != nil {
				t.Fatalf("decoding %s: %v", entry.Name(), err)
			}
			delete(document, "_reason")
			body, err := json.Marshal(document)
			if err != nil {
				t.Fatalf("re-encoding %s: %v", entry.Name(), err)
			}

			requireProblem(t, f.post(string(body)), http.StatusBadRequest, wantCode)
		})
	}

	if found != len(expectedFixtureRejections) {
		t.Errorf("want %d rejection fixtures, found %d", len(expectedFixtureRejections), found)
	}
	if f.lastPosition() != 0 {
		t.Error("a refused fixture must not open a project")
	}
	if events := f.count(&store.Event{}, ""); events != 0 {
		t.Errorf("a refused fixture must not be stored, found %d rows", events)
	}
}

// TestIngestRouteIsAbsentWithoutAHandler documents the optional wiring: a
// router built without ingestion answers 404 rather than panicking.
func TestIngestRouteIsAbsentWithoutAHandler(t *testing.T) {
	_, handler := newTestRouter(func(context.Context) error { return nil }, true)

	request := httptest.NewRequest(http.MethodPost, APIPrefix+"/events", strings.NewReader("{}"))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("want 404 without an ingestion handler, got %d", recorder.Code)
	}
}
