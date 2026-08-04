# 3. Frontend state split and live updates that never disturb the user

- **Status:** accepted
- **Date:** 2026-08-04
- **Context issue:** #7 (part of the v0 epic #1)
- **Builds on:** [0002 — Event log with synchronous projections](./0002-event-log-with-synchronous-projections.md)

## Context

The cockpit is watched while an agent works. Events arrive continuously and
unpredictably, and the user is reading a diff or inspecting a component while
they do. A live update that steals focus, resets the camera or drops the
selection makes the tool unusable exactly when it matters.

At the same time the UI must survive a flaky connection: a dropped SSE stream is
normal, not exceptional.

## Decision

**Three kinds of state, kept strictly apart.**

| Kind | Owner | Examples |
| --- | --- | --- |
| Server state | TanStack Query | architecture, runs, agents, plans, inspector data |
| Live connection state | a small dedicated store | `live` / `reconnecting` / `offline` |
| Local UI state | Zustand, persisted to `localStorage` | selection, zoom, camera, pane sizes, collapse, temporary node positions |

Local UI state never enters the query cache and is never written back into the
domain model. Temporary node dragging is explicitly local and non-persistent in
the domain sense — the architecture model is what the agent reported, not what
the user moved.

**Live events invalidate narrowly, never globally.** A central query-key factory
is the single source of cache keys, and every event type maps to the specific
keys it affects: `component.change_applied` touches the architecture and the
inspector of the components it names; `agent.progress_reported` touches only the
agent tree of its run. There is no `invalidateQueries()` without arguments
anywhere in the codebase. Two event types (`work.step_completed`,
`retraction.issued`) do not name their target in a typed way and therefore
invalidate a deliberately wider scope, documented at the call site.

**A broken stream never destroys loaded state.** Connection failures change the
connection store, not the query cache. The user keeps looking at the last known
good snapshot with an explicit "reconnecting" indicator, instead of watching the
screen empty itself. `projectPosition` travels in every read response so a
reconnect can be reconciled against the SSE cursor deterministically.

**Work states are defined once, in three channels.** `src/state/workStates.ts`
is the single definition of `planned` / `active` / `recently_applied` /
`removed`. Each state carries a label, an icon and a line style in addition to
its colour, so the information survives greyscale and colour vision deficiency.
The module also carries the disclaimer that colour encodes a *phase of work* and
never quality, risk or correctness — the cockpit does not judge the agent's work.
The canvas overlays (#10), the agent tree (#11) and the inspector (#12) all read
this module, so a state cannot drift between panes.

**Routing is code-based, not file-based.** TanStack Router is configured without
the file-based route generator, so the container build has no codegen step and
stays deterministic. Selection lives in validated search params
(`component`, `focus`, `history`), which makes every view directly linkable and
keeps deep links honest.

## Consequences

- Adding an event type means adding its entry to the event → query-key map.
  Forgetting it produces a stale pane rather than a wrong one, and a test covers
  the mapping.
- Because UI state is persisted, layout changes must be migrated carefully. The
  deep-focus split is deliberately excluded from persistence: a reload must not
  restore a focus mode the URL no longer asks for.
- The bundle exceeds Vite's 500 kB warning threshold. For a desktop cockpit
  served by Nginx on a local network this is acceptable; code splitting becomes
  worthwhile once React Flow and ELK land in #9.
- The read API this layer talks to is specified but not yet implemented (#8).
  The typed contract in `src/api/types.ts` is derived from `api/openapi.yaml`
  and must be reviewed against the server implementation when #8 lands.
