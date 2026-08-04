package httpapi

import (
	"context"
	"io"
	"net/http"
	"testing"

	"github.com/rs/zerolog"

	"github.com/risqyy/visualise-ai/backend/internal/health"
	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/sse"
)

// TestStreamAndReadModelsShareOneWildcardName guards the one failure mode of
// this registration that no request can ever surface: Gin keeps a single
// wildcard name per position in its routing tree, so a stream route registered
// as `/projects/:id/stream` next to the read models' `/projects/:projectId/…`
// panics while the engine is being built.
//
// Building the router with both mounted is therefore the whole test — it would
// panic before returning.
func TestStreamAndReadModelsShareOneWildcardName(t *testing.T) {
	checker := health.NewChecker(func(context.Context) error { return nil })
	checker.MarkBootstrapped()

	engine := New(Options{
		Logger:  zerolog.New(io.Discard),
		Health:  checker,
		Version: "test",
		// A nil gorm handle is enough: nothing here issues a query, the routes
		// only have to be registered.
		Read:   readapi.New(nil),
		Stream: sse.NewHandler(sse.HandlerOptions{}),
	})

	var found bool
	for _, route := range engine.Routes() {
		if route.Method == http.MethodGet && route.Path == APIPrefix+"/projects/:projectId/stream" {
			found = true
		}
	}
	if !found {
		t.Fatalf("the stream route is not registered: %v", engine.Routes())
	}
}

// TestStreamRouteIsOptional keeps the probe-only router usable: without a
// handler the route simply does not exist.
func TestStreamRouteIsOptional(t *testing.T) {
	_, handler := newTestRouter(func(context.Context) error { return nil }, true)

	rec := do(t, handler, http.MethodGet, APIPrefix+"/projects/demo/stream")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 without a stream handler, got %d", rec.Code)
	}
}
