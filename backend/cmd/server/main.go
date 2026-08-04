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
	"github.com/risqyy/visualise-ai/backend/internal/logging"
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

	router := httpapi.New(httpapi.Options{
		Logger:  logger,
		Health:  checker,
		Version: version,
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

	// Startup work is complete: only now may the instance report readiness.
	bootstrap(db, checker, logger)

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
// routed to. Schema migration is added together with the event store.
func bootstrap(_ *gorm.DB, checker *health.Checker, logger zerolog.Logger) {
	checker.MarkBootstrapped()
	logger.Info().Msg("backend is ready")
}
