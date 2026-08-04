// Package httpapi wires the Gin HTTP surface of the backend.
//
// v0 exposes exactly two internal probe routes plus the versioned API prefix
// that later work packages fill with event ingestion, the read models and the
// SSE stream.
package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"

	"github.com/risqyy/visualise-ai/backend/internal/health"
)

// APIPrefix is the single versioned prefix Nginx proxies to the backend.
const APIPrefix = "/api/v1"

// readinessCheckTimeout bounds a single readiness probe.
const readinessCheckTimeout = 3 * time.Second

// Options carries the collaborators required to build the router.
type Options struct {
	Logger  zerolog.Logger
	Health  *health.Checker
	Version string
}

// New builds the Gin engine.
func New(opts Options) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	engine := gin.New()
	engine.RedirectTrailingSlash = false
	engine.Use(RequestLogger(opts.Logger), Recovery(opts.Logger))

	engine.GET("/healthz", liveHandler(opts.Version))
	engine.GET("/readyz", readyHandler(opts.Health, opts.Version))

	// The versioned API group exists from the start so Nginx, the OpenAPI
	// contract and the frontend agree on one stable prefix.
	engine.Group(APIPrefix)

	engine.NoRoute(notFoundHandler())

	return engine
}

func liveHandler(version string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "version": version})
	}
}

func readyHandler(checker *health.Checker, version string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), readinessCheckTimeout)
		defer cancel()

		if err := checker.Ready(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status":  "unavailable",
				"version": version,
				"reason":  err.Error(),
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready", "version": version})
	}
}

func notFoundHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{
			"type":   "about:blank",
			"title":  "Not Found",
			"status": http.StatusNotFound,
			"detail": "no route matches " + c.Request.Method + " " + c.Request.URL.Path,
		})
	}
}
