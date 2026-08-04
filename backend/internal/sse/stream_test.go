package sse_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/risqyy/visualise-ai/backend/internal/sse"
	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// streamPath is the endpoint under test.
func streamPath(projectID string) string {
	return "/api/v1/projects/" + projectID + "/stream"
}

// TestLiveEventReachesTheStream covers the plain case: a client connected
// without a cursor sees the next committed event, with the project position as
// the SSE id and the catalogue type as the SSE event.
func TestLiveEventReachesTheStream(t *testing.T) {
	h := newHarness(t)
	run := h.openRun("live-project", "run-1")

	client := h.connect(streamPath("live-project"), nil)

	if got := client.header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("Content-Type is %q, want text/event-stream", got)
	}
	for header, want := range map[string]string{
		"Cache-Control":     "no-cache",
		"Connection":        "keep-alive",
		"X-Accel-Buffering": "no",
	} {
		if got := client.header.Get(header); got != want {
			t.Errorf("%s is %q, want %q", header, got, want)
		}
	}

	position := run.note("Rewriting Total().")

	f, event := client.nextEvent()
	if f.ID != strconv.FormatInt(position, 10) {
		t.Errorf("SSE id is %q, want the project position %d", f.ID, position)
	}
	if f.ID == event.ServerEventID {
		t.Errorf("SSE id carries the event uuid instead of the project position")
	}
	if f.Event != store.TypeAgentStatusReported {
		t.Errorf("SSE event is %q, want %q", f.Event, store.TypeAgentStatusReported)
	}
	if event.Position != position {
		t.Errorf("streamed position is %d, want %d", event.Position, position)
	}
	if event.ProjectID != "live-project" || event.RunID != "run-1" {
		t.Errorf("streamed envelope is scoped to %s/%s, want live-project/run-1", event.ProjectID, event.RunID)
	}
	if event.SchemaVersion != "1.0" || event.ServerEventID == "" || event.ClientEventID == "" {
		t.Errorf("streamed envelope is incomplete: %+v", event)
	}
	if event.ReceivedAt.IsZero() || event.OccurredAt.IsZero() {
		t.Errorf("streamed envelope carries no timestamps: %+v", event)
	}
	assertPayload(t, event.Payload, map[string]any{"status": "working", "note": "Rewriting Total()."})

	// A live frame and the same event replayed from the log must be
	// byte-identical, not merely equivalent. Both publish the canonical form
	// the store wrote, so a client may deduplicate or hash frames without
	// having to normalise object key order first.
	replayed := h.connect(streamPath("live-project")+"?lastEventPosition="+strconv.FormatInt(position-1, 10), nil)
	_, fromLog := replayed.nextEvent()
	assertPayload(t, fromLog.Payload, map[string]any{"status": "working", "note": "Rewriting Total()."})

	if !bytes.Equal(event.Payload, fromLog.Payload) {
		t.Errorf("live and replayed payloads differ byte for byte:\n  live:     %s\n  replayed: %s",
			event.Payload, fromLog.Payload)
	}
}

// TestReplayDeliversTheMissingPositions is the reconnect case of the contract:
// ten committed events, a client resuming at position 3, exactly 4..10.
func TestReplayDeliversTheMissingPositions(t *testing.T) {
	h := newHarness(t)
	run := h.openRun("replay-project", "run-1")
	for i := 2; i <= 10; i++ {
		run.note(fmt.Sprintf("step %d", i))
	}

	header := http.Header{"Last-Event-ID": []string{"3"}}
	client := h.connect(streamPath("replay-project"), header)

	events := client.collectUntil(10)
	assertExactlyOnceInOrder(t, events, 4, 10)

	// Nothing beyond the replayed range may follow on an idle project.
	for _, f := range client.drainFor(3 * keepaliveInterval) {
		if f.Data != "" {
			t.Fatalf("the stream continued past position 10 with %+v", f)
		}
	}
}

// TestLastEventPositionIsEquivalentAndWins covers the second cursor form and
// the documented precedence between the two.
func TestLastEventPositionIsEquivalentAndWins(t *testing.T) {
	h := newHarness(t)
	run := h.openRun("cursor-project", "run-1")
	for i := 2; i <= 10; i++ {
		run.note(fmt.Sprintf("step %d", i))
	}

	t.Run("query parameter alone", func(t *testing.T) {
		client := h.connect(streamPath("cursor-project")+"?lastEventPosition=3", nil)
		assertExactlyOnceInOrder(t, client.collectUntil(10), 4, 10)
	})

	t.Run("query parameter wins over the header", func(t *testing.T) {
		header := http.Header{"Last-Event-ID": []string{"8"}}
		client := h.connect(streamPath("cursor-project")+"?lastEventPosition=3", header)
		assertExactlyOnceInOrder(t, client.collectUntil(10), 4, 10)
	})

	t.Run("zero replays the whole project", func(t *testing.T) {
		client := h.connect(streamPath("cursor-project")+"?lastEventPosition=0", nil)
		assertExactlyOnceInOrder(t, client.collectUntil(10), 1, 10)
	})

	t.Run("neither replays nothing", func(t *testing.T) {
		client := h.connect(streamPath("cursor-project"), nil)
		for _, f := range client.drainFor(3 * keepaliveInterval) {
			if f.Data != "" {
				t.Fatalf("a stream without a cursor replayed %+v", f)
			}
		}
	})

	t.Run("an unusable position is rejected", func(t *testing.T) {
		problem := h.getProblem(streamPath("cursor-project")+"?lastEventPosition=-1", http.StatusBadRequest)
		if problem["code"] != "invalid_query_parameter" {
			t.Fatalf("problem code is %v, want invalid_query_parameter", problem["code"])
		}
	})

	t.Run("a position beyond the log starts at the current end", func(t *testing.T) {
		client := h.connect(streamPath("cursor-project")+"?lastEventPosition=9999", nil)
		client.assertQuiet(2 * keepaliveInterval)

		// The stream is not silenced by the impossible cursor: the next event
		// still arrives.
		last := run.note("after an impossible cursor")
		_, event := client.nextEvent()
		if event.Position != last {
			t.Fatalf("received position %d after an impossible cursor, want %d", event.Position, last)
		}
	})

	t.Run("an unusable Last-Event-ID is ignored", func(t *testing.T) {
		header := http.Header{"Last-Event-ID": []string{"not-a-position"}}
		client := h.connect(streamPath("cursor-project"), header)
		for _, f := range client.drainFor(3 * keepaliveInterval) {
			if f.Data != "" {
				t.Fatalf("a stream with an unusable header replayed %+v", f)
			}
		}
	})
}

// TestReplayToLiveTransitionHasNoGapAndNoDuplicate is the core of the issue.
//
// A writer keeps committing into the project while a client is replaying it, so
// new positions are assigned exactly in the window between "the log was read"
// and "the live tail took over". Each iteration flips the order in which the
// two start, so the commits land before, during and after the replay.
//
// The replay page size is 3, so replaying twelve positions already takes five
// round trips — the window is wide, not theoretical.
//
// The assertion is absolute: every position from the resume point to the last
// committed one, exactly once, strictly ascending. A handler that reads the
// database before subscribing loses events here and the collection times out;
// one that replays its buffer unfiltered delivers the overlap twice and the
// ordering assertion fails.
func TestReplayToLiveTransitionHasNoGapAndNoDuplicate(t *testing.T) {
	const (
		iterations = 12
		seeded     = 24
		concurrent = 24
	)

	h := newHarness(t)

	for iteration := 0; iteration < iterations; iteration++ {
		projectID := fmt.Sprintf("race-project-%02d", iteration)
		run := h.openRun(projectID, "run-1")
		for i := 2; i <= seeded; i++ {
			run.note(fmt.Sprintf("seeded %d", i))
		}

		// Resume from the middle of the seeded range, so the connection has to
		// replay, catch up and switch to live while the writer is running.
		resume := int64(seeded / 2)
		path := streamPath(projectID) + "?lastEventPosition=" + strconv.FormatInt(resume, 10)

		var (
			wg   sync.WaitGroup
			last int64
		)
		write := func() {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := 0; i < concurrent; i++ {
					last = run.note(fmt.Sprintf("concurrent %d", i))
				}
			}()
		}

		var client *streamClient
		if iteration%2 == 0 {
			// The writer is already running when the connection opens.
			write()
			client = h.connect(path, nil)
		} else {
			// The connection is established and about to replay when the first
			// commit lands.
			client = h.connect(path, nil)
			write()
		}
		wg.Wait()

		assertExactlyOnceInOrder(t, client.collectUntil(last), resume+1, last)
		client.assertQuiet(2 * keepaliveInterval)
		client.close()
	}
}

// TestSingleCommitDuringReplayIsNotLost isolates the one failure the transition
// can produce that nothing repairs afterwards: an event committed inside the
// window, with no further event behind it to expose the gap.
//
// A long history keeps the replay busy for a measurable time, and exactly one
// event is committed while it runs. A handler that reads the log first and
// subscribes afterwards drops that event and never learns of it, so this test
// times out; the implementation subscribes first and ends the replay only when
// the log *and* the subscription buffer are exhausted.
func TestSingleCommitDuringReplayIsNotLost(t *testing.T) {
	const (
		iterations = 4
		history    = 400
	)

	h := newHarness(t)

	for iteration := 0; iteration < iterations; iteration++ {
		projectID := fmt.Sprintf("window-project-%02d", iteration)
		run := h.openRun(projectID, "run-1")
		seeded := run.seedHistory(history)

		client := h.connect(streamPath(projectID)+"?lastEventPosition=0", nil)
		// The replay is running by now: it has to page through the history three
		// events at a time.
		last := run.note("committed while the replay is running")
		if last != seeded+1 {
			t.Fatalf("the concurrent commit took position %d, want %d", last, seeded+1)
		}

		assertExactlyOnceInOrder(t, client.collectUntil(last), 1, last)
		client.assertQuiet(2 * keepaliveInterval)
		client.close()
	}
}

// TestSeveralSubscribersSeeTheSame covers two browsers watching one project.
func TestSeveralSubscribersSeeTheSame(t *testing.T) {
	h := newHarness(t)
	run := h.openRun("shared-project", "run-1")

	first := h.connect(streamPath("shared-project")+"?lastEventPosition=0", nil)
	second := h.connect(streamPath("shared-project")+"?lastEventPosition=0", nil)
	third := h.connect(streamPath("shared-project"), nil)

	if got := h.broker().SubscriberCount("shared-project"); got != 3 {
		t.Fatalf("broker holds %d subscribers, want 3", got)
	}

	last := run.note("after both connected")

	assertExactlyOnceInOrder(t, first.collectUntil(last), 1, last)
	assertExactlyOnceInOrder(t, second.collectUntil(last), 1, last)
	assertExactlyOnceInOrder(t, third.collectUntil(last), last, last)
}

// TestProjectsAreIsolated proves a subscriber never sees another project.
func TestProjectsAreIsolated(t *testing.T) {
	h := newHarness(t)
	runA := h.openRun("project-a", "run-1")
	runB := h.openRun("project-b", "run-1")

	client := h.connect(streamPath("project-a"), nil)

	runB.note("only for b")
	runB.note("also only for b")
	positionA := runA.note("for a")

	_, event := client.nextEvent()
	if event.ProjectID != "project-a" || event.Position != positionA {
		t.Fatalf("a subscriber of project-a received %s at position %d", event.ProjectID, event.Position)
	}
	for _, f := range client.drainFor(3 * keepaliveInterval) {
		if f.Data != "" {
			t.Fatalf("a subscriber of project-a received a further frame %+v", f)
		}
	}
}

// TestClientDisconnectUnsubscribes covers the leak: hanging up must remove the
// subscriber, not leave a goroutine holding a channel.
func TestClientDisconnectUnsubscribes(t *testing.T) {
	h := newHarness(t)
	run := h.openRun("hangup-project", "run-1")

	client := h.connect(streamPath("hangup-project"), nil)
	if got := h.broker().SubscriberCount("hangup-project"); got != 1 {
		t.Fatalf("broker holds %d subscribers, want 1", got)
	}

	client.close()

	eventually(t, "the subscriber to be removed", 5*time.Second, func() bool {
		return h.broker().SubscriberCount("hangup-project") == 0
	})
	if got := h.broker().Subscribers(); got != 0 {
		t.Fatalf("broker still holds %d subscribers overall", got)
	}

	// The broker keeps working for everyone else afterwards.
	next := h.connect(streamPath("hangup-project"), nil)
	position := run.note("after the hangup")
	if _, event := next.nextEvent(); event.Position != position {
		t.Fatalf("the reconnected client received position %d, want %d", event.Position, position)
	}
}

// TestKeepaliveCommentIsSent covers the comment line that keeps a proxy from
// closing an idle connection.
func TestKeepaliveCommentIsSent(t *testing.T) {
	h := newHarness(t)
	h.openRun("idle-project", "run-1")

	client := h.connect(streamPath("idle-project"), nil)

	// The opening comment is already consumed by connect, so these are the
	// periodic ones.
	comments := 0
	for _, f := range client.drainFor(5 * keepaliveInterval) {
		if f.Comment == "keepalive" {
			comments++
		}
		if f.ID != "" {
			t.Fatalf("a keepalive frame carries an id: %+v", f)
		}
	}
	if comments < 2 {
		t.Fatalf("saw %d keepalive comments in %s, want at least 2", comments, 5*keepaliveInterval)
	}
}

// TestUnknownProjectIsRejected covers the 404 of the contract.
func TestUnknownProjectIsRejected(t *testing.T) {
	h := newHarness(t)
	h.openRun("known-project", "run-1")

	problem := h.getProblem(streamPath("unknown-project"), http.StatusNotFound)
	if problem["code"] != "project_not_found" {
		t.Fatalf("problem code is %v, want project_not_found", problem["code"])
	}
	if problem["type"] != "https://visualise-ai.local/problems/project-not-found" {
		t.Fatalf("problem type is %v", problem["type"])
	}
}

// TestRejectedEventIsNeverPublished covers the acceptance criterion that only
// committed events reach a browser.
//
// Every rejection path of the ingestion endpoint is exercised through HTTP —
// an unknown type, a contract violation, a lifecycle violation and an
// idempotent retry — and the stream must show none of them.
func TestRejectedEventIsNeverPublished(t *testing.T) {
	h := newHarness(t)
	run := h.openRun("rejection-project", "run-1")

	client := h.connect(streamPath("rejection-project"), nil)

	// Outside the closed catalogue.
	if status, body := run.post(run.envelope("agent.teleported", `{}`)); status != http.StatusBadRequest {
		t.Fatalf("an unknown event type produced %d: %s", status, body)
	}
	// Contract violation: progress outside the documented range.
	if status, body := run.post(run.envelope(store.TypeAgentProgressReported,
		`{"percent": 140, "scope": "own_task", "basis": "reported_estimate"}`)); status != http.StatusBadRequest {
		t.Fatalf("an out-of-range payload produced %d: %s", status, body)
	}
	// Lifecycle violation: an agent that never reported agent.started.
	stranger := &runContext{h: h, projectID: "rejection-project", runID: "run-1", agentID: "ghost-agent"}
	if status, body := stranger.post(stranger.envelope(store.TypeAgentStatusReported,
		`{"status": "working"}`)); status != http.StatusUnprocessableEntity {
		t.Fatalf("an unknown agent produced %d: %s", status, body)
	}
	// A run that was already opened.
	if status, body := run.post(run.envelope(store.TypeAgentStarted, `{
		"role": "orchestrator",
		"displayName": "Second root",
		"assignedTask": "Open the run twice"
	}`)); status != http.StatusUnprocessableEntity {
		t.Fatalf("a second root agent produced %d: %s", status, body)
	}
	// An idempotent retry repeats a position that was published once already.
	retry := run.envelope(store.TypeAgentStatusReported, `{"status": "working", "note": "retried"}`)
	if status, body := run.post(retry); status != http.StatusCreated {
		t.Fatalf("the first send of the retried event produced %d: %s", status, body)
	}
	if status, body := run.post(retry); status != http.StatusOK {
		t.Fatalf("the repeated send produced %d: %s", status, body)
	}

	position := run.note("the only other committed event")

	events := client.collectUntil(position)
	assertExactlyOnceInOrder(t, events, position-1, position)
	if events[0].Type != store.TypeAgentStatusReported {
		t.Fatalf("the retried event was streamed as %q", events[0].Type)
	}
}

// TestShutdownClosesOpenStreams covers the graceful stop of the process.
//
// An SSE connection never goes idle — it keeps writing keepalives — so
// http.Server.Shutdown alone waits for the full timeout. The negative control
// is part of the test: shutting the server down while the broker still serves
// its subscribers must time out, and shutting the broker down first must let
// the same call return immediately. That is exactly the order main.go uses.
func TestShutdownClosesOpenStreams(t *testing.T) {
	h := newHarness(t)
	h.openRun("shutdown-project", "run-1")

	broker := sse.NewBroker(sse.BrokerOptions{Logger: zerolog.Nop()})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listening: %v", err)
	}
	server := &http.Server{Handler: h.router(broker), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })

	client := h.connectTo("http://"+listener.Addr().String(), streamPath("shutdown-project"), nil)
	defer client.close()

	blocked, cancelBlocked := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancelBlocked()
	if err := server.Shutdown(blocked); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Shutdown returned %v while a stream was still served, want a timeout", err)
	}

	broker.Shutdown()

	released, cancelReleased := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelReleased()
	start := time.Now()
	if err := server.Shutdown(released); err != nil {
		t.Fatalf("Shutdown after the broker stopped: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("Shutdown took %s after the broker stopped, want it to return at once", elapsed)
	}
	if got := broker.Subscribers(); got != 0 {
		t.Fatalf("the stopped broker still holds %d subscribers", got)
	}
}

// TestBackendRestartReplaysFromPostgres covers the acceptance criterion that a
// restart loses nothing: the new instance starts with an empty broker and the
// missing events come out of the log.
func TestBackendRestartReplaysFromPostgres(t *testing.T) {
	h := newHarness(t)
	run := h.openRun("restart-project", "run-1")
	for i := 2; i <= 8; i++ {
		run.note(fmt.Sprintf("before the restart %d", i))
	}

	client := h.connect(streamPath("restart-project")+"?lastEventPosition=0", nil)
	assertExactlyOnceInOrder(t, client.collectUntil(8), 1, 8)

	h.restart()

	if got := h.broker().Subscribers(); got != 0 {
		t.Fatalf("the restarted broker already holds %d subscribers", got)
	}
	last := run.note("after the restart")

	resumed := h.connect(streamPath("restart-project")+"?lastEventPosition=4", nil)
	assertExactlyOnceInOrder(t, resumed.collectUntil(last), 5, last)
}
