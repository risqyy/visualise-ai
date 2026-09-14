// Package render produces one bounded native-frontend image from a detached
// model/view snapshot. It never reads the model again after capture.
package render

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image/png"
	"sync"
	"time"

	"github.com/risqyy/visualise-ai/backend/internal/store"
)

const MaxImageBytes = 4 * 1024 * 1024
const MaxMetadataBytes = 1024 * 1024
const Deadline = 30 * time.Second

type Viewport struct {
	Width      int64 `json:"width"`
	Height     int64 `json:"height"`
	PixelRatio int64 `json:"pixelRatio"`
}
type Request struct {
	ProjectID             string   `json:"projectId"`
	ViewID                string   `json:"viewId"`
	ExpectedModelRevision int64    `json:"expectedModelRevision"`
	ExpectedViewRevision  int64    `json:"expectedViewRevision"`
	Viewport              Viewport `json:"viewport"`
	DetailLevel           string   `json:"detailLevel"`
}
type IDs struct {
	ComponentIDs    []string `json:"componentIds"`
	RelationshipIDs []string `json:"relationshipIds"`
}
type Painting struct {
	MissingReferences       IDs      `json:"missingReferences"`
	BoundaryRelationshipIDs []string `json:"boundaryRelationshipIds"`
	VisibleIDs              IDs      `json:"visibleIds"`
	Clipped                 bool     `json:"clipped"`
}
type Metadata struct {
	ProjectID       string   `json:"projectId"`
	ModelRevision   int64    `json:"modelRevision"`
	ProjectPosition int64    `json:"projectPosition"`
	ViewID          string   `json:"viewId"`
	ViewRevision    int64    `json:"viewRevision"`
	RenderedAt      string   `json:"renderedAt"`
	Viewport        Viewport `json:"viewport"`
	DetailLevel     string   `json:"detailLevel"`
	MimeType        string   `json:"mimeType"`
	ByteLength      int      `json:"byteLength"`
	Painting
}
type Result struct {
	PNG      []byte
	Metadata Metadata
}
type SnapshotProvider interface {
	CaptureViewSnapshot(context.Context, store.ViewSnapshotRequest) (store.ViewSnapshot, error)
}
type Browser interface {
	Paint(context.Context, store.ViewSnapshot, Request) ([]byte, Painting, error)
}
type Service struct {
	timeout  time.Duration
	provider SnapshotProvider
	browser  Browser
	slots    chan struct{}
	mu       sync.Mutex
	closed   bool
	active   map[uint64]context.CancelFunc
	next     uint64
	done     chan struct{}
}

func New(provider SnapshotProvider, browser Browser) *Service {
	return &Service{provider: provider, browser: browser, timeout: Deadline, slots: make(chan struct{}, 2), active: map[uint64]context.CancelFunc{}, done: make(chan struct{})}
}
func fail(code, detail string) error { return &store.DomainError{Code: code, Detail: detail} }
func (s *Service) Render(parent context.Context, request Request) (Result, error) {
	ctx, cancel := context.WithTimeout(parent, s.timeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	if request.ProjectID == "" || request.ViewID == "" || request.ExpectedModelRevision < 0 || request.ExpectedViewRevision < 0 ||
		request.Viewport.Width < 320 || request.Viewport.Width > 3840 || request.Viewport.Height < 240 || request.Viewport.Height > 2160 ||
		(request.Viewport.PixelRatio != 1 && request.Viewport.PixelRatio != 2) ||
		(request.DetailLevel != "map" && request.DetailLevel != "readable" && request.DetailLevel != "standard" && request.DetailLevel != "full") {
		return Result{}, fail("invalid_input", "Render requires a saved view, exact nonnegative revisions, supported viewport and detail level.")
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return Result{}, fail("render_failed", "Renderer is shutting down.")
	}
	select {
	case s.slots <- struct{}{}:
	default:
		s.mu.Unlock()
		return Result{}, fail("render_failed", "Two renders are already running; retry after one finishes.")
	}
	s.next++
	id := s.next
	s.active[id] = cancel
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.active, id)
		<-s.slots
		if s.closed && len(s.active) == 0 {
			close(s.done)
		}
		s.mu.Unlock()
	}()
	snapshot, err := s.provider.CaptureViewSnapshot(ctx, store.ViewSnapshotRequest{ProjectID: request.ProjectID, ViewID: request.ViewID, ExpectedModelRevision: request.ExpectedModelRevision, ExpectedViewRevision: request.ExpectedViewRevision})
	if err != nil {
		return Result{}, renderError(ctx, parent, err)
	}
	// A provider bug must not label a newer capture as the requested revision.
	if snapshot.Model.ProjectID != request.ProjectID || snapshot.View.ViewID != request.ViewID || snapshot.Model.ModelRevision != request.ExpectedModelRevision || snapshot.ViewRevision != request.ExpectedViewRevision {
		return Result{}, fail("render_failed", "Snapshot provider returned a different project or revision.")
	}
	data, painting, err := s.browser.Paint(ctx, snapshot, request)
	if err != nil {
		return Result{}, renderError(ctx, parent, err)
	}
	if err = ctx.Err(); err != nil {
		return Result{}, renderError(ctx, parent, err)
	}
	if len(data) > MaxImageBytes {
		return Result{}, fail("response_too_large", "Rendered PNG exceeds 4 MiB; request a smaller viewport or pixel ratio.")
	}
	dimensions, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || int64(dimensions.Width) != request.Viewport.Width*request.Viewport.PixelRatio || int64(dimensions.Height) != request.Viewport.Height*request.Viewport.PixelRatio {
		return Result{}, fail("render_failed", "Renderer did not return a PNG at the requested pixel dimensions.")
	}
	metadata := Metadata{ProjectID: snapshot.Model.ProjectID, ModelRevision: snapshot.Model.ModelRevision, ProjectPosition: snapshot.Model.ProjectPosition, ViewID: request.ViewID, ViewRevision: snapshot.ViewRevision, RenderedAt: time.Now().UTC().Format(time.RFC3339Nano), Viewport: request.Viewport, DetailLevel: request.DetailLevel, MimeType: "image/png", ByteLength: len(data), Painting: painting}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return Result{}, fail("render_failed", "Render metadata could not be encoded.")
	}
	if len(encoded) > MaxMetadataBytes {
		return Result{}, fail("response_too_large", "Render metadata exceeds 1 MiB.")
	}
	return Result{PNG: data, Metadata: metadata}, nil
}
func renderError(ctx, parent context.Context, err error) error {
	if parent.Err() != nil {
		return parent.Err()
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fail("render_timeout", "Native rendering exceeded its 30 second deadline; reduce the view scope.")
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var domain *store.DomainError
	if errors.As(err, &domain) {
		return err
	}
	return fail("render_failed", "Native layout or browser rendering failed.")
}

// Shutdown cancels every process, prevents new requests and observes one budget.
func (s *Service) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	if !s.closed {
		s.closed = true
		for _, cancel := range s.active {
			cancel()
		}
		if len(s.active) == 0 {
			close(s.done)
		}
	}
	s.mu.Unlock()
	select {
	case <-s.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
