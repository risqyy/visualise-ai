// Package database opens and verifies the PostgreSQL connection.
package database

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// retryInterval is the wait between connection attempts during startup.
const retryInterval = time.Second

// Open connects to PostgreSQL and blocks until the server answers a ping or
// the timeout expires.
//
// Compose already gates the backend on a healthy database, but a retry loop
// keeps the service resilient against a database restart during development.
func Open(ctx context.Context, dsn string, timeout time.Duration, logger zerolog.Logger) (*gorm.DB, error) {
	deadline, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var lastErr error
	for attempt := 1; ; attempt++ {
		db, err := connect(deadline, dsn, logger)
		if err == nil {
			logger.Info().Int("attempt", attempt).Msg("connected to postgres")
			return db, nil
		}
		lastErr = err
		logger.Warn().Err(err).Int("attempt", attempt).Msg("postgres not reachable yet")

		select {
		case <-deadline.Done():
			return nil, fmt.Errorf("could not reach postgres within %s: %w", timeout, lastErr)
		case <-time.After(retryInterval):
		}
	}
}

func connect(ctx context.Context, dsn string, logger zerolog.Logger) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: gormlogger.Discard,
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	// A single backend instance owns the whole workload in v0.
	sqlDB.SetMaxOpenConns(20)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(time.Hour)

	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	_ = logger
	return db, nil
}

// Ping verifies that the database still answers.
func Ping(ctx context.Context, db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	return sqlDB.PingContext(ctx)
}

// Close releases the underlying connection pool.
func Close(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
