/**
 * A reader for the unified diffs an agent reports.
 *
 * `ReportedDiff.unifiedDiff` is "the unified diff of this one file, exactly as
 * reported" — the backend never parses, splits or merges it. The cockpit shows
 * the same text back, so this module classifies lines and counts them and does
 * nothing else: it never rewrites a line, never reflows it and never drops one
 * it does not recognise. An unparsable diff degrades to a monospace block of
 * context lines rather than to an error, because the reported evidence is worth
 * more than the syntax highlighting on top of it.
 */

/** What one line of a unified diff is. */
export type DiffLineKind =
  /** `+++`, `---`, `diff --git`, `index …`: file level metadata. */
  | 'meta'
  /** `@@ -a,b +c,d @@`: start of a hunk. */
  | 'hunk'
  | 'addition'
  | 'removal'
  /** Unchanged line, shown for orientation. */
  | 'context'

export interface DiffLine {
  kind: DiffLineKind
  /** The line as reported, including its leading marker. */
  content: string
  /** Line number in the original file, `null` for additions and metadata. */
  oldNumber: number | null
  /** Line number in the new file, `null` for removals and metadata. */
  newNumber: number | null
}

export interface ParsedUnifiedDiff {
  lines: DiffLine[]
  additions: number
  removals: number
  /** Path on the `---` side, `null` when none was reported. */
  oldPath: string | null
  /** Path on the `+++` side, `null` when none was reported. */
  newPath: string | null
  /** `true` when the diff creates the file (`--- /dev/null`). */
  isCreation: boolean
  /** `true` when the diff deletes the file (`+++ /dev/null`). */
  isDeletion: boolean
}

const NULL_PATH = '/dev/null'

/** `@@ -12,7 +12,9 @@ optional section heading` */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

const META_PREFIXES = [
  'diff --git ',
  'index ',
  'old mode ',
  'new mode ',
  'new file mode ',
  'deleted file mode ',
  'similarity index ',
  'rename from ',
  'rename to ',
  'copy from ',
  'copy to ',
  'Binary files ',
  'GIT binary patch',
  '\\ No newline at end of file',
]

export function parseUnifiedDiff(unifiedDiff: string): ParsedUnifiedDiff {
  const rawLines = unifiedDiff.split('\n')
  // A diff produced by `git` ends with a newline, which `split` turns into a
  // trailing empty element. Rendering it would add a phantom line to every file.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop()

  const lines: DiffLine[] = []
  let additions = 0
  let removals = 0
  let oldPath: string | null = null
  let newPath: string | null = null
  let oldNumber: number | null = null
  let newNumber: number | null = null

  for (const content of rawLines) {
    // Order matters: `---`/`+++` start with `-`/`+` and are not changed lines.
    if (content.startsWith('--- ')) {
      oldPath = stripPathPrefix(content.slice(4))
      lines.push(meta(content))
      continue
    }
    if (content.startsWith('+++ ')) {
      newPath = stripPathPrefix(content.slice(4))
      lines.push(meta(content))
      continue
    }

    const hunk = HUNK_HEADER.exec(content)
    if (hunk) {
      oldNumber = Number(hunk[1])
      newNumber = Number(hunk[3])
      lines.push(meta(content, 'hunk'))
      continue
    }

    if (META_PREFIXES.some((prefix) => content.startsWith(prefix))) {
      lines.push(meta(content))
      continue
    }

    // Outside a hunk there are no line numbers to assign; treat the line as
    // metadata so a malformed diff still renders instead of throwing.
    if (oldNumber === null || newNumber === null) {
      lines.push(meta(content))
      continue
    }

    if (content.startsWith('+')) {
      additions += 1
      lines.push({ kind: 'addition', content, oldNumber: null, newNumber })
      newNumber += 1
      continue
    }

    if (content.startsWith('-')) {
      removals += 1
      lines.push({ kind: 'removal', content, oldNumber, newNumber: null })
      oldNumber += 1
      continue
    }

    lines.push({ kind: 'context', content, oldNumber, newNumber })
    oldNumber += 1
    newNumber += 1
  }

  return {
    lines,
    additions,
    removals,
    oldPath,
    newPath,
    isCreation: oldPath === NULL_PATH && newPath !== NULL_PATH,
    isDeletion: newPath === NULL_PATH && oldPath !== NULL_PATH,
  }
}

function meta(content: string, kind: 'meta' | 'hunk' = 'meta'): DiffLine {
  return { kind, content, oldNumber: null, newNumber: null }
}

/**
 * Removes git's `a/` and `b/` prefixes but leaves `/dev/null` and any other
 * path alone. A trailing timestamp column, which `diff -u` appends, is dropped.
 */
function stripPathPrefix(path: string): string {
  const withoutTimestamp = path.split('\t')[0] ?? path
  if (withoutTimestamp === NULL_PATH) return NULL_PATH
  return withoutTimestamp.replace(/^[ab]\//, '')
}
