import {
  composeDown,
  composeUp,
  ensureSimulatorDependencies,
  waitForReady,
} from './compose.js'
import { BASE_URL, COMPOSE_PROJECT, FRONTEND_HTTP_PORT, SKIP_COMPOSE } from './config.js'

/**
 * Brings the system under test up before the first test.
 *
 * `down -v` → `up --build -d` → wait for `/readyz` through Nginx. The volume is
 * removed first on purpose: issue #14 requires the acceptance run to start from
 * an **empty PostgreSQL database**, and the simulator's scenarios only prove
 * what they claim against one.
 */
export default async function globalSetup(): Promise<void> {
  const started = Date.now()
  process.stdout.write(
    `\n[e2e] compose project ${COMPOSE_PROJECT}, frontend on port ${FRONTEND_HTTP_PORT}, base ${BASE_URL}\n`,
  )

  await ensureSimulatorDependencies()

  if (SKIP_COMPOSE) {
    process.stdout.write('[e2e] E2E_SKIP_COMPOSE=1 — reusing the running stack\n')
  } else {
    process.stdout.write('[e2e] docker compose down -v (start from an empty database)\n')
    await composeDown()
    process.stdout.write('[e2e] docker compose up --build -d\n')
    await composeUp()
  }

  await waitForReady()
  process.stdout.write(
    `[e2e] deployment ready after ${((Date.now() - started) / 1000).toFixed(1)} s\n\n`,
  )
}
