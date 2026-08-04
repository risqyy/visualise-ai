package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog"
)

// RequestLogger emits one structured zerolog line per request.
//
// Probe routes are logged at debug level so the Compose healthcheck does not
// drown the operational log.
func RequestLogger(logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		event := logger.Info()
		if isProbe(c.Request.URL.Path) {
			event = logger.Debug()
		}
		event.
			Str("method", c.Request.Method).
			Str("path", c.Request.URL.Path).
			Int("status", c.Writer.Status()).
			Dur("duration", time.Since(start)).
			Msg("http request")
	}
}

// Recovery turns a panic into a 500 response and a logged stack trace instead
// of killing the single backend instance.
func Recovery(logger zerolog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error().
					Interface("panic", recovered).
					Str("method", c.Request.Method).
					Str("path", c.Request.URL.Path).
					Msg("recovered from panic")
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"type":   "about:blank",
					"title":  "Internal Server Error",
					"status": http.StatusInternalServerError,
				})
			}
		}()
		c.Next()
	}
}

func isProbe(path string) bool {
	return path == "/healthz" || path == "/readyz"
}
