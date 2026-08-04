// Package sse serves the project event stream of the cockpit: gap-free replay
// out of PostgreSQL followed seamlessly by the live tail.
//
// The package owns three collaborating pieces:
//
//   - Broker — the in-process fan-out. It implements ingest.Publisher and is
//     therefore called once per committed event, after the append transaction
//     and never before.
//   - EventReader — the paged read-back of the log, which is what makes a
//     reconnect after a backend restart possible at all.
//   - Handler — one goroutine per connection that combines the two into a
//     single, strictly increasing, duplicate-free position sequence.
//
// The stream is deliberately single-instance. v0 runs exactly one backend
// (see ADR 0001), so a process-local broker is the whole realtime layer: no
// message broker, no Redis, no cross-instance fan-out. Durability is not the
// broker's job either — every event a subscriber could miss is already in
// PostgreSQL, and the replay path is what recovers it.
package sse

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/rs/zerolog"

	"github.com/risqyy/visualise-ai/backend/internal/ingest"
)

// DefaultSubscriberBuffer is how many committed events one connection may fall
// behind before the broker gives up on it.
//
// The number is a backpressure budget, not a delivery guarantee. Published
// events are semantic work steps, not raw tool calls, so a project produces
// events at a human-readable rate; 256 of them is far more than a connection
// can accumulate while a browser tab is descheduled or a replay page is being
// read. Choosing it much larger would only trade a fast, recoverable
// disconnect for a slowly growing per-connection backlog, and choosing it much
// smaller would drop connections during ordinary bursts.
//
// Overflow is never silent: the subscription is dropped, the connection ends
// and the client reconnects with Last-Event-ID, which replays the gap from
// PostgreSQL. Losing an event is therefore impossible; the cost of a slow
// client is one reconnect, never a stalled broker.
const DefaultSubscriberBuffer = 256

// Broker fans committed events out to the SSE connections of this instance.
//
// It is the single implementation of ingest.Publisher in production, so every
// event it hands out is committed, positioned and durable.
type Broker struct {
	logger zerolog.Logger
	buffer int

	mu       sync.Mutex
	projects map[string]map[*Subscription]struct{}
	shutdown bool
}

// BrokerOptions carries the settings of a Broker.
type BrokerOptions struct {
	// Logger records the connections the broker gives up on.
	Logger zerolog.Logger
	// Buffer is the per subscriber channel capacity. Zero selects
	// DefaultSubscriberBuffer.
	Buffer int
}

// NewBroker returns a Broker ready to accept subscribers.
func NewBroker(opts BrokerOptions) *Broker {
	buffer := opts.Buffer
	if buffer <= 0 {
		buffer = DefaultSubscriberBuffer
	}
	return &Broker{
		logger:   opts.Logger,
		buffer:   buffer,
		projects: make(map[string]map[*Subscription]struct{}),
	}
}

// Subscription is one connection's view of the live tail of a project.
//
// Events arrive on Events(). Closed() reports that the broker will not deliver
// anything else — either because the connection handler unsubscribed, because
// the subscriber fell too far behind, or because the process is shutting down.
type Subscription struct {
	broker    *Broker
	projectID string
	events    chan ingest.CommittedEvent
	closed    chan struct{}
	once      sync.Once
	overflow  atomic.Bool
}

// Events is the live tail. The channel is never closed; use Closed to learn
// that the subscription ended.
func (s *Subscription) Events() <-chan ingest.CommittedEvent { return s.events }

// Closed is closed once the broker stopped serving this subscription.
func (s *Subscription) Closed() <-chan struct{} { return s.closed }

// Overflowed reports whether the subscription ended because the connection did
// not keep up with the buffer.
func (s *Subscription) Overflowed() bool { return s.overflow.Load() }

// Close unsubscribes. It is idempotent, so a handler can defer it even when the
// broker already dropped the subscription.
func (s *Subscription) Close() {
	s.broker.mu.Lock()
	defer s.broker.mu.Unlock()
	s.broker.detachLocked(s)
}

// Subscribe registers a listener for one project.
//
// A subscription registered on an already shut down broker comes back closed,
// so a connection that raced the shutdown terminates instead of hanging.
func (b *Broker) Subscribe(projectID string) *Subscription {
	sub := &Subscription{
		broker:    b,
		projectID: projectID,
		events:    make(chan ingest.CommittedEvent, b.buffer),
		closed:    make(chan struct{}),
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if b.shutdown {
		sub.once.Do(func() { close(sub.closed) })
		return sub
	}
	subscribers, ok := b.projects[projectID]
	if !ok {
		subscribers = make(map[*Subscription]struct{})
		b.projects[projectID] = subscribers
	}
	subscribers[sub] = struct{}{}
	return sub
}

// Publish implements ingest.Publisher.
//
// The ingesting request waits for this call, so it must not block: every send
// is non-blocking, and a subscriber whose buffer is full is dropped rather than
// waited for. One slow browser can therefore never slow down ingestion or any
// other subscriber of the same project.
//
// The context is unused on purpose. Cancelling the ingesting request must not
// cancel the fan-out of an event that is already committed.
func (b *Broker) Publish(_ context.Context, event ingest.CommittedEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()

	for sub := range b.projects[event.ProjectID] {
		select {
		case sub.events <- event:
		default:
			sub.overflow.Store(true)
			b.detachLocked(sub)
			b.logger.Warn().
				Str("projectId", event.ProjectID).
				Int64("position", event.Position).
				Int("buffer", b.buffer).
				Msg("sse subscriber fell behind; dropping the connection so it reconnects and replays")
		}
	}
}

// Shutdown ends every open subscription.
//
// It is what lets http.Server.Shutdown finish: a stream handler blocks on its
// subscription, so the connection only becomes idle once the subscription is
// closed. Calling it before Shutdown turns an otherwise indefinite wait into an
// immediate, orderly close of every stream.
func (b *Broker) Shutdown() {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.shutdown = true
	for _, subscribers := range b.projects {
		for sub := range subscribers {
			b.detachLocked(sub)
		}
	}
}

// SubscriberCount reports how many connections currently listen to a project.
// It is the observable the shutdown log and the leak tests read.
func (b *Broker) SubscriberCount(projectID string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.projects[projectID])
}

// Subscribers reports how many connections are open across every project.
func (b *Broker) Subscribers() int {
	b.mu.Lock()
	defer b.mu.Unlock()

	total := 0
	for _, subscribers := range b.projects {
		total += len(subscribers)
	}
	return total
}

// detachLocked removes a subscription and signals its end. The caller holds the
// mutex. Deleting from the map while Publish ranges over it is safe.
func (b *Broker) detachLocked(sub *Subscription) {
	if subscribers, ok := b.projects[sub.projectID]; ok {
		delete(subscribers, sub)
		if len(subscribers) == 0 {
			delete(b.projects, sub.projectID)
		}
	}
	sub.once.Do(func() { close(sub.closed) })
}
