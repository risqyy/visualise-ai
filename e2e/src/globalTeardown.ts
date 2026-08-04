import { composeDown } from './compose.js'
import { KEEP_STACK, SKIP_COMPOSE } from './config.js'

/**
 * Takes the stack down again, volume included.
 *
 * Leaving `pgdata` behind would make the next acceptance run start from a
 * populated database, and a populated database silently changes what the
 * simulator's scenarios prove.
 */
export default async function globalTeardown(): Promise<void> {
  if (KEEP_STACK || SKIP_COMPOSE) {
    process.stdout.write('\n[e2e] leaving the stack up (E2E_KEEP_STACK / E2E_SKIP_COMPOSE)\n')
    return
  }
  process.stdout.write('\n[e2e] docker compose down -v\n')
  await composeDown()
}
