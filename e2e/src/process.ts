import { spawn, type SpawnOptions } from 'node:child_process'

/** Result of a finished child process. */
export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface RunCommandOptions extends SpawnOptions {
  /** Mirrors the child's output onto this process, prefixed. Default `false`. */
  echo?: boolean
  /** Prefix used when `echo` is on. */
  label?: string
}

/**
 * Runs a command to completion and captures its output.
 *
 * `shell` stays off everywhere in this suite: every argument is passed as an
 * array element, so a project id or a URL can never be re-parsed by a shell.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const { echo = false, label = command, ...spawnOptions } = options

  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      ...spawnOptions,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      if (echo) process.stdout.write(prefix(label, chunk))
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
      if (echo) process.stdout.write(prefix(label, chunk))
    })

    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/** Runs a command and rejects unless it exited `0`. */
export async function runCommandOrThrow(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const result = await runCommand(command, args, options)
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${String(result.code)}\n` +
        `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    )
  }
  return result
}

function prefix(label: string, chunk: string): string {
  return chunk
    .split('\n')
    .map((line, index, lines) =>
      index === lines.length - 1 && line === '' ? line : `[${label}] ${line}`,
    )
    .join('\n')
}
