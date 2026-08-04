package sse

import (
	"context"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/risqyy/visualise-ai/backend/internal/ingest"
)

// The broker owns no database, so these tests need none either: they run on any
// machine and cover the fan-out rules the stream tests take for granted.

func testBroker(buffer int) *Broker {
	return NewBroker(BrokerOptions{Logger: zerolog.Nop(), Buffer: buffer})
}

func event(projectID string, position int64) ingest.CommittedEvent {
	return ingest.CommittedEvent{ProjectID: projectID, Position: position, Type: "agent.status_reported"}
}

// receive takes one event off a subscription or fails.
func receive(t *testing.T, sub *Subscription) ingest.CommittedEvent {
	t.Helper()
	select {
	case got := <-sub.Events():
		return got
	case <-time.After(time.Second):
		t.Fatalf("no event within a second")
		return ingest.CommittedEvent{}
	}
}

func TestBrokerFansOutPerProject(t *testing.T) {
	broker := testBroker(4)

	first := broker.Subscribe("alpha")
	second := broker.Subscribe("alpha")
	other := broker.Subscribe("beta")

	if got := broker.SubscriberCount("alpha"); got != 2 {
		t.Fatalf("alpha holds %d subscribers, want 2", got)
	}

	broker.Publish(context.Background(), event("alpha", 7))

	if got := receive(t, first); got.Position != 7 {
		t.Fatalf("the first subscriber received position %d", got.Position)
	}
	if got := receive(t, second); got.Position != 7 {
		t.Fatalf("the second subscriber received position %d", got.Position)
	}
	select {
	case got := <-other.Events():
		t.Fatalf("a subscriber of beta received %+v", got)
	default:
	}
}

// TestBrokerDropsASubscriberThatFallsBehind is the backpressure rule: the
// broker gives up on the connection instead of waiting for it, so ingestion and
// every other subscriber stay unaffected.
func TestBrokerDropsASubscriberThatFallsBehind(t *testing.T) {
	broker := testBroker(2)
	slow := broker.Subscribe("alpha")

	start := time.Now()
	for position := int64(1); position <= 5; position++ {
		broker.Publish(context.Background(), event("alpha", position))
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("publishing took %s: the broker waited for the subscriber", elapsed)
	}

	select {
	case <-slow.Closed():
	default:
		t.Fatalf("the subscriber that never read was not dropped")
	}
	if !slow.Overflowed() {
		t.Fatalf("the dropped subscription does not report the overflow")
	}
	if got := broker.SubscriberCount("alpha"); got != 0 {
		t.Fatalf("alpha still holds %d subscribers after the drop", got)
	}

	// The broker keeps serving whoever comes next — which, for a real client,
	// is the same browser reconnecting with its cursor.
	next := broker.Subscribe("alpha")
	broker.Publish(context.Background(), event("alpha", 6))
	if got := receive(t, next); got.Position != 6 {
		t.Fatalf("the reconnected subscriber received position %d, want 6", got.Position)
	}
}

func TestBrokerCloseIsIdempotentAndUnregisters(t *testing.T) {
	broker := testBroker(4)
	sub := broker.Subscribe("alpha")

	sub.Close()
	sub.Close()

	select {
	case <-sub.Closed():
	default:
		t.Fatalf("Close did not end the subscription")
	}
	if got := broker.Subscribers(); got != 0 {
		t.Fatalf("the broker still holds %d subscribers", got)
	}
	// Publishing to nobody must not panic on the emptied project map.
	broker.Publish(context.Background(), event("alpha", 1))
}

func TestBrokerShutdownEndsEveryStream(t *testing.T) {
	broker := testBroker(4)
	alpha := broker.Subscribe("alpha")
	beta := broker.Subscribe("beta")

	broker.Shutdown()

	for name, sub := range map[string]*Subscription{"alpha": alpha, "beta": beta} {
		select {
		case <-sub.Closed():
		default:
			t.Fatalf("the %s subscription survived the shutdown", name)
		}
		if sub.Overflowed() {
			t.Fatalf("the %s subscription reports an overflow after a clean shutdown", name)
		}
	}
	if got := broker.Subscribers(); got != 0 {
		t.Fatalf("the stopped broker holds %d subscribers", got)
	}

	// A connection that races the shutdown gets a closed subscription rather
	// than one that will never be served.
	late := broker.Subscribe("alpha")
	select {
	case <-late.Closed():
	default:
		t.Fatalf("subscribing to a stopped broker returned an open subscription")
	}
}
