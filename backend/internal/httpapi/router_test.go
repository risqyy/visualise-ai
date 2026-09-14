package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/risqyy/visualise-ai/backend/internal/health"
	"github.com/risqyy/visualise-ai/backend/internal/ingest"
	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/sse"
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

func TestApplicationRoutesRequireBootstrap(t *testing.T) {
	dependencyChecks, mcpCalls := 0, 0
	checker := health.NewChecker(func(context.Context) error {
		dependencyChecks++
		return nil
	})
	engine := New(Options{
		Logger: zerolog.Nop(), Health: checker,
		// Missing dependencies deliberately make these handlers unusable: the
		// admission boundary must stop requests before any handler executes.
		Ingest: &ingest.Handler{}, Read: readapi.New(nil), Stream: &sse.Handler{},
		MCP: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mcpCalls++
			w.WriteHeader(http.StatusNoContent)
		}),
	})
	assertBlocked := func(t *testing.T) {
		t.Helper()
		for _, route := range engine.Routes() {
			if route.Path == "/healthz" || route.Path == "/readyz" {
				continue
			}
			path := strings.NewReplacer(":projectId", "project", ":runId", "run", ":componentId", "component").Replace(route.Path)
			rec := do(t, engine, route.Method, path)
			if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"code":"backend_unavailable"`) {
				t.Fatalf("%s %s must be blocked at admission, got %d: %s", route.Method, path, rec.Code, rec.Body)
			}
		}
		if mcpCalls != 0 || dependencyChecks != 0 {
			t.Fatalf("unready traffic executed work: MCP=%d, database checks=%d", mcpCalls, dependencyChecks)
		}
		if rec := do(t, engine, http.MethodGet, "/healthz"); rec.Code != http.StatusOK {
			t.Fatalf("liveness unavailable: %d", rec.Code)
		}
		if rec := do(t, engine, http.MethodGet, "/readyz"); rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("unready probe: %d", rec.Code)
		}
	}
	assertBlocked(t)
	checker.MarkBootstrapped()
	if rec := do(t, engine, http.MethodPost, "/mcp"); rec.Code != http.StatusNoContent || mcpCalls != 1 {
		t.Fatalf("ready MCP request was not admitted: %d, calls=%d", rec.Code, mcpCalls)
	}
	if dependencyChecks != 0 {
		t.Fatal("application admission must not add a database ping per request")
	}
	if rec := do(t, engine, http.MethodGet, "/readyz"); rec.Code != http.StatusOK || dependencyChecks != 1 {
		t.Fatalf("ready probe must check the database: %d, checks=%d", rec.Code, dependencyChecks)
	}
	checker.MarkNotBootstrapped()
	mcpCalls, dependencyChecks = 0, 0
	assertBlocked(t)
}

func TestMissingHealthCheckerNeverAdmitsApplicationTraffic(t *testing.T) {
	engine := New(Options{Logger: zerolog.Nop(), MCP: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("MCP called without a health checker")
	})})
	if rec := do(t, engine, http.MethodPost, "/mcp"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 without a health checker, got %d", rec.Code)
	}
	if rec := do(t, engine, http.MethodGet, "/readyz"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want unready without a health checker, got %d", rec.Code)
	}
}
