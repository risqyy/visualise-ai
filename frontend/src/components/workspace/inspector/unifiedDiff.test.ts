import { describe, expect, it } from 'vitest'

import { CHANGE_DIFFS, reportedDiff } from '@/test/inspectorFixtures'

import { parseUnifiedDiff } from './unifiedDiff'

describe('parseUnifiedDiff', () => {
  it('classifies metadata, hunk headers, additions, removals and context', () => {
    const parsed = parseUnifiedDiff(reportedDiff().unifiedDiff)

    expect(parsed.lines.map((line) => line.kind)).toEqual([
      'meta',
      'meta',
      'hunk',
      'context',
      'removal',
      'addition',
      'context',
    ])
    expect(parsed.additions).toBe(1)
    expect(parsed.removals).toBe(1)
  })

  it('numbers the lines from the hunk header, separately per side', () => {
    const parsed = parseUnifiedDiff(reportedDiff().unifiedDiff)
    const body = parsed.lines.filter((line) => line.kind !== 'meta' && line.kind !== 'hunk')

    expect(body.map((line) => [line.kind, line.oldNumber, line.newNumber])).toEqual([
      ['context', 18, 18],
      ['removal', 19, null],
      ['addition', null, 19],
      ['context', 20, 20],
    ])
  })

  it('reads the file paths and recognises a creation', () => {
    const parsed = parseUnifiedDiff(CHANGE_DIFFS[1]!.unifiedDiff)

    expect(parsed.oldPath).toBe('/dev/null')
    expect(parsed.newPath).toBe('internal/orders/domain/tax/tax.go')
    expect(parsed.isCreation).toBe(true)
    expect(parsed.isDeletion).toBe(false)
  })

  it('recognises a deletion', () => {
    const parsed = parseUnifiedDiff(
      ['--- a/legacy/tax_rates.go', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-package legacy', ''].join(
        '\n',
      ),
    )

    expect(parsed.isDeletion).toBe(true)
    expect(parsed.isCreation).toBe(false)
    expect(parsed.removals).toBe(1)
  })

  it('does not invent a trailing line for a diff that ends with a newline', () => {
    const parsed = parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n')

    expect(parsed.lines).toHaveLength(5)
    expect(parsed.lines.at(-1)?.content).toBe('+b')
  })

  it('never mistakes the +++/--- header for a changed line', () => {
    const parsed = parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1,0 +1,1 @@\n+neu\n')

    expect(parsed.additions).toBe(1)
    expect(parsed.removals).toBe(0)
  })

  it('degrades to metadata instead of throwing on a diff without a hunk header', () => {
    const parsed = parseUnifiedDiff('Binary files a/logo.png and b/logo.png differ\n')

    expect(parsed.lines).toHaveLength(1)
    expect(parsed.lines[0]?.kind).toBe('meta')
    expect(parsed.additions).toBe(0)
  })
})
