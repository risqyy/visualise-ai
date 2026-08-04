package store

import (
	"context"
	"encoding/json"
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
)

// The store tests run against a real PostgreSQL instance: row locking, jsonb,
// composite unique constraints and transaction rollback are exactly the
// properties under test, and none of them can be demonstrated on a stand-in.
//
//	docker run -d --name vai-test-pg -e POSTGRES_PASSWORD=test \
//	  -e POSTGRES_USER=test -e POSTGRES_DB=test -p 55432:5432 postgres:17-alpine
//	TEST_DATABASE_URL='postgres://test:test@127.0.0.1:55432/test?sslmode=disable' \
//	  go test ./internal/store/...
//
// Without TEST_DATABASE_URL every test in this package skips, so `go test ./...`
// stays green on a machine without a database.
const testDatabaseURLEnv = "TEST_DATABASE_URL"

var (
	migrateOnce sync.Once
	migrateErr  error
)

// baseTime anchors the reported timestamps so assertions stay deterministic.
var baseTime = time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)

func testDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := strings.TrimSpace(os.Getenv(testDatabaseURLEnv))
	if dsn == "" {
		t.Skipf("%s is not set: skipping the PostgreSQL backed store tests", testDatabaseURLEnv)
	}

	db, err := database.Open(context.Background(), dsn, 30*time.Second, zerolog.Nop())
	if err != nil {
		t.Fatalf("opening the test database: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := database.Close(db); closeErr != nil {
			t.Errorf("closing the test database: %v", closeErr)
		}
	})

	migrateOnce.Do(func() { migrateErr = Migrate(db) })
	if migrateErr != nil {
		t.Fatalf("migrating the test schema: %v", migrateErr)
	}
	truncateAll(t, db)
	return db
}

// truncateAll empties every table so each test starts from a known state.
func truncateAll(t *testing.T, db *gorm.DB) {
	t.Helper()

	names := make([]string, 0, len(Models()))
	for _, model := range Models() {
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

// scenario appends events for one project and keeps the reported timestamps
// strictly increasing.
type scenario struct {
	t         *testing.T
	db        *gorm.DB
	store     *Store
	projectID string
	runID     string
	seq       int
}

func newScenario(t *testing.T) *scenario {
	t.Helper()
	db := testDB(t)
	return &scenario{
		t:         t,
		db:        db,
		store:     New(db),
		projectID: "visualise-ai",
		runID:     "run-2026-08-04-0001",
	}
}

func (s *scenario) nextTime() time.Time {
	s.seq++
	return baseTime.Add(time.Duration(s.seq) * time.Second)
}

// event builds an envelope for the scenario's project and run.
func (s *scenario) event(agentID string, parent *string, evType, payload string) Envelope {
	return Envelope{
		ProjectID:     s.projectID,
		ClientEventID: uuid.NewString(),
		RunID:         s.runID,
		AgentID:       agentID,
		ParentAgentID: parent,
		Type:          evType,
		SchemaVersion: "1.0",
		OccurredAt:    s.nextTime(),
		Payload:       json.RawMessage(payload),
	}
}

// append stores an envelope and fails the test when the store rejects it.
func (s *scenario) append(env Envelope) Result {
	s.t.Helper()
	result, err := s.store.Append(context.Background(), env)
	if err != nil {
		s.t.Fatalf("appending %s: %v", env.Type, err)
	}
	return result
}

// emit is the common case: build an envelope and append it in one step.
func (s *scenario) emit(agentID string, parent *string, evType, payload string) Result {
	s.t.Helper()
	return s.append(s.event(agentID, parent, evType, payload))
}

// startRun appends the root agent.started that opens the scenario's run.
func (s *scenario) startRun() Result {
	s.t.Helper()
	return s.emit("orchestrator-root", nil, TypeAgentStarted, `{
		"role": "orchestrator",
		"displayName": "Root Orchestrator",
		"assignedTask": "Deliver the v0 agent project cockpit."
	}`)
}

// exampleEvent mirrors the envelope of the contract examples in api/examples.
type exampleEvent struct {
	SchemaVersion string          `json:"schemaVersion"`
	ClientEventID string          `json:"clientEventId"`
	ProjectID     string          `json:"projectId"`
	RunID         string          `json:"runId"`
	AgentID       string          `json:"agentId"`
	ParentAgentID *string         `json:"parentAgentId"`
	OccurredAt    time.Time       `json:"occurredAt"`
	Type          string          `json:"type"`
	Payload       json.RawMessage `json:"payload"`
}

// loadExample reads one of the contract examples and rebinds it to the
// scenario, so contract and store are exercised against the same documents.
func (s *scenario) loadExample(name string) Envelope {
	s.t.Helper()

	path := filepath.Join("..", "..", "..", "api", "examples", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		s.t.Fatalf("reading example %s: %v", name, err)
	}
	var example exampleEvent
	if err := json.Unmarshal(raw, &example); err != nil {
		s.t.Fatalf("decoding example %s: %v", name, err)
	}

	return Envelope{
		ProjectID:     s.projectID,
		ClientEventID: uuid.NewString(),
		RunID:         s.runID,
		AgentID:       example.AgentID,
		ParentAgentID: example.ParentAgentID,
		Type:          example.Type,
		SchemaVersion: example.SchemaVersion,
		OccurredAt:    s.nextTime(),
		Payload:       example.Payload,
	}
}

func (s *scenario) mustCount(model any, query string, args ...any) int64 {
	s.t.Helper()
	var count int64
	if err := s.db.Model(model).Where(query, args...).Count(&count).Error; err != nil {
		s.t.Fatalf("counting %T: %v", model, err)
	}
	return count
}

func (s *scenario) project() Project {
	s.t.Helper()
	var project Project
	if err := s.db.Where("project_id = ?", s.projectID).Take(&project).Error; err != nil {
		s.t.Fatalf("loading the project row: %v", err)
	}
	return project
}

func (s *scenario) run() Run {
	s.t.Helper()
	var run Run
	if err := s.db.Where("project_id = ? AND run_id = ?", s.projectID, s.runID).Take(&run).Error; err != nil {
		s.t.Fatalf("loading the run row: %v", err)
	}
	return run
}

func (s *scenario) agent(agentID string) Agent {
	s.t.Helper()
	var agent Agent
	err := s.db.Where("project_id = ? AND run_id = ? AND agent_id = ?", s.projectID, s.runID, agentID).
		Take(&agent).Error
	if err != nil {
		s.t.Fatalf("loading agent %q: %v", agentID, err)
	}
	return agent
}

func (s *scenario) component(componentID string) Component {
	s.t.Helper()
	var component Component
	err := s.db.Where("project_id = ? AND component_id = ?", s.projectID, componentID).Take(&component).Error
	if err != nil {
		s.t.Fatalf("loading component %q: %v", componentID, err)
	}
	return component
}

func (s *scenario) activeChange(changeID string) ActiveChange {
	s.t.Helper()
	var change ActiveChange
	if err := s.db.Where("project_id = ? AND change_id = ?", s.projectID, changeID).Take(&change).Error; err != nil {
		s.t.Fatalf("loading change %q: %v", changeID, err)
	}
	return change
}

func ptr(value string) *string { return &value }
