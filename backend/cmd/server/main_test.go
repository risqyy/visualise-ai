package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/risqyy/visualise-ai/backend/internal/health"
	"github.com/risqyy/visualise-ai/backend/internal/httpapi"
	"github.com/rs/zerolog"
)

func TestBootstrapControlsApplicationAdmission(t *testing.T) {
	migrationFailure := errors.New("migration failed")
	for _, test := range []struct {
		name string
		err  error
	}{
		{name: "successful migration"},
		{name: "failed migration", err: migrationFailure},
	} {
		t.Run(test.name, func(t *testing.T) {
			checker := health.NewChecker(nil)
			calls := 0
			router := httpapi.New(httpapi.Options{
				Logger: zerolog.Nop(), Health: checker,
				MCP: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls++
					w.WriteHeader(http.StatusNoContent)
				}),
			})
			request := func(path string) int {
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
				return recorder.Code
			}
			err := bootstrap(func() error {
				// A proxy can send traffic while migrations are still running.
				if request("/healthz") != http.StatusOK || request("/readyz") != http.StatusServiceUnavailable {
					t.Fatal("startup probes do not reflect a live, unready process")
				}
				if request("/mcp") != http.StatusServiceUnavailable || calls != 0 {
					t.Fatal("application request reached its handler during migration")
				}
				return test.err
			}, checker, zerolog.Nop())
			if !errors.Is(err, test.err) {
				t.Fatalf("bootstrap error = %v, want %v", err, test.err)
			}
			if test.err != nil {
				if checker.Bootstrapped() || request("/readyz") != http.StatusServiceUnavailable || request("/mcp") != http.StatusServiceUnavailable || calls != 0 {
					t.Fatal("failed migration admitted application traffic")
				}
				return
			}
			if !checker.Bootstrapped() || request("/readyz") != http.StatusOK || request("/mcp") != http.StatusNoContent || calls != 1 {
				t.Fatal("successful migration did not admit application traffic")
			}
		})
	}
}
