import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * The guard for catalogue parity.
 *
 * A key missing in one language never shows up at runtime — German answers for
 * it through `fallbackLng` and the English reader silently reads German — so it
 * has to be caught statically. `npm run check:locales` does that; this test
 * runs it, and, as in ADR 0009, it also runs it against deliberately broken
 * catalogues. A check that has only ever been green proves nothing.
 *
 * Vitest runs with the frontend package as its working directory, so the script
 * is resolved from there rather than from `import.meta.url`, which is a
 * transformed module URL inside the jsdom environment.
 */

const FRONTEND_ROOT = process.cwd()
const SCRIPT = resolve(FRONTEND_ROOT, 'scripts/check-locales.mjs')

const temporaryRoots: string[] = []

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
  }
})

/** Runs the checker; returns its output, or the failure it exited with. */
function runCheck(root?: string): { ok: boolean; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...(root ? [root] : [])], {
      cwd: FRONTEND_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { ok: true, output: stdout }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

/** Writes a throw-away catalogue tree and returns its root. */
function catalogues(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'vai-locales-'))
  temporaryRoots.push(root)
  for (const [relative, body] of Object.entries(files)) {
    const file = join(root, relative)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  }
  return root
}

/** A copy of the real catalogues, for tests that then damage one of them. */
function realCatalogues(): string {
  const root = mkdtempSync(join(tmpdir(), 'vai-locales-real-'))
  temporaryRoots.push(root)
  cpSync(resolve(FRONTEND_ROOT, 'src/i18n/locales'), root, { recursive: true })
  return root
}

describe('translation catalogues', () => {
  it('describe the same keys in German and English', () => {
    const { ok, output } = runCheck()

    expect(output).toContain('Translation catalogues agree')
    expect(ok).toBe(true)
  })

  it('cover every namespace, so #42 left none of the four empty', () => {
    const { output } = runCheck()

    // The message names the reference key count. Four namespaces were committed
    // empty in #38; a catalogue set that is still nearly empty would pass every
    // parity check and fail this one.
    const keys = Number(/agree: (\d+) keys/.exec(output)?.[1] ?? 0)
    expect(keys).toBeGreaterThan(200)
  })

  it('turns red when a key of the real catalogues goes missing', () => {
    // The parity check is not just green against a synthetic tree: removing one
    // real key — the label of the agent status the whole cockpit is about —
    // makes it fail and names exactly that key.
    const root = realCatalogues()
    const file = join(root, 'en/agents.json')
    const english = JSON.parse(readFileSync(file, 'utf8')) as {
      status: Record<string, string>
    }
    delete english.status.working
    writeFileSync(file, `${JSON.stringify(english, null, 2)}\n`, 'utf8')

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    expect(output).toContain('missing-key')
    expect(output).toContain('en/agents.json status.working')
  })

  it('turns red when a real translation drops a reported value it interpolates', () => {
    // `{{runId}}` carries reported data into a sentence. An English translation
    // that quietly loses it would drop the run from the empty state and nothing
    // at runtime would say so.
    const root = realCatalogues()
    const file = join(root, 'en/agents.json')
    const english = JSON.parse(readFileSync(file, 'utf8')) as {
      tree: Record<string, string>
    }
    english.tree.emptyDescription = 'No agent.started event has arrived yet.'
    writeFileSync(file, `${JSON.stringify(english, null, 2)}\n`, 'utf8')

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    expect(output).toContain('placeholder-mismatch')
    expect(output).toContain('runId')
  })

  it('turns red when a key is missing in one language', () => {
    const root = catalogues({
      'de/projects.json': { list: { title: 'Projekte', description: 'Beobachtet.' } },
      'en/projects.json': { list: { title: 'Projects' } },
    })

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    expect(output).toContain('missing-key')
    expect(output).toContain('en/projects.json list.description')
  })

  it('turns red when a language carries a key the reference does not', () => {
    const root = catalogues({
      'de/projects.json': { list: { title: 'Projekte' } },
      'en/projects.json': { list: { title: 'Projects', subtitle: 'Left over' } },
    })

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    expect(output).toContain('orphan-key')
    expect(output).toContain('en/projects.json list.subtitle')
  })

  it('turns red when a namespace exists in only one language', () => {
    const root = catalogues({
      'de/projects.json': { list: { title: 'Projekte' } },
      'de/canvas.json': { tool: { fit: 'Einpassen' } },
      'en/projects.json': { list: { title: 'Projects' } },
    })

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    expect(output).toContain('missing-namespace')
    expect(output).toContain('en/canvas.json')
  })

  it('turns red on an empty translation, which would render as nothing at all', () => {
    const root = catalogues({
      'de/projects.json': { list: { title: 'Projekte' } },
      'en/projects.json': { list: { title: '   ' } },
    })

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    expect(output).toContain('empty-value')
    expect(output).toContain('en/projects.json list.title')
  })

  it('turns red when a translation drops an interpolated value', () => {
    const root = catalogues({
      'de/projects.json': { item: { openLabel: 'Projekt {{projectId}} öffnen' } },
      'en/projects.json': { item: { openLabel: 'Open project' } },
    })

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    expect(output).toContain('placeholder-mismatch')
    expect(output).toContain('projectId')
  })
})
