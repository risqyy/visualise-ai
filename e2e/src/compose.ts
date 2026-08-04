import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  BASE_URL,
  COMPOSE_PROJECT,
  FRONTEND_HTTP_PORT,
  REPO_ROOT,
  SIMULATOR_DIR,
} from './config.js'
import { runCommand, runCommandOrThrow } from './process.js'

/**
 * Lifecycle of the system under test.
 *
 * The acceptance test runs against the real Compose deployment — the Nginx
 * frontend, the Go backend and PostgreSQL, built from this checkout — and never
 * against a mock or a dev server. A mocked backend would assert that the tests
 * agree with the tests; only the built stack can show that the contract, the
 * projections, the stream and the bundle actually fit together.
 *
 * The stack always starts from an **empty database** (`down -v` before `up`),
 * because the simulator's scenarios are written for one: they assert
 * `201 created`, and against a populated database the first delivery would
 * legitimately be a duplicate.
 */

function composeArgs(...args: string[]): string[] {
  return ['compose', '-p', COMPOSE_PROJECT, ...args]
}

const composeEnv = {
  ...process.env,
  FRONTEND_HTTP_PORT,
  // Keep Compose from picking up a stray COMPOSE_PROJECT_NAME of the shell.
  COMPOSE_PROJECT_NAME: COMPOSE_PROJECT,
}

/** `docker compose down -v` — removes containers, network and the pgdata volume. */
export async function composeDown(): Promise<void> {
  await runCommand('docker', composeArgs('down', '-v', '--remove-orphans'), {
    cwd: REPO_ROOT,
    env: composeEnv,
    echo: true,
    label: 'compose down',
  })
}

/** `docker compose up --build -d`. */
export async function composeUp(): Promise<void> {
  await runCommandOrThrow(
    'docker',
    composeArgs('up', '--build', '-d', '--wait', '--wait-timeout', '300'),
    {
      cwd: REPO_ROOT,
      env: composeEnv,
      echo: true,
      label: 'compose up',
    },
  )
}

/** Dumps the logs of every service. Used when startup fails. */
export async function composeLogs(tail = '200'): Promise<string> {
  const result = await runCommand('docker', composeArgs('logs', '--tail', tail), {
    cwd: REPO_ROOT,
    env: composeEnv,
  })
  return `${result.stdout}\n${result.stderr}`
}

/**
 * Waits until the deployment answers as ready **through Nginx**.
 *
 * `/readyz` is the backend's own readiness probe (startup finished *and*
 * PostgreSQL answers) and `/` is the served bundle, so both halves of the entry
 * point are covered before a single test runs.
 */
export async function waitForReady(timeoutMs = 240_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastFailure = 'no attempt made'

  for (;;) {
    try {
      const ready = await fetch(`${BASE_URL}/readyz`)
      if (ready.status === 200) {
        const index = await fetch(`${BASE_URL}/`)
        if (index.status === 200) return
        lastFailure = `GET / answered ${index.status}`
      } else {
        lastFailure = `GET /readyz answered ${ready.status}`
      }
    } catch (cause) {
      lastFailure = cause instanceof Error ? cause.message : String(cause)
    }

    if (Date.now() > deadline) {
      throw new Error(
        `the deployment did not become ready on ${BASE_URL} within ${timeoutMs} ms ` +
          `(last: ${lastFailure})\n\n${await composeLogs()}`,
      )
    }
    await new Promise((wake) => setTimeout(wake, 1000))
  }
}

/**
 * Installs the simulator's dependencies when they are missing.
 *
 * Keeps the documented one-command start honest: `cd e2e && npm install &&
 * npx playwright install chromium && npm test` must work in a fresh checkout,
 * and the suite cannot report a run without the simulator that produces it.
 */
export async function ensureSimulatorDependencies(): Promise<void> {
  if (existsSync(resolve(SIMULATOR_DIR, 'node_modules', 'tsx'))) return
  await runCommandOrThrow('npm', ['ci'], {
    cwd: SIMULATOR_DIR,
    echo: true,
    label: 'simulator npm ci',
    shell: process.platform === 'win32',
  })
}
