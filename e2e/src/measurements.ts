import { platform, release, arch } from 'node:os'
import type { Browser, TestInfo } from '@playwright/test'
import { COMPOSE_PROJECT, REPO_ROOT, BASE_URL } from './config.js'
import { runCommandOrThrow } from './process.js'

/** Measurements describe this run; no latency threshold or production SLA. */
export async function attachMeasurements(testInfo: TestInfo, browser: Browser, name: string, samplesMs: number[], details: Record<string, unknown>) {
  const sorted = [...samplesMs].sort((a, b) => a - b)
  if (!sorted.length) throw new Error('measurement requires real samples')
  const middle = Math.floor(sorted.length / 2)
  const version = async (args: string[]) => (await runCommandOrThrow('docker', args, { cwd: REPO_ROOT })).stdout.trim()
  const [docker, compose, chromium, fonts] = await Promise.all([
    version(['version', '--format', '{{.Server.Version}}']),
    version(['compose', 'version', '--short']),
    version(['compose', '-p', COMPOSE_PROJECT, 'exec', '-T', 'backend', 'chromium', '--version']),
    version(['compose', '-p', COMPOSE_PROJECT, 'exec', '-T', 'backend', 'fc-match', 'sans-serif']),
  ])
  await testInfo.attach(name, { contentType: 'application/json', body: JSON.stringify({
    samplesMs, sampleCount: sorted.length,
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2,
    minMs: sorted[0], maxMs: sorted.at(-1), ...details,
    conditions: { clock: 'performance.now monotonic', baseURL: BASE_URL, composeProject: COMPOSE_PROJECT,
      host: `${platform()} ${release()} ${arch()}`, node: process.version, docker, compose,
      browser: browser.version(), rendererChromium: chromium, fonts,
      goMcpSdk: '1.7.0', typescriptMcpSdk: '1.30.0', renderer: 'Alpine 3.24, fresh nonroot Chromium per request',
      freshCompose: process.env.E2E_SKIP_COMPOSE !== '1', concurrency: 'one Playwright worker; no external load injected' },
  }, null, 2) })
}
