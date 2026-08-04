package health

import (
	"context"
	"errors"
	"testing"
)

func TestReadyRequiresBootstrap(t *testing.T) {
	c := NewChecker(func(context.Context) error { return nil })

	if err := c.Ready(context.Background()); !errors.Is(err, ErrNotBootstrapped) {
		t.Fatalf("expected ErrNotBootstrapped before bootstrap, got %v", err)
	}

	c.MarkBootstrapped()
	if err := c.Ready(context.Background()); err != nil {
		t.Fatalf("expected ready after bootstrap, got %v", err)
	}
}

func TestReadyPropagatesDependencyFailure(t *testing.T) {
	want := errors.New("postgres down")
	c := NewChecker(func(context.Context) error { return want })
	c.MarkBootstrapped()

	if err := c.Ready(context.Background()); !errors.Is(err, want) {
		t.Fatalf("expected dependency error, got %v", err)
	}
}

func TestMarkNotBootstrappedWithdrawsReadiness(t *testing.T) {
	c := NewChecker(nil)
	c.MarkBootstrapped()
	c.MarkNotBootstrapped()

	if err := c.Ready(context.Background()); !errors.Is(err, ErrNotBootstrapped) {
		t.Fatalf("expected readiness to be withdrawn, got %v", err)
	}
}

func TestLiveIsIndependentOfDependencies(t *testing.T) {
	c := NewChecker(func(context.Context) error { return errors.New("postgres down") })
	if !c.Live() {
		t.Fatal("liveness must not depend on the database")
	}
}
