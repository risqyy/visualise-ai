// Package health implements the liveness and readiness state of the backend.
package health

import (
	"context"
	"errors"
	"sync/atomic"
)

// ErrNotBootstrapped is reported while startup work is still pending.
var ErrNotBootstrapped = errors.New("backend has not finished bootstrapping")

// Checker reports whether the process may receive traffic.
//
// Liveness only says the process is running. Readiness additionally requires
// that all startup work succeeded and that PostgreSQL currently answers, so a
// backend that failed to start is never routed to as ready.
type Checker struct {
	bootstrapped atomic.Bool
	dependency   func(context.Context) error
}

// NewChecker returns a Checker that is not ready until MarkBootstrapped is
// called. dependency is the runtime check for the backing store.
func NewChecker(dependency func(context.Context) error) *Checker {
	return &Checker{dependency: dependency}
}

// MarkBootstrapped records that startup work finished successfully.
func (c *Checker) MarkBootstrapped() {
	c.bootstrapped.Store(true)
}

// MarkNotBootstrapped withdraws readiness, for example during shutdown.
func (c *Checker) MarkNotBootstrapped() {
	c.bootstrapped.Store(false)
}

// Live reports process liveness.
func (c *Checker) Live() bool { return true }

// Ready returns nil when the backend may serve traffic.
func (c *Checker) Ready(ctx context.Context) error {
	if !c.bootstrapped.Load() {
		return ErrNotBootstrapped
	}
	if c.dependency == nil {
		return nil
	}
	return c.dependency(ctx)
}
