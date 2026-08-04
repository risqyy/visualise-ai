import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Everything the acceptance test needs to know about *where* the system under
 * test runs. Nothing here describes what is asserted — that lives in `tests/`.
 *
 * Port and Compose project name are environment variables with defaults, so the
 * same test runs unchanged on a developer machine whose 8080 is taken and on a
 * CI runner where it is free.
 */

const here = dirname(fileURLToPath(import.meta.url))

/** Repository root — the directory that holds `docker-compose.yml`. */
export const REPO_ROOT = resolve(here, '..', '..')
export const SIMULATOR_DIR = resolve(REPO_ROOT, 'simulator')

/**
 * Host port the Nginx frontend is published on.
 *
 * The default is **8100**, not 8080: 8080–8083 are frequently occupied by other
 * local projects, and a mandatory acceptance test that fails because of a
 * foreign port collision proves nothing. CI (and any machine with a free 8080)
 * sets `FRONTEND_HTTP_PORT=8080`.
 */
export const FRONTEND_HTTP_PORT = process.env.FRONTEND_HTTP_PORT ?? '8100'

/**
 * Compose project name. Own namespace by default, so the acceptance stack can
 * never reuse, restart or `down -v` the containers, network or volume of a
 * development stack started from the same `docker-compose.yml`.
 */
export const COMPOSE_PROJECT = process.env.E2E_COMPOSE_PROJECT ?? 'vai-e2e'

/** The single external entry point. Every request of this suite goes here. */
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${FRONTEND_HTTP_PORT}`

/**
 * Skips `docker compose down -v` / `up --build` and runs against a stack that is
 * already up. A debugging convenience only — it is never set in CI, and it
 * fails safe: the simulator scenarios assert `201 created`, so a non-empty
 * database aborts the run loudly instead of passing vacuously.
 */
export const SKIP_COMPOSE = process.env.E2E_SKIP_COMPOSE === '1'

/** Leaves the stack running after the suite, for post-mortem inspection. */
export const KEEP_STACK = process.env.E2E_KEEP_STACK === '1'

/** Mandatory acceptance resolution (epic #1, issue #14). */
export const ACCEPTANCE_VIEWPORT = { width: 1920, height: 1080 } as const

// ---------------------------------------------------------------------------
// Projects the suite reports under
// ---------------------------------------------------------------------------

/**
 * The representative run. This is the simulator's own default project, so what
 * the acceptance test looks at is exactly what `npm run simulate` produces.
 */
export const MAIN_PROJECT = 'visualise-ai'
export const MAIN_RUN = 'run-2026-08-04-0001'

/**
 * A second, empty run opened in the same project *before* the representative
 * one.
 *
 * It exists for two reasons, both of them about determinism:
 *
 * 1. A stream opened for a project that does not exist yet is answered `404`
 *    (the project row is created by the first event). Opening the workspace
 *    before the simulator starts would therefore leave the cockpit reconnecting
 *    with exponential backoff and racing the first events. With this run the
 *    project exists, the SSE connection is `live` before event one, and every
 *    live state of check 3 is observed rather than hoped for.
 * 2. It gives the run/history separation of check 6 a genuine historical run to
 *    switch to. The representative run opens afterwards and becomes the
 *    project's current run (`projects.current_run_id` follows the last root
 *    orchestrator), so the historical banner is real state, not a fixture.
 */
export const MAIN_BOOTSTRAP_RUN = 'run-e2e-bootstrap'
export const MAIN_BOOTSTRAP_AGENT = 'e2e-bootstrap-orchestrator'

/** Ingestion validation and idempotency probe — its own project. */
export const VALIDATION_PROJECT = 'visualise-ai-validation'
export const VALIDATION_RUN = 'run-e2e-validation'
export const VALIDATION_AGENT = 'e2e-validation-orchestrator'

/** The simulator's own idempotency and conflict projects. */
export const RETRY_PROJECT = 'visualise-ai-retry'
export const CONFLICT_PROJECT = 'visualise-ai-conflict'

/**
 * Forced-disconnect replay probe. A project of its own so the cut, the reconnect
 * and the position arithmetic cannot be disturbed by, or disturb, the browser
 * stream of the representative project.
 */
export const REPLAY_PROJECT = 'visualise-ai-replay'
export const REPLAY_BOOTSTRAP_RUN = 'run-e2e-replay-bootstrap'
export const REPLAY_BOOTSTRAP_AGENT = 'e2e-replay-bootstrap-orchestrator'
