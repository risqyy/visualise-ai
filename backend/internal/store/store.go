// Package store implements the immutable project event log and the normalised
// read models the cockpit renders.
//
// An accepted event is appended once and, in the very same transaction,
// projected onto every read model it touches. The log is append-only: nothing
// ever updates or deletes a stored event, and corrections and retractions are
// new events that reference the original one.
//
// Validating an event against the contract, the lifecycle rules and the HTTP
// status codes are not this package's concern; the ingestion layer owns them.
// The store owns position assignment, idempotency, conflict detection,
// atomicity and the projections.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Envelope is one validated event handed to the store for appending.
type Envelope struct {
	ProjectID     string
	ClientEventID string
	RunID         string
	AgentID       string
	ParentAgentID *string
	Type          string
	SchemaVersion string
	OccurredAt    time.Time
	Payload       json.RawMessage
}

// Result reports how an Append was resolved. Duplicate is true when the event
// had already been accepted under the same clientEventId with identical
// content; the originally assigned position is repeated unchanged.
type Result struct {
	ProjectID     string
	Position      int64
	ServerEventID string
	ClientEventID string
	Duplicate     bool
	ReceivedAt    time.Time
	// Payload is the canonical form that was stored. Publishing this rather
	// than the bytes the agent sent keeps a live SSE frame byte-identical to
	// the same event replayed from the log, which would otherwise differ in
	// object key order.
	Payload json.RawMessage
}

// ErrClientEventIDConflict marks a reused idempotency key whose content differs
// from the stored event. Use errors.As with ClientEventIDConflictError to read
// the position the original event occupies.
var ErrClientEventIDConflict = errors.New("store: client event id reused with different content")

// ClientEventIDConflictError carries the details of a conflicting retry.
type ClientEventIDConflictError struct {
	ProjectID        string
	ClientEventID    string
	ExistingPosition int64
}

// Error implements error.
func (e *ClientEventIDConflictError) Error() string {
	return fmt.Sprintf(
		"store: clientEventId %q was already accepted at position %d for project %q with different content",
		e.ClientEventID, e.ExistingPosition, e.ProjectID,
	)
}

// Unwrap makes errors.Is(err, ErrClientEventIDConflict) succeed.
func (e *ClientEventIDConflictError) Unwrap() error { return ErrClientEventIDConflict }

// Store appends events and keeps the read models in sync.
type Store struct {
	db *gorm.DB
	// apply advances the read models. It is a field so tests can inject a
	// failing projection and observe that the whole append rolls back.
	apply func(tx *gorm.DB, ev *Event) error
	now   func() time.Time
	newID func() string
}

// New returns a Store backed by db.
func New(db *gorm.DB) *Store {
	return &Store{
		db:    db,
		apply: NewProjector().Apply,
		now:   func() time.Time { return time.Now().UTC() },
		newID: uuid.NewString,
	}
}

// Guard is an optional check the caller runs inside the append transaction,
// after idempotency has been resolved and before the event row is created.
//
// It exists so the ingestion layer can enforce rules that depend on the current
// project state — which agents exist, whether a run is still open — without
// racing. Checking those before the transaction would let two concurrent
// requests both observe "the run is open"; inside it the project row is already
// locked, so the checks see a state no other append can move underneath them.
// Returning an error rolls the whole append back, so a rejected event consumes
// no position and changes no projection.
//
// The guard sees only genuinely new events: an idempotent retry is answered
// from the stored event before the guard runs, because an event that was
// accepted once must keep its position even if the project has moved on since.
type Guard func(tx *gorm.DB, env Envelope) error

// Append stores one event and advances every affected read model inside a
// single transaction. Any failure rolls the whole append back, including the
// position, which is therefore never consumed by a rejected event.
//
// Idempotency is resolved on (projectId, clientEventId):
//
//   - unknown key                    -> appended, Duplicate false
//   - known key, identical content   -> nothing written, Duplicate true
//   - known key, different content   -> ClientEventIDConflictError
func (s *Store) Append(ctx context.Context, env Envelope) (Result, error) {
	return s.AppendGuarded(ctx, env, nil)
}

// AppendGuarded is Append with a Guard that runs inside the same transaction.
// A nil guard makes it behave exactly like Append.
func (s *Store) AppendGuarded(ctx context.Context, env Envelope, guard Guard) (Result, error) {
	canonical, err := canonicalJSON(env.Payload)
	if err != nil {
		return Result{}, fmt.Errorf("store: canonicalising payload: %w", err)
	}
	hash := payloadHash(canonical)

	var result Result
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The project row is the serialisation point of the whole append. Every
		// concurrent request for this project queues up here, so reading
		// last_position and writing position + 1 cannot interleave. A plain
		// max(position) + 1 would let two transactions read the same value.
		project, err := lockProject(tx, env.ProjectID, env.OccurredAt)
		if err != nil {
			return err
		}

		existing, err := findByClientEventID(tx, env.ProjectID, env.ClientEventID)
		if err != nil {
			return err
		}
		if existing != nil {
			if existing.PayloadHash == hash &&
				existing.Type == env.Type &&
				existing.SchemaVersion == env.SchemaVersion {
				result = Result{
					ProjectID:     existing.ProjectID,
					Position:      existing.Position,
					ServerEventID: existing.ID,
					ClientEventID: existing.ClientEventID,
					Duplicate:     true,
					ReceivedAt:    existing.ReceivedAt,
					Payload:       json.RawMessage(existing.Payload),
				}
				return nil
			}
			return &ClientEventIDConflictError{
				ProjectID:        env.ProjectID,
				ClientEventID:    env.ClientEventID,
				ExistingPosition: existing.Position,
			}
		}

		if guard != nil {
			if err := guard(tx, env); err != nil {
				return err
			}
		}

		event := &Event{
			ID:            s.newID(),
			ProjectID:     env.ProjectID,
			Position:      project.LastPosition + 1,
			ClientEventID: env.ClientEventID,
			RunID:         env.RunID,
			AgentID:       env.AgentID,
			ParentAgentID: env.ParentAgentID,
			Type:          env.Type,
			SchemaVersion: env.SchemaVersion,
			OccurredAt:    env.OccurredAt.UTC(),
			ReceivedAt:    s.now(),
			// The canonical form is stored rather than the received bytes:
			// jsonb normalises the document anyway, and this keeps the column
			// and the hash describing exactly the same content.
			Payload:     JSON(canonical),
			PayloadHash: hash,
		}
		if err := tx.Create(event).Error; err != nil {
			return err
		}
		if err := s.apply(tx, event); err != nil {
			return err
		}
		if err := linkEventComponents(tx, event); err != nil {
			return err
		}

		result = Result{
			ProjectID:     event.ProjectID,
			Position:      event.Position,
			ServerEventID: event.ID,
			ClientEventID: event.ClientEventID,
			Duplicate:     false,
			ReceivedAt:    event.ReceivedAt,
			Payload:       canonical,
		}
		return nil
	})
	if err != nil {
		return Result{}, err
	}
	return result, nil
}

// lockProject makes sure the project row exists and holds its row lock until
// the transaction ends.
func lockProject(tx *gorm.DB, projectID string, seenAt time.Time) (Project, error) {
	// A brand new project has no row to lock yet. Inserting it first is safe
	// under concurrency: the loser of the race does nothing and then blocks on
	// the winner's row lock below, which is exactly the intended queueing.
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Project{
		ProjectID:   projectID,
		FirstSeenAt: seenAt.UTC(),
		LastEventAt: seenAt.UTC(),
	}).Error; err != nil {
		return Project{}, err
	}

	var project Project
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("project_id = ?", projectID).
		Take(&project).Error; err != nil {
		return Project{}, err
	}
	return project, nil
}

// findByClientEventID returns the stored event for an idempotency key, or nil.
func findByClientEventID(tx *gorm.DB, projectID, clientEventID string) (*Event, error) {
	var event Event
	err := tx.Where("project_id = ? AND client_event_id = ?", projectID, clientEventID).
		Take(&event).Error
	switch {
	case err == nil:
		return &event, nil
	case errors.Is(err, gorm.ErrRecordNotFound):
		return nil, nil
	default:
		return nil, err
	}
}
