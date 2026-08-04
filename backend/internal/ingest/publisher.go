package ingest

import (
	"context"
	"encoding/json"
	"time"
)

// CommittedEvent is one accepted event together with the metadata the server
// assigned to it. Its fields are exactly the StreamedEvent envelope of the
// contract, so the SSE endpoint can serialise it without a second mapping.
type CommittedEvent struct {
	SchemaVersion string          `json:"schemaVersion"`
	ClientEventID string          `json:"clientEventId"`
	ProjectID     string          `json:"projectId"`
	RunID         string          `json:"runId"`
	AgentID       string          `json:"agentId"`
	ParentAgentID *string         `json:"parentAgentId,omitempty"`
	OccurredAt    time.Time       `json:"occurredAt"`
	Type          string          `json:"type"`
	Payload       json.RawMessage `json:"payload"`
	Position      int64           `json:"position"`
	ServerEventID string          `json:"serverEventId"`
	ReceivedAt    time.Time       `json:"receivedAt"`
}

// Publisher receives events after they were committed. Never before.
//
// It is called once per newly appended event, outside the append transaction
// and only after it succeeded. An idempotent retry does not call it: the event
// it repeats was published when it was first accepted, and publishing it again
// would deliver the same project position twice to every SSE client.
//
// Implementations must not block: the ingesting request waits for them.
type Publisher interface {
	Publish(ctx context.Context, event CommittedEvent)
}

// NopPublisher discards every event. It is the default until the SSE broker
// replaces it, so ingestion works on its own.
type NopPublisher struct{}

// Publish implements Publisher.
func (NopPublisher) Publish(context.Context, CommittedEvent) {}
