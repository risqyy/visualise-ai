import { describe, expect, it } from 'vitest'

import { RUN_ID } from '@/test/fixtures'
import {
  ALL_DIFFS,
  CHANGE_DIFFS,
  CHANGE_ID,
  IMPLEMENTER_AGENT_ID,
  OTHER_CHANGE_DIFF,
  OTHER_CHANGE_ID,
  REVIEWER_AGENT_ID,
  UNATTRIBUTED_DIFF,
  reportedDiff,
} from '@/test/inspectorFixtures'

import { groupDiffs } from './diffGroups'

describe('groupDiffs', () => {
  it('groups the three files of one changeId into a single change', () => {
    const groups = groupDiffs(ALL_DIFFS)
    const change = groups.find((group) => group.changeId === CHANGE_ID)

    expect(change).toBeDefined()
    expect(change?.files).toHaveLength(3)
    expect(change?.files.map((file) => file.diff.filePath)).toEqual([
      'internal/orders/domain/pricing/pricing.go',
      'internal/orders/domain/tax/tax.go',
      'internal/orders/domain/tax/tax_test.go',
    ])
    expect(change?.agentId).toBe(IMPLEMENTER_AGENT_ID)
    expect(change?.runId).toBe(RUN_ID)
  })

  it('keeps a different change of the same run in its own group', () => {
    const groups = groupDiffs(ALL_DIFFS)

    expect(groups.map((group) => group.changeId)).toContain(OTHER_CHANGE_ID)
    expect(
      groups.find((group) => group.changeId === OTHER_CHANGE_ID)?.files,
    ).toHaveLength(1)
  })

  it('never merges the same changeId across two agents', () => {
    const groups = groupDiffs([
      ...CHANGE_DIFFS,
      reportedDiff({
        diffId: 'diff-other-agent',
        agentId: REVIEWER_AGENT_ID,
        filePath: 'docs/tax.md',
        position: 26,
      }),
    ])

    const forChange = groups.filter((group) => group.changeId === CHANGE_ID)
    expect(forChange).toHaveLength(2)
    expect(forChange.map((group) => group.agentId).sort()).toEqual(
      [IMPLEMENTER_AGENT_ID, REVIEWER_AGENT_ID].sort(),
    )
  })

  it('never merges the same changeId across two runs', () => {
    const groups = groupDiffs([
      ...CHANGE_DIFFS,
      reportedDiff({ diffId: 'diff-older-run', runId: 'run-2026-08-03-0001', position: 5 }),
    ])

    expect(groups.filter((group) => group.changeId === CHANGE_ID)).toHaveLength(2)
  })

  it('leaves a diff without a changeId standing alone', () => {
    const groups = groupDiffs([
      UNATTRIBUTED_DIFF,
      reportedDiff({ diffId: 'diff-other-unattributed', changeId: null, position: 26 }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.every((group) => group.files.length === 1)).toBe(true)
    expect(groups.every((group) => group.changeId === null)).toBe(true)
  })

  it('drops a diff that two overlapping pages both returned', () => {
    const groups = groupDiffs([...CHANGE_DIFFS, CHANGE_DIFFS[0]!, CHANGE_DIFFS[1]!])
    const change = groups.find((group) => group.changeId === CHANGE_ID)

    expect(change?.files).toHaveLength(3)
    expect(new Set(change?.files.map((file) => file.diff.diffId)).size).toBe(3)
  })

  it('sums the additions and removals of a change', () => {
    const change = groupDiffs(CHANGE_DIFFS)[0]

    expect(change?.additions).toBe(1 + 4 + 2)
    expect(change?.removals).toBe(1)
  })

  it('orders the newest change first and the files inside it as reported', () => {
    const groups = groupDiffs(ALL_DIFFS)

    expect(groups.map((group) => group.position)).toEqual([25, 24, 23])
    expect(groups[0]?.changeId).toBe(UNATTRIBUTED_DIFF.changeId)
    expect(groups[1]?.changeId).toBe(OTHER_CHANGE_DIFF.changeId)
    expect(groups[2]?.files.map((file) => file.diff.position)).toEqual([21, 22, 23])
  })

  it('returns nothing for an empty collection instead of an empty group', () => {
    expect(groupDiffs([])).toEqual([])
  })
})
