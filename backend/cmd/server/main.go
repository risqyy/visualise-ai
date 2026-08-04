// Command server runs the single internal backend instance of the cockpit.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"gorm.io/gorm"

	"github.com/risqyy/visualise-ai/backend/internal/config"
	"github.com/risqyy/visualise-ai/backend/internal/database"
	"github.com/risqyy/visualise-ai/backend/internal/health"
	"github.com/risqyy/visualise-ai/backend/internal/httpapi"
	"github.com/risqyy/visualise-ai/backend/internal/ingest"
	"github.com/risqyy/visualise-ai/backend/internal/logging"
	"github.com/risqyy/visualise-ai/backend/internal/readapi"
	"github.com/risqyy/visualise-ai/backend/internal/store"
)

// version is overridden at build time via -ldflags.
var version = "dev"

func main() {
	if err := run(); err != nil {
		// The logger may not exist yet when configuration fails.
		os.Stderr.WriteString("fatal: " + err.Error() + "\n")
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := logging.New(cfg.LogLevel, cfg.LogFormat)
	logger.Info().Str("version", version).Str("addr", cfg.HTTPAddr).Msg("starting backend")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := database.Open(ctx, cfg.DatabaseURL, cfg.DatabaseConnectTimeout, logger)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := database.Close(db); closeErr != nil {
			logger.Error().Err(closeErr).Msg("closing database failed")
		}
	}()

	checker := health.NewChecker(func(ctx context.Context) error {
		return database.Ping(ctx, db)
	})

	// The publisher stays a no-op until the SSE broker replaces it; ingestion
	// does not depend on anyone listening.
	ingestHandler, err := ingest.NewHandler(ingest.HandlerOptions{
		Store:         store.New(db),
		Publisher:     ingest.NopPublisher{},
		MaxEventBytes: cfg.MaxEventBytes,
		Logger:        logger,
	})
	if err != nil {
		return err
	}

	router := httpapi.New(httpapi.Options{
		Logger:  logger,
		Health:  checker,
		Version: version,
		Ingest:  ingestHandler,
		Read:    readapi.New(db),
	})

	server := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: router,
		// SSE connections are long lived, so no global write timeout is set.
		ReadHeaderTimeout: 10 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		if listenErr := server.ListenAndServe(); listenErr != nil && !errors.Is(listenErr, http.ErrServerClosed) {
			serverErr <- listenErr
			return
		}
		serverErr <- nil
	}()

	// Startup work must succeed before the instance may report readiness.
	if err := bootstrap(db, checker, logger); err != nil {
		return err
	}

	select {
	case err := <-serverErr:
		return err
	case <-ctx.Done():
		logger.Info().Msg("shutdown signal received")
	}

	checker.MarkNotBootstrapped()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return err
	}
	logger.Info().Msg("backend stopped")
	return <-serverErr
}

// bootstrap performs the startup work that must succeed before the backend is
// routed to.
//
// The schema is owned by the backend: GORM AutoMigrate is the only migration
// mechanism in v0. A failing migration returns an error, so the instance never
// marks itself bootstrapped, /readyz keeps answering 503 and the process exits
// non-zero instead of serving against an unknown schema.
func bootstrap(db *gorm.DB, checker *health.Checker, logger zerolog.Logger) error {
	if err := store.Migrate(db); err != nil {
		logger.Error().Err(err).Msg("schema migration failed")
		return err
	}
	logger.Info().Msg("schema migrated")

	checker.MarkBootstrapped()
	logger.Info().Msg("backend is ready")
	return nil
}
