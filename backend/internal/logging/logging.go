// Package logging builds the process-wide zerolog logger.
package logging

import (
	"os"
	"time"

	"github.com/rs/zerolog"
)

// New returns a zerolog logger for the given level and format.
//
// An unparseable level falls back to info rather than failing the process:
// losing log verbosity must never keep the service from starting.
func New(level, format string) zerolog.Logger {
	parsed, err := zerolog.ParseLevel(level)
	if err != nil || parsed == zerolog.NoLevel {
		parsed = zerolog.InfoLevel
	}

	var writer = os.Stdout
	logger := zerolog.New(writer)
	if format == "console" {
		logger = zerolog.New(zerolog.ConsoleWriter{Out: writer, TimeFormat: time.RFC3339})
	}

	return logger.Level(parsed).With().Timestamp().Str("service", "visualise-ai-backend").Logger()
}
