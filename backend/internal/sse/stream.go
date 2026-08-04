package sse

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
)

// Path is the stream route, relative to the versioned API prefix.
//
// The wildcard must be named `:projectId`, exactly as the read models name it.
// Gin keeps one wildcard name per position in its routing tree, so registering
// `/projects/:id/stream` next to `/projects/:projectId/architecture` panics at
// startup rather than at request time.
const Path = "/projects/:projectId/stream"

// lastEventPositionQuery and lastEventIDHeader are the two ways a client states
// where it left off.
const (
	lastEventPositionQuery = "lastEventPosition"
	lastEventIDHeader      = "Last-Event-ID"
)

// DefaultKeepaliveInterval is how often an idle stream emits a comment line.
//
// It is well below the read timeout of any ordinary proxy — the Nginx frontend
// of this deployment allows 24 h — so an idle cockpit keeps its connection
// without producing noticeable traffic.
const DefaultKeepaliveInterval = 15 * time.Second

// The two ways the broker, rather than the client, ends a stream.
var (
	// errSubscriptionEnded is the orderly case: the process is shutting down.
	errSubscriptionEnded = errors.New("sse: subscription ended")
	// errSubscriberTooSlow is the backpressure case. The client reconnects with
	// its cursor and replays the gap, so no event is lost — but it is worth a
	// line in the log next to the position the connection had reached.
	errSubscriberTooSlow = errors.New("sse: subscriber did not keep up with the buffer")
)

// endReason names why the broker stopped serving a subscription.
func endReason(sub *Subscription) error {
	if sub.Overflowed() {
		return errSubscriberTooSlow
	}
	return errSubscriptionEnded
}

// HandlerOptions carries the collaborators of the stream handler.
type HandlerOptions struct {
	// Broker is the live fan-out. Required.
	Broker *Broker
	// Reader loads replayed events from PostgreSQL. Required.
	Reader *EventReader
	// KeepaliveInterval is the idle comment interval. Zero selects
	// DefaultKeepaliveInterval.
	KeepaliveInterval time.Duration
	// ReplayPageSize bounds one replay round trip. Zero selects
	// DefaultReplayPageSize.
	ReplayPageSize int
	// Logger records what a client cannot be told once the stream is open.
	Logger zerolog.Logger
}

// Handler serves GET /api/v1/projects/{projectId}/stream.
type Handler struct {
	broker    *Broker
	reader    *EventReader
	keepalive time.Duration
	pageSize  int
	logger    zerolog.Logger
}

// NewHandler returns the stream handler.
func NewHandler(opts HandlerOptions) *Handler {
	keepalive := opts.KeepaliveInterval
	if keepalive <= 0 {
		keepalive = DefaultKeepaliveInterval
	}
	pageSize := opts.ReplayPageSize
	if pageSize <= 0 {
		pageSize = DefaultReplayPageSize
	}
	return &Handler{
		broker:    opts.Broker,
		reader:    opts.Reader,
		keepalive: keepalive,
		pageSize:  pageSize,
		logger:    opts.Logger,
	}
}

// Stream serves one Server-Sent Events connection.
//
// The order of the steps below is the whole correctness argument of this
// package, so it is worth stating explicitly:
//
//  1. Resolve the start position and reject an unknown project — both while a
//     status code can still be reported.
//  2. Subscribe to the broker *before* the first database read. From this
//     moment nothing that commits can be missed: it either shows up in a replay
//     page or in the subscription.
//  3. Replay from PostgreSQL until the log is exhausted *and* the subscription
//     buffer is empty (see replay).
//  4. Serve the live tail, filtering every event against lastSent.
//
// The naive alternatives both fail: reading the database first and subscribing
// afterwards loses everything that commits in between, and subscribing first
// while replaying the buffer as-is delivers the overlap twice.
func (h *Handler) Stream(c *gin.Context) {
	projectID := c.Param("projectId")

	start, ok := h.startPosition(c)
	if !ok {
		return
	}

	ctx := c.Request.Context()

	head, exists, err := h.reader.ProjectPosition(ctx, projectID)
	if err != nil {
		h.logger.Error().Err(err).Str("projectId", projectID).Msg("resolving the streamed project failed")
		writeProblem(c, http.StatusInternalServerError, CodeInternalError,
			"Internal Server Error", "The event stream could not be opened.")
		return
	}
	if !exists {
		writeProblem(c, http.StatusNotFound, CodeProjectNotFound, "Project not found",
			"No project with id "+quoted(projectID)+" exists.")
		return
	}
	if start > head {
		// A cursor beyond the end of the log — a stale client after the database
		// was reset, say. Resuming from it verbatim would filter away every
		// event until the project caught up again, which looks like a working
		// but permanently silent stream. Starting at the current end is the
		// honest interpretation of "everything you have not seen".
		h.logger.Info().
			Str("projectId", projectID).
			Int64("requested", start).
			Int64("projectPosition", head).
			Msg("sse client resumed beyond the end of the log")
		start = head
	}

	// Subscribing before the first read is what closes the replay-to-live gap.
	// Everything the publisher hands out from here on is either already in the
	// pages below or waiting in this subscription.
	sub := h.broker.Subscribe(projectID)
	defer sub.Close()

	conn := newConnection(c, start)
	// The opening comment confirms the stream is established, and it is written
	// after the subscription exists, so a client that waits for it cannot miss a
	// live event it should have seen.
	if err := conn.keepalive(); err != nil {
		return
	}

	if start != liveOnly {
		if err := h.replay(ctx, conn, sub, projectID); err != nil {
			h.finish(projectID, conn, err)
			return
		}
	}
	h.finish(projectID, conn, h.live(ctx, conn, sub, projectID))
}

// replay writes every committed event after conn.lastSent, page by page.
//
// The loop ends only when both conditions hold at once: the last page was
// short, so the log is exhausted, and the subscription buffer is empty, so
// nothing committed while the page was being read. Either condition alone would
// leave a window in which an event is neither in a page nor picked up by the
// live loop.
//
// Buffered live events are drained and *discarded* rather than written here.
// That is safe precisely because the publisher is called after the commit: an
// event the broker handed out is durable and will be found by the next page.
// Discarding them also keeps a long replay from overflowing the buffer, which
// would otherwise drop a connection that is not slow at all — only far behind.
func (h *Handler) replay(ctx context.Context, conn *connection, sub *Subscription, projectID string) error {
	for {
		page, err := h.reader.Page(ctx, projectID, conn.lastSent, noUpperBound, h.pageSize)
		if err != nil {
			return err
		}
		for _, event := range page {
			if err := conn.send(event); err != nil {
				return err
			}
		}

		pending := drain(sub, conn.lastSent)
		if len(page) < h.pageSize && pending == 0 {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-sub.Closed():
			return endReason(sub)
		default:
		}
	}
}

// live serves the tail of the stream once the replay caught up.
//
// Two filters keep the promise of "every position exactly once, in order":
// an event at or below lastSent was already written and is dropped, and an
// event above lastSent+1 means something is missing, which is filled from
// PostgreSQL before the event itself goes out.
//
// The gap is real, not theoretical. Positions are assigned under the project
// row lock, but Publish is called by the ingesting goroutine after its
// transaction committed, so two appends can reach the broker in the opposite
// order. Whatever arrives first, the log has both, and the fill below restores
// the order the client is promised.
func (h *Handler) live(ctx context.Context, conn *connection, sub *Subscription, projectID string) error {
	ticker := time.NewTicker(h.keepalive)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			// The client hung up. The deferred Close unsubscribes, so neither a
			// goroutine nor a channel outlives the connection.
			return ctx.Err()

		case <-sub.Closed():
			return endReason(sub)

		case event := <-sub.Events():
			if conn.lastSent != liveOnly {
				if event.Position <= conn.lastSent {
					continue
				}
				if event.Position > conn.lastSent+1 {
					if err := h.fill(ctx, conn, projectID, event.Position-1); err != nil {
						return err
					}
				}
			}
			if err := conn.send(event); err != nil {
				return err
			}

		case <-ticker.C:
			if err := conn.keepalive(); err != nil {
				return err
			}
		}
	}
}

// fill writes the events between conn.lastSent and through, both from the log.
func (h *Handler) fill(ctx context.Context, conn *connection, projectID string, through int64) error {
	for conn.lastSent < through {
		page, err := h.reader.Page(ctx, projectID, conn.lastSent, through, h.pageSize)
		if err != nil {
			return err
		}
		if len(page) == 0 {
			// Positions are gapless by construction, so an empty page here means
			// the log disagrees with a position the broker published.
			return fmt.Errorf("sse: positions %d..%d of project %q are missing from the log",
				conn.lastSent+1, through, projectID)
		}
		for _, event := range page {
			if err := conn.send(event); err != nil {
				return err
			}
		}
	}
	return nil
}

// drain empties the subscription buffer without writing anything and reports
// how many of the discarded events are still missing from the stream.
func drain(sub *Subscription, lastSent int64) int {
	pending := 0
	for {
		select {
		case event := <-sub.Events():
			if event.Position > lastSent {
				pending++
			}
		default:
			return pending
		}
	}
}

// startPosition resolves the position the client wants to resume from.
//
// `lastEventPosition` wins over `Last-Event-ID` when both are present. The
// query parameter is set deliberately by a client that persists its own cursor
// — the simulator, a test, a CLI — while the header is set automatically by the
// browser's EventSource from the last frame it happened to see. When the two
// disagree, the explicit statement is the one that reflects what the client
// actually processed.
//
// The two are validated differently for the same reason. A `lastEventPosition`
// that is not a position is a client defect and is reported as such; a
// `Last-Event-ID` this server never wrote is ignored, because the header is
// echoed back through the browser and an intermediary is free to mangle it.
func (h *Handler) startPosition(c *gin.Context) (int64, bool) {
	if raw := strings.TrimSpace(c.Query(lastEventPositionQuery)); raw != "" {
		position, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || position < 0 {
			writeProblem(c, http.StatusBadRequest, CodeInvalidQueryParameter, "Invalid query parameter",
				"One or more query parameters of this request are not acceptable.",
				fieldError{
					Field:   "/" + lastEventPositionQuery,
					Code:    "invalid",
					Message: "want the last processed project position as an integer of at least 0",
				})
			return 0, false
		}
		return position, true
	}

	raw := strings.TrimSpace(c.GetHeader(lastEventIDHeader))
	if raw == "" {
		return liveOnly, true
	}
	position, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || position < 0 {
		return liveOnly, true
	}
	return position, true
}

// finish logs how a stream ended. The client is already gone or going, so this
// is an operational record, not an error response.
func (h *Handler) finish(projectID string, conn *connection, err error) {
	// A cancelled context is the browser closing the tab and a closed
	// subscription is the broker or the shutdown ending it: both are the normal
	// end of a stream, not a failure.
	switch {
	case err == nil, errors.Is(err, context.Canceled), errors.Is(err, errSubscriptionEnded):
		h.logger.Debug().
			Str("projectId", projectID).
			Int64("lastSentPosition", conn.lastSent).
			Msg("sse stream closed")
	default:
		h.logger.Warn().Err(err).
			Str("projectId", projectID).
			Int64("lastSentPosition", conn.lastSent).
			Msg("sse stream ended with an error")
	}
}
