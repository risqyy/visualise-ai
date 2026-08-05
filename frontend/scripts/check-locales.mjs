/**
 * Compares the translation catalogues of every language against the reference
 * language.
 *
 *   node scripts/check-locales.mjs            # checks src/i18n/locales
 *   node scripts/check-locales.mjs <dir>      # checks another root
 *
 * A key that is missing in *one* language never shows up at runtime: German
 * answers for it through `fallbackLng`, so the screen stays readable and the
 * English user silently reads German. That is exactly the kind of defect a
 * running application cannot report, so it is checked statically instead.
 *
 * Four findings, all of them failures:
 *
 *   missing-namespace     a namespace file exists in one language only
 *   missing-key           the reference has a key the language does not
 *   orphan-key            the language has a key the reference does not
 *   empty-value           a translation is empty or only whitespace
 *   placeholder-mismatch  the two texts interpolate different values
 *
 * `empty-value` is a failure and not a warning on purpose: an empty string is
 * the one broken translation nobody notices, because it renders as nothing at
 * all instead of as something obviously wrong.
 *
 * The `<dir>` argument exists so `src/i18n/catalogues.test.ts` can point the
 * checker at a deliberately broken catalogue and prove it turns red. A check
 * that has only ever been green proves nothing (ADR 0009).
 */
import { readFile, readdir } from 'node:fs/promises'
import { argv, exit } from 'node:process'
import { fileURLToPath } from 'node:url'

/** German is the source language: a key exists once it exists in German. */
const REFERENCE_LANGUAGE = 'de'

const DEFAULT_ROOT = fileURLToPath(new URL('../src/i18n/locales', import.meta.url))

/** `{{name}}` and `{{name, format}}` — the interpolations i18next expands. */
const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g

/** Reads every `<root>/<language>/<namespace>.json` into a nested object. */
async function readCatalogues(root) {
  const languages = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const catalogues = {}
  for (const language of languages) {
    const files = (await readdir(`${root}/${language}`)).filter((name) =>
      name.endsWith('.json'),
    )
    const namespaces = {}
    for (const file of files.sort()) {
      namespaces[file.slice(0, -'.json'.length)] = JSON.parse(
        await readFile(`${root}/${language}/${file}`, 'utf8'),
      )
    }
    catalogues[language] = namespaces
  }
  return catalogues
}

/** Flattens a catalogue into `dotted.key -> string` pairs. */
function flatten(value, prefix = '', into = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, path, into)
    } else {
      into.set(path, String(child))
    }
  }
  return into
}

function placeholders(text) {
  return [...text.matchAll(PLACEHOLDER)]
    .map((match) => match[1].split(',')[0].trim())
    .sort()
}

/** Every difference between the reference language and the others. */
function compareCatalogues(catalogues, reference = REFERENCE_LANGUAGE) {
  const findings = []
  const referenceCatalogue = catalogues[reference]
  if (!referenceCatalogue) {
    return [{ kind: 'missing-namespace', language: reference, namespace: '*', key: '' }]
  }

  for (const [language, catalogue] of Object.entries(catalogues)) {
    if (language === reference) continue

    for (const namespace of Object.keys(referenceCatalogue)) {
      if (!(namespace in catalogue)) {
        findings.push({ kind: 'missing-namespace', language, namespace, key: '' })
      }
    }
    for (const namespace of Object.keys(catalogue)) {
      if (!(namespace in referenceCatalogue)) {
        findings.push({
          kind: 'missing-namespace',
          language: reference,
          namespace,
          key: '',
        })
      }
    }

    for (const [namespace, referenceEntries] of Object.entries(referenceCatalogue)) {
      if (!(namespace in catalogue)) continue
      const expected = flatten(referenceEntries)
      const actual = flatten(catalogue[namespace])

      for (const [key, expectedText] of expected) {
        const actualText = actual.get(key)
        if (actualText === undefined) {
          findings.push({ kind: 'missing-key', language, namespace, key })
          continue
        }
        const expectedNames = placeholders(expectedText)
        const actualNames = placeholders(actualText)
        if (expectedNames.join('|') !== actualNames.join('|')) {
          findings.push({
            kind: 'placeholder-mismatch',
            language,
            namespace,
            key,
            detail: `${reference} interpolates [${expectedNames}], ${language} interpolates [${actualNames}]`,
          })
        }
      }

      for (const key of actual.keys()) {
        if (!expected.has(key)) {
          findings.push({ kind: 'orphan-key', language, namespace, key })
        }
      }
    }
  }

  for (const [language, catalogue] of Object.entries(catalogues)) {
    for (const [namespace, entries] of Object.entries(catalogue)) {
      for (const [key, text] of flatten(entries)) {
        if (text.trim() === '') {
          findings.push({ kind: 'empty-value', language, namespace, key })
        }
      }
    }
  }

  return findings
}

function describe(finding) {
  const location = finding.key
    ? `${finding.language}/${finding.namespace}.json ${finding.key}`
    : `${finding.language}/${finding.namespace}.json`
  return `  ${finding.kind.padEnd(20)} ${location}${finding.detail ? ` — ${finding.detail}` : ''}`
}

const root = argv[2] ?? DEFAULT_ROOT
const catalogues = await readCatalogues(root)
const findings = compareCatalogues(catalogues)
const languages = Object.keys(catalogues)
const keyCount = flatten(catalogues[REFERENCE_LANGUAGE] ?? {}).size

if (findings.length > 0) {
  console.error(`Translation catalogues disagree (${findings.length}):`)
  for (const finding of findings) console.error(describe(finding))
  console.error(
    '\nEvery language must describe the same keys as the reference language ' +
      `(${REFERENCE_LANGUAGE}). See frontend/src/i18n/README.md.`,
  )
  exit(1)
}

console.log(
  `Translation catalogues agree: ${keyCount} keys, ${languages.join(', ')}, reference ${REFERENCE_LANGUAGE}.`,
)
