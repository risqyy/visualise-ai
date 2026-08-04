package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"

	"github.com/risqyy/visualise-ai/backend/internal/health"
)

func newTestRouter(dependency func(context.Context) error, bootstrapped bool) (*health.Checker, http.Handler) {
	checker := health.NewChecker(dependency)
	if bootstrapped {
		checker.MarkBootstrapped()
	}
	engine := New(Options{
		Logger:  zerolog.New(io.Discard),
		Health:  checker,
		Version: "test",
	})
	return checker, engine
}

func do(t *testing.T, handler http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestHealthzIsAlwaysOK(t *testing.T) {
	_, handler := newTestRouter(func(context.Context) error { return errors.New("db down") }, false)

	rec := do(t, handler, http.MethodGet, "/healthz")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("want status ok, got %v", body["status"])
	}
}

func TestReadyzUnavailableBeforeBootstrap(t *testing.T) {
	_, handler := newTestRouter(func(context.Context) error { return nil }, false)

	rec := do(t, handler, http.MethodGet, "/readyz")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 before bootstrap, got %d", rec.Code)
	}
}

func TestReadyzUnavailableWhenDatabaseFails(t *testing.T) {
	_, handler := newTestRouter(func(context.Context) error { return errors.New("db down") }, true)

	rec := do(t, handler, http.MethodGet, "/readyz")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 when the database is unreachable, got %d", rec.Code)
	}
}

func TestReadyzOKWhenBootstrappedAndDatabaseUp(t *testing.T) {
	_, handler := newTestRouter(func(context.Context) error { return nil }, true)

	rec := do(t, handler, http.MethodGet, "/readyz")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func TestUnknownRouteReturnsStructuredNotFound(t *testing.T) {
	_, handler := newTestRouter(nil, true)

	rec := do(t, handler, http.MethodGet, APIPrefix+"/does-not-exist")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if body["title"] != "Not Found" {
		t.Fatalf("want structured error body, got %v", body)
	}
}
