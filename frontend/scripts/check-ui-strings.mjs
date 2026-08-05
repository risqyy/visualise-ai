/**
 * Finds visible UI text that is still hard-coded in the sources.
 *
 *   node scripts/check-ui-strings.mjs            # checks src/
 *   node scripts/check-ui-strings.mjs <dir>      # checks another tree
 *
 * `npm run check:locales` proves that German and English describe the same
 * keys. It cannot prove the thing #42 actually promises — that there is nothing
 * *left* outside the catalogues. A green catalogue check is perfectly
 * compatible with a pane title that never reached a catalogue at all, and that
 * is the failure this script exists to name.
 *
 * ## What is a finding
 *
 * Two rules, deliberately different in strength:
 *
 *   german-literal   A string literal or JSX text containing an umlaut, an "ß",
 *                    or a German function word. German is the product's
 *                    language, so this is close to exhaustive for our own
 *                    wording and it has almost no false positives: identifiers,
 *                    CSS classes and contract values are not German.
 *
 *   jsx-text         Any text node in JSX with two consecutive letters in it.
 *                    This is the strict one and it is the reason the check is
 *                    worth having: after #42 *no* word may sit in the markup,
 *                    whatever language it is in. Separators (`/`, `·`, `+`,
 *                    `−`, `%`, `≈`, `▸`) have no letters and pass.
 *
 *   ui-attribute     A **literal** string passed to an attribute or prop that
 *                    reaches the screen or the accessibility tree —
 *                    `aria-label`, `title`, `placeholder`, `alt`, `label`,
 *                    `emptyTitle`, `emptyDescription`, `description`,
 *                    `closeLabel`, `subject` — that reads like a sentence
 *                    (two or more words). Those are the places an English
 *                    literal hides in a German codebase, where rule one is
 *                    blind.
 *
 * Comments are stripped first: an ADR reference or a German explanation above a
 * function is documentation, not a label.
 *
 * ## What is not a finding
 *
 * `ALLOWED` below is the reasoned exception list the issue asks for. Every
 * entry names a file and why the text in it is *not* UI chrome:
 *
 *   * the catalogues themselves,
 *   * tests and fixtures, which quote the German UI on purpose,
 *   * the technical glossary of `src/i18n/README.md`.
 *
 * The list is per file and per reason, never a blanket suppression: a new
 * German literal in a file that is on the list for one reason still has to be
 * looked at, which is why every entry also carries a `note`.
 *
 * `<dir>` exists so `src/i18n/uiStrings.test.ts` can point the scanner at a
 * deliberately hard-coded file and prove it turns red. A check that has only
 * ever been green proves nothing (ADR 0009, ADR 0014).
 */
import { readFile, readdir } from 'node:fs/promises'
import { argv, exit } from 'node:process'
import { relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOT = fileURLToPath(new URL('../src', import.meta.url))

/** Umlauts and "ß" — the cheapest reliable marker of German text. */
const GERMAN_CHARACTERS = /[äöüÄÖÜß]/

/**
 * German function words. They carry no meaning on their own, which is exactly
 * why they are good markers: no identifier, CSS class or contract value is
 * called `sobald` or `keine`.
 */
const GERMAN_WORDS =
  /\b(der|die|das|dem|den|und|oder|nicht|kein|keine|keinen|eine|einen|einem|ist|sind|wird|werden|wurde|wurden|von|vom|für|mit|auf|aus|zum|zur|noch|sobald|bleibt|bleiben|zeigt|zeigen|gemeldet|angezeigt|Ansicht|Bereich|Komponente|Komponenten|Beziehung|Beziehungen|Aufgabe|Zustand|Änderung|Seite|Fehler|Ereignis|Ereignisse|aktuell|aktuellen|abgeschlossen|ausklappen|einklappen|anzeigen|ausblenden|einblenden)\b/i

/** Props and attributes whose value is read by a user or a screen reader. */
const UI_ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'ariaLabel',
  'title',
  'placeholder',
  'alt',
  'label',
  'emptyTitle',
  'emptyDescription',
  'description',
  'closeLabel',
  'subject',
]

/** `attr="two or more words"` — a sentence, not an id or a CSS class. */
const UI_ATTRIBUTE_LITERAL = new RegExp(
  `\\b(${UI_ATTRIBUTES.join('|')})\\s*=\\s*(?:"([^"]{2,})"|'([^']{2,})'|\\{\\s*(?:"([^"]{2,})"|'([^']{2,})'|\`([^\`$]{2,})\`)\\s*\\})`,
  'g',
)

/** Two words of letters with a space between them. */
const SENTENCE_LIKE = /[A-Za-zÄÖÜäöüß]{2,}\s+[A-Za-zÄÖÜäöüß]{2,}/

/** Two consecutive letters — the cheapest test for "this is a word". */
const HAS_A_WORD = /[A-Za-zÄÖÜäöüß]{2,}/

/**
 * The technical glossary, in executable form.
 *
 * A term listed here may appear literally in the markup **because it is the
 * same token in every language**: it is a field name, a protocol or an
 * identifier of the contract, not a word the cockpit chose. Adding an entry is
 * a decision, which is why each one carries its reason; the prose version of
 * this list is the glossary in `src/i18n/README.md`.
 */
const TECHNICAL_TERMS = new Map([
  ['changeId', 'Contract field name of a reported change; shown as itself.'],
])

/**
 * The reasoned exceptions. Anything not listed here has to go through `t()`.
 *
 * `paths` are matched as prefixes against the POSIX path relative to the scan
 * root, so a directory covers everything below it.
 */
const ALLOWED = [
  {
    paths: ['i18n/locales/'],
    rules: ['german-literal', 'jsx-text', 'ui-attribute'],
    note: 'The catalogues. This is where the German belongs.',
  },
  {
    paths: ['i18n/README.md'],
    rules: ['german-literal', 'jsx-text', 'ui-attribute'],
    note: 'Documentation, including the technical glossary.',
  },
  {
    paths: ['test/'],
    rules: ['german-literal', 'jsx-text', 'ui-attribute'],
    note: 'Contract-shaped fixtures. They quote reported German project data — an assigned task, a feedback body, a work-step title — which must stay German in the English UI.',
  },
  {
    paths: ['components/workspace/runAgents/reporting.ts'],
    rules: ['german-literal'],
    note: 'Prose in the module doc that quotes the German label a key resolves to. No literal reaches the screen from here.',
  },
]

/** File extensions that can carry UI text. */
const EXTENSIONS = ['.ts', '.tsx']

/** Test files quote the UI on purpose; they are checked by their assertions. */
function isTestFile(path) {
  return /\.test\.tsx?$/.test(path) || path.startsWith('test/')
}

async function sourceFiles(root, prefix = '') {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(root, path)))
    } else if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      files.push(path)
    }
  }
  return files
}

/**
 * Replaces comments with spaces of the same length, so line and column numbers
 * survive. A German sentence explaining a decision is documentation; the point
 * of this repository is that there is a lot of it.
 */
function stripComments(source) {
  let output = ''
  let index = 0
  const blank = (text) => text.replace(/[^\n]/g, ' ')

  while (index < source.length) {
    const character = source[index]
    const next = source[index + 1]

    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2
      output += blank(source.slice(index, stop))
      index = stop
      continue
    }
    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      const stop = end === -1 ? source.length : end
      output += blank(source.slice(index, stop))
      index = stop
      continue
    }
    // Skip over string bodies so a `//` inside a URL is not read as a comment.
    if (character === '"' || character === "'" || character === '`') {
      let cursor = index + 1
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2
          continue
        }
        if (source[cursor] === character) break
        cursor += 1
      }
      output += source.slice(index, Math.min(cursor + 1, source.length))
      index = cursor + 1
      continue
    }
    output += character
    index += 1
  }
  return output
}

/**
 * Blanks the module specifier of an `import`/`export … from '…'`.
 *
 * A package name is not UI text, and `zustand` is a German word.
 */
function stripModuleSpecifiers(source) {
  return source.replace(
    /((?:^|\n)\s*(?:import|export)\b[^\n;]*?\bfrom\s*)(["'])((?:\\.|(?!\2).)*)\2/g,
    (_all, head, quote, specifier) => `${head}${quote}${' '.repeat(specifier.length)}${quote}`,
  )
}

/**
 * Characters that mean "this is code, not a text node".
 *
 * `>` and `<` also close and open a TypeScript generic, so a naive scan reads
 * `new Map<A, B>()\n  const x = new Set<` as a text node. Requiring the segment
 * to be free of operators and brackets removes every one of those, and no
 * rendered sentence in this cockpit contains them either.
 */
const CODE_CHARACTERS = /[=;(){}[\]|&"'`]/

/**
 * A statement between a `</>` and the next element is code as well — the gap
 * between two `return <…/>` branches has no operator in it.
 */
const CODE_KEYWORD =
  /^(return|const|let|var|if|else|for|while|function|export|import|await|new|delete|throw|case|default|break|continue|do|try|catch|finally|typeof|instanceof|as|satisfies)\b/

/** JSX text nodes: what sits between `>` and `<` on the rendered side. */
function jsxTextNodes(source) {
  const found = []
  const pattern = />([^<>{}]+)</g
  let match
  while ((match = pattern.exec(source)) !== null) {
    const text = match[1]
    if (text.trim().length === 0) continue
    if (CODE_CHARACTERS.test(text)) continue
    if (CODE_KEYWORD.test(text.trim())) continue
    found.push({ text, index: match.index + 1 })
  }
  return found
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

function isAllowed(path, rule) {
  return ALLOWED.some(
    (entry) =>
      entry.rules.includes(rule) &&
      entry.paths.some((prefix) => path === prefix || path.startsWith(prefix)),
  )
}

function looksGerman(text) {
  return GERMAN_CHARACTERS.test(text) || GERMAN_WORDS.test(text)
}

async function scanFile(root, path) {
  const raw = await readFile(join(root, path), 'utf8')
  const source = stripModuleSpecifiers(stripComments(raw))
  const findings = []

  const report = (rule, index, text) => {
    if (isAllowed(path, rule)) return
    findings.push({ rule, path, line: lineOf(source, index), text: text.trim() })
  }

  // Rule one — German, wherever it appears outside a comment.
  if (!isAllowed(path, 'german-literal')) {
    const literals = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g
    let match
    while ((match = literals.exec(source)) !== null) {
      if (looksGerman(match[2])) report('german-literal', match.index, match[2])
    }
    for (const node of jsxTextNodes(source)) {
      if (looksGerman(node.text)) report('german-literal', node.index, node.text)
    }
  }

  // Rule two — any word left in the markup, in any language. Only `.tsx`
  // carries markup; in a `.ts` file every `>…<` is a generic.
  if (path.endsWith('.tsx') && !isAllowed(path, 'jsx-text')) {
    for (const node of jsxTextNodes(source)) {
      const text = node.text.trim()
      if (!HAS_A_WORD.test(text)) continue
      if (TECHNICAL_TERMS.has(text)) continue
      // Rule one already named the German ones; do not say it twice.
      if (looksGerman(text) && !isAllowed(path, 'german-literal')) continue
      report('jsx-text', node.index, text)
    }
  }

  // Rule three — a sentence handed to a prop that reaches the screen.
  let attribute
  while ((attribute = UI_ATTRIBUTE_LITERAL.exec(source)) !== null) {
    const value = attribute.slice(2).find((group) => group !== undefined) ?? ''
    if (!SENTENCE_LIKE.test(value)) continue
    // A German one is already reported by rule one; do not say it twice.
    if (looksGerman(value) && !isAllowed(path, 'german-literal')) continue
    report('ui-attribute', attribute.index, `${attribute[1]}="${value}"`)
  }

  return findings
}

const root = argv[2] ?? DEFAULT_ROOT
const files = (await sourceFiles(root)).filter((path) => !isTestFile(path))
const findings = []
for (const path of files) {
  findings.push(...(await scanFile(root, path)))
}

if (findings.length > 0) {
  console.error(`Hard-coded UI text outside the catalogues (${findings.length}):`)
  for (const finding of findings) {
    console.error(
      `  ${finding.rule.padEnd(16)} ${finding.path}:${finding.line}  ${JSON.stringify(
        finding.text.slice(0, 90),
      )}`,
    )
  }
  console.error(
    '\nEvery visible text belongs in src/i18n/locales. If it is reported project\n' +
      'data or a deliberately untranslated technical term, render it through\n' +
      '<ReportedText> and record it in the glossary of src/i18n/README.md — or, if\n' +
      'a whole file is an exception, add it to ALLOWED in this script with a reason.',
  )
  exit(1)
}

console.log(
  `No hard-coded UI text: ${files.length} files scanned in ${relative(process.cwd(), root) || root}, ` +
    `${ALLOWED.length} reasoned exceptions.`,
)
