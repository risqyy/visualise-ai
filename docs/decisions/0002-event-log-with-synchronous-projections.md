# 2. Immutable event log with synchronous projections in one transaction

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #4 (part of the v0 epic #1)
- **Builds on:** [0001 — Compose topology and single entry point](./0001-compose-topology-and-single-entry-point.md)

## Context

The cockpit shows only what agents explicitly reported. The reported events are
the audit source, but the UI cannot rebuild its whole view from the log on every
request. v0 also rules out a queue, a broker and a separate worker, and runs
exactly one backend instance.

Two properties are non-negotiable:

- A reader must never observe a read model that disagrees with the log.
- A reconnecting SSE client must be able to replay from a position and receive
  every committed event exactly once, in order.

## Decision

**One immutable log, projected synchronously, in a single transaction.**

`store.Append` performs the entire write inside one `gorm` transaction:

1. lock the project row,
2. resolve idempotency,
3. insert the `events` row,
4. advance every affected projection,
5. link the event to the components it touches.

Any failure rolls back all five steps. A rejected event therefore leaves no
trace and — importantly — does not consume a project position.

**The project row is the position allocator.** `SELECT … FOR UPDATE` on
`projects` serialises concurrent appends for that project; the next position is
`last_position + 1`. A `max(position) + 1` without a lock would let two
transactions read the same value and produce a gap or a duplicate. Positions are
per project, monotonic and gapless, which is exactly what SSE replay needs as a
cursor.

**Idempotency is content based.** The payload is canonicalised (object keys
sorted recursively, no insignificant whitespace) and hashed with SHA-256. The
canonical form is what gets stored, so column and hash always describe the same
document. A retry with a known `clientEventId` and an identical hash, type and
schema version returns the original position untouched; a differing one is a
conflict.

**The log is append-only in the code, not only by convention.** `Event` carries
`BeforeUpdate` and `BeforeDelete` hooks that fail with `ErrEventLogImmutable`.
Corrections and retractions are new events referencing the original, never edits.

**Planned changes never touch the applied model.** `*.change_planned` only
records an `active_changes` row; `*.change_applied` is what mutates `components`
and `relationships`. `architecture.snapshot_published` replaces both sets
wholesale inside the same transaction.

**GORM `AutoMigrate` on startup is the only schema authority.** It runs before
the readiness flag is set, so a failed migration means the backend never reports
ready and the Compose healthcheck never routes to it. There is no SQL migration
engine and no rebuild command in v0.

## Consequences

- Ingestion latency includes the projection work. With one backend instance and
  semantic (not raw) events, the volume is low enough that this is the right
  trade for consistency.
- Write throughput per project is serialised by design. Different projects do
  not contend; parallel agents inside one project queue on the project row and
  receive one comprehensible ordering, which is the stated requirement.
- Adding a projection means changing the projector and re-deriving state is not
  possible from the read models alone — but it is always possible from the log,
  which is why the log stays immutable and complete.
- `AutoMigrate` cannot add a `NOT NULL` column to a populated table without a
  default. Every projection column therefore carries a database default. The
  failure mode is loud rather than silent: the backend refuses to become ready.
- Because projections are written in the same transaction, an SSE publisher can
  safely be triggered *after* commit and never expose an uncommitted event.
