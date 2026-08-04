# 6. SSE replay, the in-process broker and the project position as cursor

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #6 (part of the v0 epic #1)
- **Builds on:** [0001 — Compose topology and single entry point](./0001-compose-topology-and-single-entry-point.md),
  [0002 — Event log with synchronous projections](./0002-event-log-with-synchronous-projections.md),
  [0004 — Contract-driven ingestion validation](./0004-contract-driven-ingestion-validation.md)

## Context

The cockpit watches an agent while it works, over a connection that will drop.
A dropped SSE stream is normal, not exceptional, and the reconnect must deliver
**every committed event exactly once, in position order, without a gap and
without a duplicate** — that is the acceptance criterion of #6, and every live
overlay built on top of it depends on it.

Two things make that harder than it looks:

1. A stream has two sources — the PostgreSQL log for the past and the running
   process for the present — and the handover between them is a race.
2. The single backend instance serves both ingestion and the streams, so a
   browser that stops reading must not be able to slow either down.

## Decision

**The server-side project position is the only cursor.** The SSE `id:` is the
position, not the event UUID; `Last-Event-ID` and `lastEventPosition` are read
as positions, and the client stores a position rather than a payload. Positions
are per project, monotonic and gapless because they are handed out under the
project row lock (ADR 0002), so `position > lastSent` is a complete and exact
description of "what this connection still owes the client". The event UUID
would satisfy none of that: it carries no order, so resuming from one would mean
asking the database where it sits before anything could be read.

**Replay reads the log in pages, live events come from an in-process broker,
and the connection holds `lastSent` across both.** Replayed and live events are
the same Go value — `ingest.CommittedEvent`, shaped field for field like the
contract's `StreamedEvent` — so there is exactly one mapping onto the wire and
the two sources cannot drift apart.

### The handover

Both obvious orderings are wrong, and each is wrong in its own way:

- *Read the database, then subscribe.* Everything that commits between the last
  page and the subscription is delivered to nobody and is never noticed again.
- *Subscribe, then read the database, then flush the buffer.* The overlap —
  every event that is both in a page and in the buffer — is delivered twice.

The implementation does this instead:

1. **Subscribe before the first read.** From that moment every committed event
   is either found by a later page or waiting in the subscription.
2. **Replay page by page**, ordered by position, writing each event and
   advancing `lastSent`.
3. **After every page, drain the subscription buffer and discard it.** That is
   sound precisely because the publisher runs *after* the commit (ADR 0004): an
   event the broker handed out is already durable, so the next page will find
   it. The database stays the single source during replay.
4. **End the replay only when the page was short *and* the drained buffer was
   empty.** Either condition alone leaves a window; together they mean the log
   is exhausted and nothing arrived while it was being read.
5. **In the live phase, filter strictly against `lastSent`**: an event at or
   below it was already written and is dropped; an event above `lastSent + 1`
   means something is missing and the range is filled from the log before the
   event itself goes out.

Step 5 is not belt-and-braces. Positions are assigned under the row lock, but
`Publish` is called by the ingesting goroutine *after* its transaction
committed, so two appends can reach the broker in the opposite order. Whichever
arrives first, the earlier position is already committed and visible, so reading
it back restores the order the contract promises.

Discarding rather than replaying the buffer during step 3 has a second benefit:
a long replay cannot overflow the buffer of a client that is not slow at all,
only far behind.

**The broker stays in the process.** v0 runs exactly one backend (ADR 0001), so
a process-local fan-out is the whole realtime layer — no message broker, no
Redis, no cross-instance fan-out, nothing to operate. Durability is not the
broker's problem either: it may lose anything it likes, because PostgreSQL has
every event and replay is how a client recovers it. That is also why a backend
restart costs nothing but a reconnect: the new process starts with an empty
broker, and the client's `Last-Event-ID` pulls the gap out of the log.

**A slow client is disconnected, never waited for.** Each subscriber owns a
buffered channel of 256 events; `Publish` sends non-blocking and drops the
subscription when the buffer is full, logging it. 256 is a backpressure budget:
the catalogue carries semantic work steps rather than raw tool calls, so a
project produces events at a human-readable rate and 256 of them is far more
than a connection accumulates while a tab is descheduled. Larger would trade a
fast, recoverable disconnect for a growing per-connection backlog; smaller would
drop connections during ordinary bursts. Overflow costs one reconnect and never
an event, because the client resumes with its cursor.

**`lastEventPosition` wins over `Last-Event-ID`, and the two are validated
differently.** The query parameter is set deliberately by a client that persists
its own cursor — the simulator, a test, a CLI — while the header is set
automatically by the browser from the last frame it happened to see. When they
disagree, the explicit statement is the one that reflects what the client
actually processed. Consequently an unusable `lastEventPosition` is a client
defect and is answered with `400` and an RFC 9457 problem, while an unusable
`Last-Event-ID` is ignored and the stream starts live: that header travels back
through the browser and an intermediary is free to mangle it.

**A cursor beyond the end of the log starts at the current end.** Honouring it
verbatim would filter away every event until the project caught up again, which
presents as a working but permanently silent stream — the worst possible failure
for an observability tool. Clamping it is the honest reading of "everything I
have not seen", and it is logged.

**Shutdown ends the subscriptions first.** An SSE connection never goes idle —
it keeps writing keepalives — so `http.Server.Shutdown` on its own waits for the
full timeout. `main` closes the broker before it shuts the server down, which
ends every stream at once and lets the in-flight read and write requests drain
normally.

## Consequences

- Adding a second backend instance breaks the live half of the stream: an event
  ingested by instance A never reaches a subscriber of instance B. The replay
  half keeps working, so the failure mode is a stalled tail rather than silent
  corruption — but scaling out means replacing this package's broker, and that
  is the deliberate boundary of v0.
- Replay costs one query per 200 events. A client that resumes from the very
  beginning of a long-lived project therefore does real work at connect time;
  the cost is bounded per page and never materialises the whole log.
- The gap fill can, in principle, issue a database read on the live path. In
  practice it never triggers, because publications are almost always in position
  order — but the guarantee does not depend on that being true.
- A replayed frame carries the canonical payload the store wrote, a live frame
  the document as the agent reported it. The two can differ in JSON object key
  order and never in content, which is invisible to any JSON consumer but would
  surprise a byte-for-byte comparison.
- The keepalive interval and the replay page size are options of the handler
  with documented defaults (15 s, 200) rather than environment variables. The
  Nginx frontend allows 24 h on this route, so there is nothing to tune per
  deployment yet; promoting them to `config.Config` is a two-line change if that
  ever stops being true.
- Nginx rewrites `Connection: keep-alive` to `Connection: close` on this route,
  because `chunked_transfer_encoding off` leaves it no way to delimit an
  unbounded body. The backend emits the header the contract names; `Connection`
  is hop-by-hop and rewriting it is what an intermediary is for. `EventSource`
  is unaffected — it reads until the stream ends and reconnects with its cursor.
