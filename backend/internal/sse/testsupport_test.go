package sse_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
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
	"github.com/risqyy/visualise-ai/backend/internal/ingest"
	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/sse"
	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// The stream is tested against a real PostgreSQL instance, over a real HTTP
// connection and through the real ingestion path: every fixture event is POSTed
// to /api/v1/events, so an event only ever reaches the broker the way it does
// in production — after its append transaction committed.
//
//	docker run -d --name vai-test-pg-6 -e POSTGRES_PASSWORD=test \
//	  -e POSTGRES_USER=test -e POSTGRES_DB=test -p 55438:5432 postgres:17-alpine
//	TEST_DATABASE_URL='postgres://test:test@127.0.0.1:55438/test?sslmode=disable' \
//	  go test ./internal/sse/...
//
// Without TEST_DATABASE_URL every test here skips, so `go test ./...` stays
// green on a machine without a database.
const testDatabaseURLEnv = "TEST_DATABASE_URL"

// testSchema keeps these tests in a PostgreSQL schema of their own.
//
// `go test ./...` runs packages in parallel and every package truncates the
// whole schema before it seeds. Without the separation the store, readapi and
// stream tests would wipe each other's fixtures on a shared TEST_DATABASE_URL.
const testSchema = "sse_test"

// replayPageSize is deliberately tiny so every replay in this suite needs
// several round trips. That is what opens the window a concurrently committing
// writer must not be able to slip through.
const replayPageSize = 3

// keepaliveInterval keeps the idle comment observable inside a test.
const keepaliveInterval = 100 * time.Millisecond

// frameTimeout bounds how long a test waits for the next frame.
const frameTimeout = 20 * time.Second

var (
	migrateOnce sync.Once
	migrateErr  error

	contractOnce sync.Once
	contract     *ingest.Contract
	contractErr  error
)

// baseTime anchors the reported timestamps so ordering assertions are exact.
var baseTime = time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC)

// instance is one backend process as far as these tests are concerned: its own
// broker, its own router and its own listening socket, sharing the database.
// Replacing it is how a backend restart is simulated.
type instance struct {
	broker *sse.Broker
	server *httptest.Server
}

// harness owns the database and the currently running instance.
type harness struct {
	t   *testing.T
	db  *gorm.DB
	cur *instance
	seq int
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	dsn := strings.TrimSpace(os.Getenv(testDatabaseURLEnv))
	if dsn == "" {
		t.Skipf("%s is not set: skipping the PostgreSQL backed stream tests", testDatabaseURLEnv)
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

	h := &harness{t: t, db: db}
	h.cur = h.start()
	return h
}

// start brings up one backend instance: broker, ingestion, read models and the
// stream, wired through the production router.
//
// The read models are mounted on purpose. They register `/projects/:projectId/…`
// first, so building this router at all proves the stream reuses that wildcard
// name instead of making Gin panic.
func (h *harness) start() *instance {
	h.t.Helper()

	broker := sse.NewBroker(sse.BrokerOptions{Logger: zerolog.Nop()})
	server := httptest.NewServer(h.router(broker))

	inst := &instance{broker: broker, server: server}
	h.t.Cleanup(func() {
		// Ending the subscriptions first is what lets Close return: an open
		// stream never goes idle on its own.
		inst.broker.Shutdown()
		inst.server.Close()
	})
	return inst
}

// router builds the production router in front of one broker.
func (h *harness) router(broker *sse.Broker) http.Handler {
	h.t.Helper()

	contractOnce.Do(func() { contract, contractErr = ingest.LoadContract() })
	if contractErr != nil {
		h.t.Fatalf("loading the event contract: %v", contractErr)
	}

	ingestHandler, err := ingest.NewHandler(ingest.HandlerOptions{
		Store:         store.New(h.db),
		Contract:      contract,
		Publisher:     broker,
		MaxEventBytes: 2 * 1024 * 1024,
		Logger:        zerolog.Nop(),
	})
	if err != nil {
		h.t.Fatalf("building the ingestion handler: %v", err)
	}

	checker := health.NewChecker(func(context.Context) error { return nil })
	checker.MarkBootstrapped()

	return httpapi.New(httpapi.Options{
		Logger:  zerolog.New(io.Discard),
		Health:  checker,
		Version: "test",
		Ingest:  ingestHandler,
		Read:    readapi.New(h.db),
		Stream: sse.NewHandler(sse.HandlerOptions{
			Broker:            broker,
			Reader:            sse.NewEventReader(h.db),
			KeepaliveInterval: keepaliveInterval,
			ReplayPageSize:    replayPageSize,
			Logger:            zerolog.Nop(),
		}),
	})
}

// restart replaces the running instance with a fresh one, exactly as a process
// restart would: a new, empty broker in front of the same PostgreSQL log.
func (h *harness) restart() {
	h.t.Helper()
	h.cur.broker.Shutdown()
	h.cur.server.Close()
	h.cur = h.start()
}

func (h *harness) broker() *sse.Broker { return h.cur.broker }

// withSearchPath pins the connection to one schema.
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

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

// nextTime keeps every reported timestamp of a test strictly increasing.
func (h *harness) nextTime() time.Time {
	h.seq++
	return baseTime.Add(time.Duration(h.seq) * time.Second)
}

// runContext ingests events for one (project, run) pair.
type runContext struct {
	h         *harness
	projectID string
	runID     string
	agentID   string
}

// openRun ingests the root agent.started that opens a run, which is what makes
// every later event of that run acceptable.
func (h *harness) openRun(projectID, runID string) *runContext {
	h.t.Helper()
	r := &runContext{h: h, projectID: projectID, runID: runID, agentID: "orchestrator-root"}
	r.emit(store.TypeAgentStarted, `{
		"role": "orchestrator",
		"displayName": "Root orchestrator",
		"assignedTask": "Observe the stream"
	}`)
	return r
}

// emit POSTs one event to the real ingestion endpoint and returns the position
// the server assigned. Publication therefore happens the production way.
func (r *runContext) emit(eventType, payload string) int64 {
	r.h.t.Helper()
	status, body := r.post(r.envelope(eventType, payload))
	if status != http.StatusCreated {
		r.h.t.Fatalf("POST /api/v1/events: want 201, got %d: %s", status, body)
	}
	var accepted struct {
		Position int64 `json:"position"`
	}
	if err := json.Unmarshal([]byte(body), &accepted); err != nil {
		r.h.t.Fatalf("decoding the ingestion response: %v: %s", err, body)
	}
	return accepted.Position
}

// note ingests one agent.status_reported, the cheapest event that carries a
// distinguishable payload.
func (r *runContext) note(text string) int64 {
	r.h.t.Helper()
	return r.emit(store.TypeAgentStatusReported,
		fmt.Sprintf(`{"status": "working", "note": %q}`, text))
}

// seedHistory appends n events straight through the store and returns the last
// position it assigned.
//
// Bulk history deliberately skips the HTTP round trip and the publisher: these
// events are the past a reconnecting client replays, and nobody was listening
// when they happened. Seeding them this way is what makes a replay long enough
// to hold a connection busy for a measurable time.
func (r *runContext) seedHistory(n int) int64 {
	r.h.t.Helper()

	appender := store.New(r.h.db)
	var last int64
	for i := 0; i < n; i++ {
		result, err := appender.Append(context.Background(), store.Envelope{
			ProjectID:     r.projectID,
			ClientEventID: uuid.NewString(),
			RunID:         r.runID,
			AgentID:       r.agentID,
			Type:          store.TypeAgentStatusReported,
			SchemaVersion: "1.0",
			OccurredAt:    r.h.nextTime(),
			Payload:       json.RawMessage(fmt.Sprintf(`{"status":"working","note":"history %d"}`, i)),
		})
		if err != nil {
			r.h.t.Fatalf("seeding history of %s: %v", r.projectID, err)
		}
		last = result.Position
	}
	return last
}

// envelope assembles a contract-valid request body.
func (r *runContext) envelope(eventType, payload string) string {
	return fmt.Sprintf(`{
		"schemaVersion": "1.0",
		"clientEventId": %q,
		"projectId": %q,
		"runId": %q,
		"agentId": %q,
		"occurredAt": %q,
		"type": %q,
		"payload": %s
	}`, uuid.NewString(), r.projectID, r.runID, r.agentID,
		r.h.nextTime().Format(time.RFC3339), eventType, payload)
}

// post sends one ingestion request and returns status and body.
func (r *runContext) post(body string) (int, string) {
	r.h.t.Helper()
	response, err := http.Post(r.h.cur.server.URL+"/api/v1/events", "application/json", strings.NewReader(body))
	if err != nil {
		r.h.t.Fatalf("POST /api/v1/events: %v", err)
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(response.Body)
	if err != nil {
		r.h.t.Fatalf("reading the ingestion response: %v", err)
	}
	return response.StatusCode, string(raw)
}

// ---------------------------------------------------------------------------
// Stream client
// ---------------------------------------------------------------------------

// frame is one parsed SSE frame. A comment frame carries only Comment.
type frame struct {
	ID      string
	Event   string
	Data    string
	Comment string
}

// streamedEvent is the JSON object of a single `data:` line — the contract's
// StreamedEvent.
type streamedEvent struct {
	SchemaVersion string          `json:"schemaVersion"`
	ClientEventID string          `json:"clientEventId"`
	ProjectID     string          `json:"projectId"`
	RunID         string          `json:"runId"`
	AgentID       string          `json:"agentId"`
	ParentAgentID *string         `json:"parentAgentId"`
	OccurredAt    time.Time       `json:"occurredAt"`
	Type          string          `json:"type"`
	Payload       json.RawMessage `json:"payload"`
	Position      int64           `json:"position"`
	ServerEventID string          `json:"serverEventId"`
	ReceivedAt    time.Time       `json:"receivedAt"`
}

// streamClient is one open SSE connection with a background frame parser.
type streamClient struct {
	t      *testing.T
	cancel context.CancelFunc
	body   io.ReadCloser
	frames chan frame
	header http.Header
}

// connect opens the stream and consumes the opening keepalive comment.
//
// Returning only after that comment matters: the handler writes it once the
// subscription is registered, so a test that commits afterwards knows the
// connection cannot miss the event.
func (h *harness) connect(path string, header http.Header) *streamClient {
	h.t.Helper()
	return h.connectTo(h.cur.server.URL, path, header)
}

// connectTo is connect against an explicitly named instance.
func (h *harness) connectTo(baseURL, path string, header http.Header) *streamClient {
	h.t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		cancel()
		h.t.Fatalf("building the stream request: %v", err)
	}
	request.Header.Set("Accept", "text/event-stream")
	for name, values := range header {
		for _, value := range values {
			request.Header.Add(name, value)
		}
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		cancel()
		h.t.Fatalf("GET %s: %v", path, err)
	}
	if response.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(response.Body)
		response.Body.Close()
		cancel()
		h.t.Fatalf("GET %s: want 200, got %d: %s", path, response.StatusCode, raw)
	}

	client := &streamClient{
		t:      h.t,
		cancel: cancel,
		body:   response.Body,
		frames: make(chan frame, 8192),
		header: response.Header,
	}
	go client.parse()
	h.t.Cleanup(client.close)

	if opening := client.next(); opening.Comment != "keepalive" {
		h.t.Fatalf("GET %s: want an opening keepalive comment, got %+v", path, opening)
	}
	return client
}

// parse turns the byte stream into frames until the connection ends.
func (c *streamClient) parse() {
	defer close(c.frames)

	reader := bufio.NewReader(c.body)
	var current frame
	for {
		line, err := reader.ReadString('\n')
		if line != "" {
			line = strings.TrimRight(line, "\r\n")
			switch {
			case line == "":
				if current != (frame{}) {
					c.frames <- current
					current = frame{}
				}
			case strings.HasPrefix(line, ":"):
				current.Comment = strings.TrimSpace(line[1:])
			default:
				name, value, _ := strings.Cut(line, ":")
				value = strings.TrimPrefix(value, " ")
				switch name {
				case "id":
					current.ID = value
				case "event":
					current.Event = value
				case "data":
					current.Data = value
				}
			}
		}
		if err != nil {
			return
		}
	}
}

// next returns the next frame or fails the test on timeout.
func (c *streamClient) next() frame {
	c.t.Helper()
	select {
	case f, ok := <-c.frames:
		if !ok {
			c.t.Fatalf("the stream closed while a frame was expected")
		}
		return f
	case <-time.After(frameTimeout):
		c.t.Fatalf("no frame within %s", frameTimeout)
		return frame{}
	}
}

// nextEvent returns the next frame that carries an event, skipping keepalives,
// together with its decoded payload.
func (c *streamClient) nextEvent() (frame, streamedEvent) {
	c.t.Helper()
	for {
		f := c.next()
		if f.Data == "" {
			continue
		}
		return f, decodeEvent(c.t, f)
	}
}

// collectUntil reads events until the one at position through arrived and
// returns every event frame in the order it was received.
func (c *streamClient) collectUntil(through int64) []streamedEvent {
	c.t.Helper()

	events := make([]streamedEvent, 0, 64)
	for {
		f, event := c.nextEvent()
		if f.ID != strconv.FormatInt(event.Position, 10) {
			c.t.Fatalf("frame id %q does not carry the project position %d", f.ID, event.Position)
		}
		events = append(events, event)
		if event.Position >= through {
			return events
		}
	}
}

// drainFor collects every frame that arrives within d.
func (c *streamClient) drainFor(d time.Duration) []frame {
	c.t.Helper()

	deadline := time.After(d)
	frames := make([]frame, 0, 16)
	for {
		select {
		case f, ok := <-c.frames:
			if !ok {
				return frames
			}
			frames = append(frames, f)
		case <-deadline:
			return frames
		}
	}
}

// assertQuiet insists that nothing but keepalives follows.
//
// It is what turns "received everything" into "received exactly that": a
// duplicate produced at the replay-to-live boundary arrives *after* the last
// expected position, so an assertion that stops at that position would never
// see it.
func (c *streamClient) assertQuiet(d time.Duration) {
	c.t.Helper()
	for _, f := range c.drainFor(d) {
		if f.Data != "" {
			c.t.Fatalf("the stream continued past the last expected position with %+v", f)
		}
	}
}

// close hangs up. It is idempotent so a test may call it explicitly and the
// cleanup may call it again.
func (c *streamClient) close() {
	c.cancel()
	c.body.Close()
}

func decodeEvent(t *testing.T, f frame) streamedEvent {
	t.Helper()
	if strings.ContainsAny(f.Data, "\n\r") {
		t.Fatalf("a data line must be a single line, got %q", f.Data)
	}
	var event streamedEvent
	if err := json.Unmarshal([]byte(f.Data), &event); err != nil {
		t.Fatalf("decoding a data line: %v: %s", err, f.Data)
	}
	return event
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

// assertExactlyOnceInOrder is the acceptance criterion of the issue: every
// position from first to last, each exactly once, strictly ascending.
func assertExactlyOnceInOrder(t *testing.T, events []streamedEvent, first, last int64) {
	t.Helper()

	want := last - first + 1
	if int64(len(events)) != want {
		t.Fatalf("want %d events for positions %d..%d, got %d (%v)",
			want, first, last, len(events), positions(events))
	}
	for i, event := range events {
		if expected := first + int64(i); event.Position != expected {
			t.Fatalf("position %d of the stream is %d, want %d (%v)",
				i, event.Position, expected, positions(events))
		}
	}
}

// assertPayload compares a streamed payload with the reported document. JSON
// object key order is insignificant, so the comparison is on the decoded value.
func assertPayload(t *testing.T, raw json.RawMessage, want map[string]any) {
	t.Helper()

	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("decoding the streamed payload: %v: %s", err, raw)
	}
	if len(got) != len(want) {
		t.Fatalf("streamed payload is %s, want %v", raw, want)
	}
	for key, value := range want {
		if got[key] != value {
			t.Fatalf("streamed payload %s carries %q = %v, want %v", raw, key, got[key], value)
		}
	}
}

func positions(events []streamedEvent) []int64 {
	out := make([]int64, 0, len(events))
	for _, event := range events {
		out = append(out, event.Position)
	}
	return out
}

// eventually polls condition until it holds or the deadline passes.
func eventually(t *testing.T, what string, timeout time.Duration, condition func() bool) {
	t.Helper()

	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("%s did not happen within %s", what, timeout)
}

// getProblem performs one plain request and decodes the RFC 9457 document.
func (h *harness) getProblem(path string, wantStatus int) map[string]any {
	h.t.Helper()

	response, err := http.Get(h.cur.server.URL + path)
	if err != nil {
		h.t.Fatalf("GET %s: %v", path, err)
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(response.Body)
	if err != nil {
		h.t.Fatalf("reading %s: %v", path, err)
	}
	if response.StatusCode != wantStatus {
		h.t.Fatalf("GET %s: want %d, got %d: %s", path, wantStatus, response.StatusCode, raw)
	}
	if contentType := response.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/problem+json") {
		h.t.Fatalf("GET %s: want an RFC 9457 media type, got %q", path, contentType)
	}

	var problem map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(raw), &problem); err != nil {
		h.t.Fatalf("decoding the problem of %s: %v: %s", path, err, raw)
	}
	return problem
}
