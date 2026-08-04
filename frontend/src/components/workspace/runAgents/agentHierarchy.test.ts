import { describe, expect, it } from 'vitest'

import type { RunAgent } from '@/api/types'
import { agent } from '@/test/fixtures'

import {
  branchAgentIds,
  buildAgentTree,
  filterAgentTree,
  visibleAgentRows,
} from './agentHierarchy'

/** Shorthand for one reported agent of the run under test. */
function node(agentId: string, parentAgentId: string | null): RunAgent {
  return agent({
    agentId,
    parentAgentId,
    role: parentAgentId === null ? 'orchestrator' : 'subagent',
    displayName: agentId,
  })
}

describe('buildAgentTree — hierarchy', () => {
  it('keeps a root agent and several nested subagents unambiguously assigned', () => {
    // The shape the simulator reports: the reviewer is spawned by the
    // implementer, not by the root, so the tree is three levels deep.
    const tree = buildAgentTree([
      node('orchestrator-root', null),
      node('subagent-architect', 'orchestrator-root'),
      node('subagent-implementer', 'orchestrator-root'),
      node('subagent-reviewer', 'subagent-implementer'),
      node('subagent-tester', 'subagent-reviewer'),
    ])

    expect(tree.roots).toHaveLength(1)
    expect(tree.roots[0]?.agent.agentId).toBe('orchestrator-root')
    expect(tree.maxDepth).toBe(3)

    const byId = tree.nodesById
    expect(byId.get('subagent-architect')?.depth).toBe(1)
    expect(byId.get('subagent-implementer')?.depth).toBe(1)
    expect(byId.get('subagent-reviewer')?.depth).toBe(2)
    expect(byId.get('subagent-tester')?.depth).toBe(3)

    // Each subagent hangs below the agent that reported it, not below the root.
    expect(byId.get('subagent-implementer')?.children.map((c) => c.agent.agentId)).toEqual([
      'subagent-reviewer',
    ])
    expect(byId.get('subagent-reviewer')?.children.map((c) => c.agent.agentId)).toEqual([
      'subagent-tester',
    ])
    expect(byId.get('subagent-architect')?.children).toEqual([])

    expect(byId.get('orchestrator-root')?.descendantCount).toBe(4)
    expect(byId.get('subagent-implementer')?.descendantCount).toBe(2)
    expect(byId.get('subagent-tester')?.descendantCount).toBe(0)

    expect(tree.orphanedAgentIds).toEqual([])
    expect(tree.cycleBrokenAgentIds).toEqual([])
  })

  it('keeps two concurrent root agents apart', () => {
    const tree = buildAgentTree([
      node('root-a', null),
      node('root-b', null),
      node('child-a', 'root-a'),
      node('child-b', 'root-b'),
    ])

    expect(tree.roots.map((root) => root.agent.agentId)).toEqual(['root-a', 'root-b'])
    expect(tree.nodesById.get('root-a')?.children.map((c) => c.agent.agentId)).toEqual([
      'child-a',
    ])
    expect(tree.nodesById.get('root-b')?.children.map((c) => c.agent.agentId)).toEqual([
      'child-b',
    ])
  })
})

describe('buildAgentTree — malformed parent references', () => {
  it('renders an agent whose parent is not in the run as a flagged root', () => {
    const tree = buildAgentTree([
      node('orchestrator-root', null),
      node('subagent-orphan', 'agent-of-another-run'),
    ])

    expect(tree.orphanedAgentIds).toEqual(['subagent-orphan'])
    expect(tree.roots.map((root) => root.agent.agentId)).toEqual([
      'orchestrator-root',
      'subagent-orphan',
    ])
    expect(tree.nodesById.get('subagent-orphan')?.attachment).toBe('orphaned')
    // The agent is kept, not dropped: hiding it would hide the malformed report.
    expect(tree.nodesById.size).toBe(2)
  })

  it('breaks a cycle instead of looping, and keeps every agent of it', () => {
    const tree = buildAgentTree([
      node('cycle-a', 'cycle-c'),
      node('cycle-b', 'cycle-a'),
      node('cycle-c', 'cycle-b'),
    ])

    expect(tree.cycleBrokenAgentIds).toHaveLength(1)
    expect(tree.roots).toHaveLength(1)
    expect(tree.nodesById.size).toBe(3)
    expect(tree.maxDepth).toBe(2)

    // Every agent of the cycle is reachable exactly once from the surviving root.
    const reached = visibleAgentRows(tree.roots, new Set()).map((row) => row.node.agent.agentId)
    expect(reached).toHaveLength(3)
    expect(new Set(reached)).toEqual(new Set(['cycle-a', 'cycle-b', 'cycle-c']))
  })

  it('breaks a self-referencing parent', () => {
    const tree = buildAgentTree([node('self', 'self')])

    expect(tree.cycleBrokenAgentIds).toEqual(['self'])
    expect(tree.roots.map((root) => root.agent.agentId)).toEqual(['self'])
    expect(tree.roots[0]?.children).toEqual([])
  })

  it('handles a cycle that hangs below a healthy root', () => {
    const tree = buildAgentTree([
      node('orchestrator-root', null),
      node('healthy', 'orchestrator-root'),
      node('loop-a', 'loop-b'),
      node('loop-b', 'loop-a'),
    ])

    expect(tree.roots).toHaveLength(2)
    expect(tree.cycleBrokenAgentIds).toHaveLength(1)
    expect(visibleAgentRows(tree.roots, new Set())).toHaveLength(4)
  })

  it('keeps the first occurrence of a repeated agent id and reports the rest', () => {
    const first = agent({ agentId: 'twin', displayName: 'first', parentAgentId: null })
    const second = agent({ agentId: 'twin', displayName: 'second', parentAgentId: null })
    const tree = buildAgentTree([first, second])

    expect(tree.duplicateAgentIds).toEqual(['twin'])
    expect(tree.roots).toHaveLength(1)
    expect(tree.roots[0]?.agent.displayName).toBe('first')
  })

  it('returns an empty tree for an empty run', () => {
    const tree = buildAgentTree([])

    expect(tree.roots).toEqual([])
    expect(tree.maxDepth).toBe(-1)
    expect(visibleAgentRows(tree.roots, new Set())).toEqual([])
  })
})

describe('navigation helpers', () => {
  const tree = buildAgentTree([
    node('orchestrator-root', null),
    node('subagent-implementer', 'orchestrator-root'),
    node('subagent-reviewer', 'subagent-implementer'),
  ])

  it('hides the subtree of a collapsed agent but keeps the agent itself', () => {
    const rows = visibleAgentRows(tree.roots, new Set(['subagent-implementer']))

    expect(rows.map((row) => row.node.agent.agentId)).toEqual([
      'orchestrator-root',
      'subagent-implementer',
    ])
    expect(rows[1]?.collapsed).toBe(true)
  })

  it('keeps the ancestors of a deep match when filtering', () => {
    const filtered = filterAgentTree(tree.roots, 'reviewer')
    const rows = visibleAgentRows(filtered, new Set())

    expect(rows.map((row) => row.node.agent.agentId)).toEqual([
      'orchestrator-root',
      'subagent-implementer',
      'subagent-reviewer',
    ])
  })

  it('lists only the agents that actually have subagents', () => {
    expect(branchAgentIds(tree.roots).sort()).toEqual([
      'orchestrator-root',
      'subagent-implementer',
    ])
  })
})
