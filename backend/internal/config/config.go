// Package config loads the backend configuration from environment variables.
//
// Every setting has a documented default so the service can boot inside the
// Compose network without extra wiring. See .env.example for the full list.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds every runtime setting of the backend service.
type Config struct {
	// HTTPAddr is the listen address of the internal HTTP server.
	HTTPAddr string
	// LogLevel is a zerolog level name (trace, debug, info, warn, error).
	LogLevel string
	// LogFormat is either "json" (default) or "console".
	LogFormat string
	// DatabaseURL is the PostgreSQL DSN in URL form.
	DatabaseURL string
	// DatabaseConnectTimeout bounds the startup wait for PostgreSQL.
	DatabaseConnectTimeout time.Duration
	// MaxEventBytes is the maximum accepted size of a single ingested event.
	MaxEventBytes int64
	// ShutdownTimeout bounds the graceful shutdown of in-flight requests.
	ShutdownTimeout time.Duration
}

// Default values are chosen so that `docker compose up` works unconfigured.
const (
	defaultHTTPAddr               = ":8080"
	defaultLogLevel               = "info"
	defaultLogFormat              = "json"
	defaultDatabaseConnectTimeout = 60 * time.Second
	defaultMaxEventBytes          = 2 * 1024 * 1024 // 2 MiB, see the event contract
	defaultShutdownTimeout        = 15 * time.Second
)

// Load reads the configuration from the process environment.
//
// It fails when a required value is missing or a provided value cannot be
// parsed, so a misconfigured backend never reports itself as ready.
func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:               envString("HTTP_ADDR", defaultHTTPAddr),
		LogLevel:               envString("LOG_LEVEL", defaultLogLevel),
		LogFormat:              envString("LOG_FORMAT", defaultLogFormat),
		DatabaseURL:            envString("DATABASE_URL", ""),
		DatabaseConnectTimeout: defaultDatabaseConnectTimeout,
		MaxEventBytes:          defaultMaxEventBytes,
		ShutdownTimeout:        defaultShutdownTimeout,
	}

	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return Config{}, fmt.Errorf("DATABASE_URL must be set")
	}

	if cfg.LogFormat != "json" && cfg.LogFormat != "console" {
		return Config{}, fmt.Errorf("LOG_FORMAT must be %q or %q, got %q", "json", "console", cfg.LogFormat)
	}

	var err error
	if cfg.DatabaseConnectTimeout, err = envDuration("DATABASE_CONNECT_TIMEOUT", defaultDatabaseConnectTimeout); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownTimeout, err = envDuration("SHUTDOWN_TIMEOUT", defaultShutdownTimeout); err != nil {
		return Config{}, err
	}
	if cfg.MaxEventBytes, err = envBytes("MAX_EVENT_BYTES", defaultMaxEventBytes); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func envString(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) (time.Duration, error) {
	raw, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil {
		return 0, fmt.Errorf("%s must be a Go duration (e.g. 30s): %w", key, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("%s must be positive, got %s", key, d)
	}
	return d, nil
}

func envBytes(key string, fallback int64) (int64, error) {
	raw, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer number of bytes: %w", key, err)
	}
	if n <= 0 {
		return 0, fmt.Errorf("%s must be positive, got %d", key, n)
	}
	return n, nil
}
