package render

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/risqyy/visualise-ai/backend/internal/store"
	"image"
	"image/png"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type providerFunc func(context.Context, store.ViewSnapshotRequest) (store.ViewSnapshot, error)

func (f providerFunc) CaptureViewSnapshot(ctx context.Context, r store.ViewSnapshotRequest) (store.ViewSnapshot, error) {
	return f(ctx, r)
}

type browserFunc func(context.Context, store.ViewSnapshot, Request) ([]byte, Painting, error)

func (f browserFunc) Paint(ctx context.Context, s store.ViewSnapshot, r Request) ([]byte, Painting, error) {
	return f(ctx, s, r)
}
func requestFixture() Request {
	return Request{ProjectID: "project-aa", ViewID: "view-aa", ExpectedModelRevision: 3, ExpectedViewRevision: 2, Viewport: Viewport{320, 240, 1}, DetailLevel: "standard"}
}
func snapshotFixture() store.ViewSnapshot {
	var result store.ViewSnapshot
	_ = json.Unmarshal([]byte(`{"model":{"projectId":"project-aa","modelRevision":3,"projectPosition":19,"components":[{"componentId":"service-aa","name":"Before capture","kind":"service","parentComponentId":null}],"relationships":[]},"view":{"viewId":"view-aa","name":"Original","kind":"architecture","selection":{"mode":"all"},"orientation":"top-down","collapsedComponentIds":[]},"viewRevision":2}`), &result)
	return result
}
func pngFixture(r Request) []byte {
	var buffer bytes.Buffer
	_ = png.Encode(&buffer, image.NewRGBA(image.Rect(0, 0, int(r.Viewport.Width*r.Viewport.PixelRatio), int(r.Viewport.Height*r.Viewport.PixelRatio))))
	return buffer.Bytes()
}
func paintingFixture() Painting {
	return Painting{MissingReferences: IDs{[]string{}, []string{}}, BoundaryRelationshipIDs: []string{}, VisibleIDs: IDs{[]string{"service-aa"}, []string{}}}
}
func providerFixture() providerFunc {
	return func(context.Context, store.ViewSnapshotRequest) (store.ViewSnapshot, error) {
		return snapshotFixture(), nil
	}
}
func browserFixture() browserFunc {
	return func(_ context.Context, _ store.ViewSnapshot, r Request) ([]byte, Painting, error) {
		return pngFixture(r), paintingFixture(), nil
	}
}
func code(t *testing.T, err error, want string) {
	t.Helper()
	var d *store.DomainError
	if !errors.As(err, &d) || d.Code != want {
		t.Fatalf("error %v; want %s", err, want)
	}
}
func TestExactDetachedSnapshotAndPNGMetadata(t *testing.T) {
	var calls atomic.Int32
	provider := providerFunc(func(_ context.Context, r store.ViewSnapshotRequest) (store.ViewSnapshot, error) {
		calls.Add(1)
		if r.ExpectedModelRevision != 3 || r.ExpectedViewRevision != 2 {
			t.Fatal(r)
		}
		return snapshotFixture(), nil
	})
	browser := browserFunc(func(_ context.Context, s store.ViewSnapshot, r Request) ([]byte, Painting, error) {
		if s.Model.ProjectPosition != 19 || s.View.Name != "Original" || s.Model.Components[0].Name != "Before capture" {
			t.Fatal(s)
		}
		return pngFixture(r), paintingFixture(), nil
	})
	service := New(provider, browser)
	request := requestFixture()
	request.Viewport.PixelRatio = 2
	result, err := service.Render(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 || result.Metadata.ModelRevision != 3 || result.Metadata.ViewRevision != 2 || result.Metadata.ProjectPosition != 19 || result.Metadata.ByteLength != len(result.PNG) {
		t.Fatal(result.Metadata, calls.Load())
	}
	if _, err = time.Parse(time.RFC3339Nano, result.Metadata.RenderedAt); err != nil {
		t.Fatal(err)
	}
}
func TestCaptureFailuresNeverStartBrowser(t *testing.T) {
	for _, failure := range []string{"view_not_found", "revision_conflict", "project_not_found"} {
		t.Run(failure, func(t *testing.T) {
			s := New(providerFunc(func(context.Context, store.ViewSnapshotRequest) (store.ViewSnapshot, error) {
				return store.ViewSnapshot{}, fail(failure, "capture rejected")
			}), browserFunc(func(context.Context, store.ViewSnapshot, Request) ([]byte, Painting, error) {
				t.Fatal("browser called")
				return nil, Painting{}, nil
			}))
			_, err := s.Render(context.Background(), requestFixture())
			code(t, err, failure)
		})
	}
	for _, wrong := range []string{"project", "model", "view", "viewrevision"} {
		t.Run(wrong, func(t *testing.T) {
			s := New(providerFunc(func(context.Context, store.ViewSnapshotRequest) (store.ViewSnapshot, error) {
				v := snapshotFixture()
				switch wrong {
				case "project":
					v.Model.ProjectID = "other"
				case "model":
					v.Model.ModelRevision++
				case "view":
					v.View.ViewID = "other"
				case "viewrevision":
					v.ViewRevision++
				}
				return v, nil
			}), browserFixture())
			_, err := s.Render(context.Background(), requestFixture())
			code(t, err, "render_failed")
		})
	}
}
func TestBoundsFailuresAndEmptyView(t *testing.T) {
	tests := []struct {
		name, expected string
		browser        browserFunc
	}{
		{"malformed", "render_failed", func(context.Context, store.ViewSnapshot, Request) ([]byte, Painting, error) {
			return []byte("not PNG"), Painting{}, nil
		}},
		{"wrongdimensions", "render_failed", func(_ context.Context, _ store.ViewSnapshot, r Request) ([]byte, Painting, error) {
			r.Viewport.Width++
			return pngFixture(r), paintingFixture(), nil
		}},
		{"oversizePNG", "response_too_large", func(context.Context, store.ViewSnapshot, Request) ([]byte, Painting, error) {
			return make([]byte, MaxImageBytes+1), Painting{}, nil
		}},
		{"oversizeMetadata", "response_too_large", func(_ context.Context, _ store.ViewSnapshot, r Request) ([]byte, Painting, error) {
			p := paintingFixture()
			p.MissingReferences.ComponentIDs = []string{strings.Repeat("x", MaxMetadataBytes)}
			return pngFixture(r), p, nil
		}},
		{"layoutFailure", "render_failed", func(context.Context, store.ViewSnapshot, Request) ([]byte, Painting, error) {
			return nil, Painting{}, errors.New("ELK rejected")
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := New(providerFixture(), test.browser).Render(context.Background(), requestFixture())
			code(t, err, test.expected)
		})
	}
	empty := providerFunc(func(context.Context, store.ViewSnapshotRequest) (store.ViewSnapshot, error) {
		v := snapshotFixture()
		v.Model.Components = nil
		return v, nil
	})
	_, err := New(empty, browserFixture()).Render(context.Background(), requestFixture())
	if err != nil {
		t.Fatal(err)
	}
	invalid := requestFixture()
	invalid.Viewport.Width = 319
	_, err = New(providerFixture(), browserFixture()).Render(context.Background(), invalid)
	code(t, err, "invalid_input")
}
func TestNoQueueCancellationDeadlineAndShutdown(t *testing.T) {
	entered := make(chan struct{}, 2)
	blocking := browserFunc(func(ctx context.Context, _ store.ViewSnapshot, _ Request) ([]byte, Painting, error) {
		entered <- struct{}{}
		<-ctx.Done()
		return nil, Painting{}, ctx.Err()
	})
	s := New(providerFixture(), blocking)
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() { _, err := s.Render(context.Background(), requestFixture()); results <- err }()
	}
	<-entered
	<-entered
	_, err := s.Render(context.Background(), requestFixture())
	code(t, err, "render_failed")
	shutdown, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err = s.Shutdown(shutdown); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if !errors.Is(<-results, context.Canceled) {
			t.Fatal("active render not cancelled")
		}
	}
	_, err = s.Render(context.Background(), requestFixture())
	code(t, err, "render_failed")
	if err = s.Shutdown(shutdown); err != nil {
		t.Fatal(err)
	}
	timed := New(providerFixture(), blocking)
	timed.timeout = 15 * time.Millisecond
	_, err = timed.Render(context.Background(), requestFixture())
	code(t, err, "render_timeout")
	cancelled, cancelNow := context.WithCancel(context.Background())
	cancelNow()
	_, err = New(providerFixture(), browserFixture()).Render(cancelled, requestFixture())
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	// The same deadline also bounds snapshot capture before Chromium starts.
	capturing := New(providerFunc(func(ctx context.Context, _ store.ViewSnapshotRequest) (store.ViewSnapshot, error) {
		<-ctx.Done()
		return store.ViewSnapshot{}, ctx.Err()
	}), browserFixture())
	capturing.timeout = 15 * time.Millisecond
	_, err = capturing.Render(context.Background(), requestFixture())
	code(t, err, "render_timeout")
}
func TestNativeEntryNetworkAllowlist(t *testing.T) {
	b, err := NewChromium("chromium", "http://frontend:8080/render.html")
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"http://frontend:8080/render.html", "http://frontend:8080/assets/native.js", "http://frontend:8080/assets/elk.js"} {
		if !b.allowed(raw) {
			t.Fatal(raw)
		}
	}
	for _, raw := range []string{"http://frontend:8080/api/model", "http://frontend:8080/events", "http://other/assets/a.js", "file:///tmp/secret", "http://frontend:8080/render.html?projectId=x", "http://frontend:8080/assets/../api/model"} {
		if b.allowed(raw) {
			t.Fatal(raw)
		}
	}
	for _, raw := range []string{"file:///tmp/render.html", "http://frontend:8080/", "http://user:password@frontend/render.html", "http://frontend/render.html?x=1"} {
		if _, err = NewChromium("chromium", raw); err == nil {
			t.Fatal(raw)
		}
	}
}
