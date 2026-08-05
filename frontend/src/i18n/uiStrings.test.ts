import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * The guard for the *other* half of #42.
 *
 * `check:locales` proves German and English describe the same keys. It says
 * nothing about what never reached a catalogue in the first place — a pane
 * title left in the markup is invisible to it, and the two catalogues stay
 * perfectly in agreement while the screen is half German.
 *
 * `npm run check:ui-strings` answers that question instead, and this test does
 * to it what `catalogues.test.ts` does to the catalogue check: it runs it
 * against the real sources **and** against deliberately broken ones, one per
 * rule. A check that has only ever been green proves nothing (ADR 0009).
 */

const FRONTEND_ROOT = process.cwd()
const SCRIPT = resolve(FRONTEND_ROOT, 'scripts/check-ui-strings.mjs')

const temporaryRoots: string[] = []

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
  }
})

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

/** Writes a throw-away source tree and returns its root. */
function sources(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'vai-ui-strings-'))
  temporaryRoots.push(root)
  for (const [relative, body] of Object.entries(files)) {
    const file = join(root, relative)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body, 'utf8')
  }
  return root
}

describe('hard-coded UI text', () => {
  it('is gone from the application sources', () => {
    const { ok, output } = runCheck()

    expect(output).toContain('No hard-coded UI text')
    expect(ok).toBe(true)
  })

  it('turns red on a German literal in the markup', () => {
    const root = sources({
      'Pane.tsx': [
        'export function Pane() {',
        '  return <h2 className="pane-heading">Architektur</h2>',
        '}',
      ].join('\n'),
    })

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    // "Architektur" carries no umlaut and no German function word, so the
    // German rule is blind to it — the strict "no word in the markup" rule is
    // what catches it, and that is why the strict rule exists.
    expect(output).toContain('jsx-text')
    expect(output).toContain('Pane.tsx:2')
    expect(output).toContain('Architektur')
  })

  it('leaves a separator between two elements alone', () => {
    const root = sources({
      'Breadcrumb.tsx': [
        'export function Breadcrumb() {',
        '  return (',
        '    <nav>',
        '      <span>{a}</span> / <span>{b}</span> · <span>{c}</span>',
        '    </nav>',
        '  )',
        '}',
      ].join('\n'),
    })

    const { ok } = runCheck(root)

    expect(ok).toBe(true)
  })

  it('allows a contract field name that is listed in the technical glossary', () => {
    // `changeId` is the same token in both languages; it is a `<Trans>` slot in
    // `DiffGroupList`, and the script's TECHNICAL_TERMS records why.
    const root = sources({
      'Diff.tsx': ['export function Diff() {', '  return <code>changeId</code>', '}'].join(
        '\n',
      ),
    })

    const { ok } = runCheck(root)

    expect(ok).toBe(true)
  })

  it('turns red on a German sentence in an accessible name', () => {
    const root = sources({
      'Toggle.tsx': [
        'export function Toggle() {',
        '  return <button aria-label="Inspector einklappen" />',
        '}',
      ].join('\n'),
    })

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    expect(output).toContain('Toggle.tsx:2')
  })

  it('turns red on an English literal, which the German rule cannot see', () => {
    const root = sources({
      'Dialog.tsx': [
        'export function Dialog() {',
        '  return <span aria-label="Close this dialog" />',
        '}',
      ].join('\n'),
    })

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    expect(output).toContain('ui-attribute')
    expect(output).toContain('Close this dialog')
  })

  it('leaves German prose in comments and doc blocks alone', () => {
    // Every decision in this repository is written down, a lot of it in German
    // quotation. Documentation is not a label, and a checker that cannot tell
    // the two apart gets switched off within a week.
    const root = sources({
      'Documented.tsx': [
        '/**',
        ' * Der Bereich zeigt die gemeldete Architektur und ändert sie nicht.',
        ' */',
        '// Keine Komponente ausgewählt — das ist ein Kommentar.',
        'export const DOCUMENTED = true',
      ].join('\n'),
    })

    const { ok, output } = runCheck(root)

    expect(output).toContain('No hard-coded UI text')
    expect(ok).toBe(true)
  })

  it('leaves the catalogues and the fixtures alone', () => {
    const root = sources({
      // The catalogue is where the German belongs.
      'i18n/locales/de/canvas.ts': 'export const TITLE = "Architektur"',
      // Fixtures quote reported German project data on purpose — an assigned
      // task, a feedback body — which must stay German in the English UI.
      'test/fixtures.ts': 'export const TASK = "Koordiniert den Run."',
    })

    const { ok, output } = runCheck(root)

    expect(output).toContain('No hard-coded UI text')
    expect(ok).toBe(true)
  })

  it('would have caught the accessible names the canvas used to hard-code', () => {
    // The regression this rule exists for: #35 shipped `CANVAS_A11Y_TEXT` with
    // German scaffolding around an already-localised count, on purpose and
    // documented — and it is the kind of thing that survives a green catalogue
    // check indefinitely, because both catalogues agree about keys that were
    // never written.
    const root = sources({
      'canvas/canvasAccessibility.ts': [
        'export const TEXT = {',
        '  contains: (components: string) => `Container mit ${components}`,',
        '  noWorkState: "kein Änderungsstatus gemeldet",',
        '}',
      ].join('\n'),
    })

    const { ok, output } = runCheck(root)

    expect(ok).toBe(false)
    expect(output).toContain('german-literal')
    expect(output).toContain('kein Änderungsstatus gemeldet')
  })

  it('does not mistake a package name for German text', () => {
    // `zustand` is a German word and the state library this cockpit uses.
    const root = sources({
      'store.ts': ['import { create } from "zustand"', 'export const use = create'].join('\n'),
    })

    const { ok } = runCheck(root)

    expect(ok).toBe(true)
  })
})
