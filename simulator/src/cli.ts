/**
 * Entry point.
 *
 * `npm run simulate -- --help` prints the option list; every other invocation
 * builds a scenario, validates it against the contract and sends it to
 * `<base>/api/v1/events`.
 */
import { ContractViolationError, loadContract } from './contract.js'
import { OptionsError, parseOptions, USAGE } from './options.js'
import { buildScenario } from './scenarios/index.js'
import { RunAbortedError, runScenario } from './runner.js'

async function main(): Promise<number> {
  let options
  try {
    options = parseOptions(process.argv.slice(2))
  } catch (error) {
    if (error instanceof OptionsError) {
      process.stderr.write(`${error.message}\n\n${USAGE}\n`)
      return 2
    }
    throw error
  }

  if (options === null) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  const contract = loadContract()
  const scenario = buildScenario(options)

  const summary = await runScenario(scenario, contract, {
    baseUrl: options.baseUrl,
    speed: options.speed,
    quietStdout: options.json,
  })

  if (options.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  }

  return 0
}

try {
  process.exitCode = await main()
} catch (error) {
  if (error instanceof ContractViolationError || error instanceof RunAbortedError) {
    process.stderr.write(`\nsimulator aborted: ${error.message}\n`)
    process.exitCode = 1
  } else {
    throw error
  }
}
