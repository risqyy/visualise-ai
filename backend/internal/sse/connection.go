package sse

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/risqyy/visualise-ai/backend/internal/ingest"

	"github.com/gin-gonic/gin"
)

// keepaliveComment is the comment line that keeps proxies from closing an idle
// stream. Comments carry no `id:`, so they can never move the client cursor.
const keepaliveComment = ": keepalive\n\n"

// liveOnly is the cursor of a connection that asked for neither Last-Event-ID
// nor lastEventPosition: it has no baseline to reconcile against and simply
// starts with the next live event.
const liveOnly = int64(-1)

// connection is the write side of one SSE stream.
//
// lastSent is the whole delivery contract in one field: it is the position of
// the last frame written to this connection, it is what every candidate event
// is filtered against, and it is what the client echoes back as Last-Event-ID
// after a reconnect. Nothing is ever written without advancing it.
type connection struct {
	writer   gin.ResponseWriter
	lastSent int64
	buf      bytes.Buffer
}

// newConnection writes the response headers of the stream and returns the
// writer the replay and the live loop share.
//
// The headers are the contract's: `text/event-stream` with caching and proxy
// buffering switched off. `X-Accel-Buffering: no` is what makes Nginx forward
// each frame the moment it is written even if a future deployment loses the
// `proxy_buffering off` in its location block.
func newConnection(c *gin.Context, lastSent int64) *connection {
	header := c.Writer.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-cache")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no")

	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	return &connection{writer: c.Writer, lastSent: lastSent}
}

// send writes one event as an SSE frame and flushes it.
//
// The frame is the one the contract documents: `id:` is the server-side project
// position — not the event UUID, which is carried inside the payload as
// `serverEventId` — `event:` is the catalogue type so a client can subscribe
// per type, and `data:` is one compact-JSON StreamedEvent.
func (conn *connection) send(event ingest.CommittedEvent) error {
	// CommittedEvent is shaped exactly like the contract's StreamedEvent, so
	// this is the only mapping between the log and the wire.
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("sse: encoding event at position %d: %w", event.Position, err)
	}

	conn.buf.Reset()
	conn.buf.WriteString("id: ")
	conn.buf.WriteString(strconv.FormatInt(event.Position, 10))
	conn.buf.WriteString("\nevent: ")
	conn.buf.WriteString(event.Type)
	conn.buf.WriteString("\ndata: ")
	conn.buf.Write(data)
	conn.buf.WriteString("\n\n")

	if _, err := conn.writer.Write(conn.buf.Bytes()); err != nil {
		return err
	}
	conn.writer.Flush()
	conn.lastSent = event.Position
	return nil
}

// keepalive writes the comment line and flushes it.
func (conn *connection) keepalive() error {
	if _, err := conn.writer.WriteString(keepaliveComment); err != nil {
		return err
	}
	conn.writer.Flush()
	return nil
}
