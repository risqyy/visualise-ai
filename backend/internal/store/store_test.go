package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Concurrent appends against one project must produce a single, gap-free
// ordering. This is the property the FOR UPDATE lock on the project row buys;
// a max(position) + 1 without a lock would hand the same value to two
// transactions.
func TestAppendAssignsGaplessPositionsUnderConcurrency(t *testing.T) {
	s := newScenario(t)
	s.startRun() // occupies position 1

	const goroutines = 8
	const perGoroutine = 25

	positions := make([][]int64, goroutines)
	failures := make([]error, goroutines)
	start := make(chan struct{})

	var wg sync.WaitGroup
	for g := range goroutines {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			agentID := fmt.Sprintf("subagent-%02d", g)
			<-start

			for i := range perGoroutine {
				env := Envelope{
					ProjectID:     s.projectID,
					ClientEventID: uuid.NewString(),
					RunID:         s.runID,
					AgentID:       agentID,
					ParentAgentID: ptr("orchestrator-root"),
					Type:          TypeAgentStatusReported,
					SchemaVersion: "1.0",
					OccurredAt:    baseTime.Add(time.Duration(g*perGoroutine+i) * time.Millisecond),
					Payload:       json.RawMessage(fmt.Sprintf(`{"status":"working","note":"step %d"}`, i)),
				}
				result, err := s.store.Append(context.Background(), env)
				if err != nil {
					failures[g] = err
					return
				}
				positions[g] = append(positions[g], result.Position)
			}
		}(g)
	}
	close(start)
	wg.Wait()

	for g, err := range failures {
		if err != nil {
			t.Fatalf("goroutine %d failed: %v", g, err)
		}
	}

	all := make([]int64, 0, goroutines*perGoroutine)
	for g := range goroutines {
		// Every single writer must see its own positions strictly increasing.
		for i := 1; i < len(positions[g]); i++ {
			if positions[g][i] <= positions[g][i-1] {
				t.Fatalf("goroutine %d saw a non-monotonic position sequence: %v", g, positions[g])
			}
		}
		all = append(all, positions[g]...)
	}

	sort.Slice(all, func(i, j int) bool { return all[i] < all[j] })
	for i, position := range all {
		want := int64(i + 2) // position 1 belongs to the root agent.started
		if position != want {
			t.Fatalf("position %d of the sorted sequence is %d, want %d (duplicate or gap)", i, position, want)
		}
	}

	total := int64(goroutines*perGoroutine) + 1
	if stored := s.mustCount(&Event{}, "project_id = ?", s.projectID); stored != total {
		t.Errorf("stored events = %d, want %d", stored, total)
	}
	if last := s.project().LastPosition; last != total {
		t.Errorf("projects.last_position = %d, want %d", last, total)
	}
}

// A failing projection must undo the whole append: no event row, no projection
// change and, above all, no consumed position.
func TestAppendRollsBackEventAndProjectionsOnProjectionFailure(t *testing.T) {
	s := newScenario(t)
	s.startRun()

	before := s.project()
	agentBefore := s.agent("orchestrator-root")

	broken := New(s.db)
	sentinel := errors.New("projection blew up")
	broken.apply = func(tx *gorm.DB, ev *Event) error {
		// Write a projection first, so the rollback has to undo more than the
		// event row itself.
		if err := advanceProject(tx, ev); err != nil {
			return err
		}
		return sentinel
	}

	env := s.event("orchestrator-root", nil, TypeAgentStatusReported, `{"status":"blocked","note":"waiting"}`)
	if _, err := broken.Append(context.Background(), env); !errors.Is(err, sentinel) {
		t.Fatalf("Append error = %v, want %v", err, sentinel)
	}

	if stored := s.mustCount(&Event{}, "project_id = ? AND client_event_id = ?", s.projectID, env.ClientEventID); stored != 0 {
		t.Errorf("the rejected event left %d rows in the log", stored)
	}
	after := s.project()
	if after.LastPosition != before.LastPosition || after.LastAppliedProjectPosition != before.LastAppliedProjectPosition {
		t.Errorf("project head moved: %+v -> %+v", before, after)
	}
	if agentAfter := s.agent("orchestrator-root"); agentAfter.Status != agentBefore.Status {
		t.Errorf("agent status changed to %q although the append failed", agentAfter.Status)
	}

	// The position must still be free for the next accepted event.
	next := s.emit("orchestrator-root", nil, TypeAgentStatusReported, `{"status":"working"}`)
	if next.Position != before.LastPosition+1 {
		t.Errorf("next position = %d, want %d — the failed append consumed one", next.Position, before.LastPosition+1)
	}
}

// A retry of an accepted event answers with the original position and writes
// nothing. Key order must not matter, so the retry below reorders the payload.
func TestAppendIsIdempotentForAnIdenticalRetry(t *testing.T) {
	s := newScenario(t)
	s.startRun()

	env := s.event("subagent-reviewer", ptr("orchestrator-root"), TypeAgentProgressReported,
		`{"percent":40,"scope":"own_task","basis":"completed_steps"}`)
	first := s.append(env)
	if first.Duplicate {
		t.Fatal("the first delivery must not be reported as a duplicate")
	}

	retry := env
	retry.OccurredAt = env.OccurredAt.Add(time.Minute) // the agent re-stamped its retry
	retry.Payload = json.RawMessage(`{"basis":"completed_steps","scope":"own_task","percent":40}`)

	second := s.append(retry)
	if !second.Duplicate {
		t.Error("the retry must be reported as a duplicate")
	}
	if second.Position != first.Position {
		t.Errorf("retry position = %d, want the original %d", second.Position, first.Position)
	}
	if second.ServerEventID != first.ServerEventID {
		t.Errorf("retry serverEventId = %q, want the original %q", second.ServerEventID, first.ServerEventID)
	}
	if stored := s.mustCount(&Event{}, "project_id = ? AND client_event_id = ?", s.projectID, env.ClientEventID); stored != 1 {
		t.Errorf("stored events for the idempotency key = %d, want 1", stored)
	}
	if last := s.project().LastPosition; last != first.Position {
		t.Errorf("projects.last_position = %d, want %d — the retry consumed a position", last, first.Position)
	}
}

// Reusing an idempotency key for different content is a conflict, and the
// caller must be able to report the position the original event occupies.
func TestAppendRejectsAReusedClientEventIDWithDifferentContent(t *testing.T) {
	s := newScenario(t)
	s.startRun()

	env := s.event("subagent-reviewer", ptr("orchestrator-root"), TypeAgentProgressReported,
		`{"percent":40,"scope":"own_task","basis":"completed_steps"}`)
	first := s.append(env)

	diverging := env
	diverging.Payload = json.RawMessage(`{"percent":80,"scope":"own_task","basis":"completed_steps"}`)

	_, err := s.store.Append(context.Background(), diverging)
	if !errors.Is(err, ErrClientEventIDConflict) {
		t.Fatalf("Append error = %v, want a client event id conflict", err)
	}

	var conflict *ClientEventIDConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("error %v does not carry the conflict details", err)
	}
	if conflict.ExistingPosition != first.Position {
		t.Errorf("conflict position = %d, want %d", conflict.ExistingPosition, first.Position)
	}
	if conflict.ClientEventID != env.ClientEventID || conflict.ProjectID != s.projectID {
		t.Errorf("conflict identifies %q/%q, want %q/%q",
			conflict.ProjectID, conflict.ClientEventID, s.projectID, env.ClientEventID)
	}

	if stored := s.mustCount(&Event{}, "project_id = ?", s.projectID); stored != 2 {
		t.Errorf("stored events = %d, want 2 — the conflict must not append", stored)
	}
}

// A change of type or schema version under the same key is a conflict too: the
// hash alone does not identify an event.
func TestAppendRejectsAReusedClientEventIDWithADifferentType(t *testing.T) {
	s := newScenario(t)
	s.startRun()

	env := s.event("orchestrator-root", nil, TypeAgentStatusReported, `{"status":"working"}`)
	s.append(env)

	diverging := env
	diverging.Type = TypeAgentFinished
	diverging.Payload = json.RawMessage(`{"status":"working"}`)

	if _, err := s.store.Append(context.Background(), diverging); !errors.Is(err, ErrClientEventIDConflict) {
		t.Fatalf("Append error = %v, want a client event id conflict", err)
	}
}

// The log is append-only. Nothing in the backend may rewrite a stored event.
func TestEventRowsRejectUpdatesAndDeletes(t *testing.T) {
	s := newScenario(t)
	result := s.startRun()

	err := s.db.Model(&Event{}).
		Where("project_id = ? AND position = ?", s.projectID, result.Position).
		Update("payload_hash", "tampered").Error
	if !errors.Is(err, ErrEventLogImmutable) {
		t.Errorf("updating an event returned %v, want %v", err, ErrEventLogImmutable)
	}

	err = s.db.Where("project_id = ? AND position = ?", s.projectID, result.Position).Delete(&Event{}).Error
	if !errors.Is(err, ErrEventLogImmutable) {
		t.Errorf("deleting an event returned %v, want %v", err, ErrEventLogImmutable)
	}
}
