import { availableParallelism } from 'node:os'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The production bundle is served by Nginx from the frontend container.
// `vite dev` proxies to the backend so local development uses the same paths
// as the Compose deployment.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/healthz': 'http://localhost:8080',
      '/readyz': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],

    /**
     * The heaviest tests here render the **real** application — router, query
     * client, React Flow and a full ELK layout — inside jsdom. On an idle
     * machine the slowest of them costs about 1.5 s; Vitest's default budget of
     * 5 s therefore looked generous and was not, because the cost is CPU time
     * and the wall time it turns into depends on what else the machine is
     * doing.
     *
     * The canvas files already say what they think they need:
     * `CANVAS_TIMEOUT = 15_000` on their `waitFor` calls. Those numbers were
     * never reachable — a `waitFor` cannot outlive the test that awaits it, so
     * the 5 s default silently overruled every one of them, and the suite
     * reported "timed out in 5000ms" for work that had 1.5 s of actual
     * substance in it.
     *
     * 20 s is the file-level intention plus room for the assertion around it.
     * It is not a licence to wait: nothing in this suite waits for an event
     * that may never arrive, and a test that really hangs still fails — 15 s
     * later, with the same message.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,

    /**
     * Vitest defaults to one worker per core. Each worker is a fork with its
     * own jsdom, its own React and its own ELK, and on a 22-core machine 21 of
     * them do not run 21 tests in the time of one — they run each other into
     * the ground. Measured over the whole suite on such a machine:
     *
     * | max forks | wall  | test CPU | jsdom setup |
     * | --------- | ----- | -------- | ----------- |
     * | 21 (default) | 24 s | 135 s | 130 s |
     * | 12        | 30 s  | 143 s   | 90 s  |
     * |  6        | 34 s  |  80 s   |  55 s |
     * |  4        | 44 s  |  64 s   |  51 s |
     *
     * Ten seconds of wall time buy back 40 % of the CPU time each individual
     * test needs, and it is the *individual* test that has a deadline. Under a
     * loaded machine the uncapped run took 945 s of test CPU and failed 46
     * tests; that is the failure this cap removes.
     *
     * The cap is an upper bound, not a floor: a CI runner with four cores keeps
     * the three workers it would have chosen anyway, so nothing about CI
     * changes.
     */
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: Math.max(2, Math.min(6, availableParallelism() - 1)),
      },
    },
  },
})
