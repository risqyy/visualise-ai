package sse

import (
	"context"
	"encoding/json"
	"errors"
	"math"

	"gorm.io/gorm"

	"github.com/risqyy/visualise-ai/backend/internal/ingest"
	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// DefaultReplayPageSize is how many events one replay round trip loads.
//
// Replay must never materialise a whole project log in memory, so it pages.
// 200 rows keeps a page comfortably below a megabyte for ordinary payloads
// while still amortising the round trip over a useful number of events.
const DefaultReplayPageSize = 200

// noUpperBound reads a page up to the current end of the log.
const noUpperBound = int64(math.MaxInt64)

// EventReader reads committed events of one project back out of PostgreSQL.
//
// This is what makes the stream survive a backend restart: the broker is
// process-local and starts empty, but every event it ever published is in the
// log, ordered by the same position the SSE `id:` carries.
type EventReader struct {
	db *gorm.DB
}

// NewEventReader returns a reader over db.
func NewEventReader(db *gorm.DB) *EventReader { return &EventReader{db: db} }

// ProjectPosition returns the current end of a project's log, and whether the
// project exists at all.
//
// Both answers come from the same row on purpose. The stream refuses an unknown
// project rather than opening an endless response that will never carry
// anything, so a stale deep link is visible instead of silently idle; and it
// needs the current end to keep a client from resuming beyond it.
func (r *EventReader) ProjectPosition(ctx context.Context, projectID string) (int64, bool, error) {
	var project store.Project
	err := r.db.WithContext(ctx).
		Where("project_id = ?", projectID).
		Take(&project).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return 0, false, nil
	case err != nil:
		return 0, false, err
	default:
		return project.LastPosition, true, nil
	}
}

// Page loads at most limit committed events of one project with a position
// strictly greater than after and at most through, ordered by position.
//
// The rows are mapped onto ingest.CommittedEvent — the very type the broker
// hands out — so replayed and live events are one kind of value and the wire
// format has exactly one implementation.
func (r *EventReader) Page(
	ctx context.Context,
	projectID string,
	after, through int64,
	limit int,
) ([]ingest.CommittedEvent, error) {
	var rows []store.Event
	err := r.db.WithContext(ctx).
		Where("project_id = ? AND position > ? AND position <= ?", projectID, after, through).
		Order("position ASC").
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	events := make([]ingest.CommittedEvent, 0, len(rows))
	for _, row := range rows {
		events = append(events, committedEvent(row))
	}
	return events, nil
}

// committedEvent turns a stored row back into the StreamedEvent envelope.
//
// The stored payload is the canonical form the store wrote, which is already
// compact JSON — exactly what a single `data:` line needs.
func committedEvent(row store.Event) ingest.CommittedEvent {
	return ingest.CommittedEvent{
		SchemaVersion: row.SchemaVersion,
		ClientEventID: row.ClientEventID,
		ProjectID:     row.ProjectID,
		RunID:         row.RunID,
		AgentID:       row.AgentID,
		ParentAgentID: row.ParentAgentID,
		OccurredAt:    row.OccurredAt.UTC(),
		Type:          row.Type,
		Payload:       json.RawMessage(row.Payload),
		Position:      row.Position,
		ServerEventID: row.ID,
		ReceivedAt:    row.ReceivedAt.UTC(),
	}
}
