import type { AgentId, RunAgent } from '@/api/types'

/**
 * Builds the agent/subagent tree of one run out of the **flat** list the read
 * API answers with.
 *
 * `GET /runs/{runId}/agents` deliberately returns a flat list and expresses the
 * hierarchy only through `parentAgentId` (ADR 0005): a server that nested the
 * response would have to commit to a maximum spawn depth. Building the tree is
 * therefore the client's job — and so is surviving a parent reference that does
 * not resolve.
 *
 * Three malformed shapes are possible in principle, and all three are given a
 * **defined** result rather than a crash or an endless walk:
 *
 * | Input | Result |
 * | --- | --- |
 * | `parentAgentId` names an agent that is not in the run | the agent becomes a root, flagged `orphaned` |
 * | a parent chain closes a cycle (including self-parenting) | exactly one member of the cycle becomes a root, flagged `cycle_broken` |
 * | the same `agentId` appears twice | the first occurrence wins, the rest are reported in `duplicateAgentIds` |
 *
 * Nothing is dropped: an orphan and a broken cycle stay visible, because the
 * cockpit shows what was reported and hiding a malformed node would hide the
 * fact that it was malformed. Only the *edge* the data could not support is
 * removed, never the agent.
 *
 * The module is pure and free of React so the rules above are testable without
 * rendering anything.
 */

/** How a node ended up where it is in the tree. */
export type AgentAttachment =
  /** `parentAgentId` is `null` — the agent reported itself as a root. */
  | 'root'
  /** Attached below the parent it named. */
  | 'child'
  /** Named a parent that is not part of this run. Rendered as a root. */
  | 'orphaned'
  /** Its parent chain closes a cycle; the edge was cut here. Rendered as a root. */
  | 'cycle_broken'

export interface AgentTreeNode {
  agent: RunAgent
  /** Zero for a root, incremented per level. */
  depth: number
  attachment: AgentAttachment
  children: AgentTreeNode[]
  /** Number of agents below this one, at any depth. */
  descendantCount: number
}

export interface AgentTree {
  roots: AgentTreeNode[]
  /** Every node by `agentId`, including duplicates' first occurrence only. */
  nodesById: Map<AgentId, AgentTreeNode>
  /** Deepest level in the tree; `0` for a flat list, `-1` when there is none. */
  maxDepth: number
  /** Agents whose `parentAgentId` names an agent this run does not contain. */
  orphanedAgentIds: AgentId[]
  /** Agents whose parent edge was cut to break a cycle. */
  cycleBrokenAgentIds: AgentId[]
  /** Repeated `agentId`s; only their first occurrence is in the tree. */
  duplicateAgentIds: AgentId[]
}

export function buildAgentTree(agents: readonly RunAgent[]): AgentTree {
  const byId = new Map<AgentId, RunAgent>()
  const duplicateAgentIds: AgentId[] = []

  for (const agent of agents) {
    if (byId.has(agent.agentId)) {
      duplicateAgentIds.push(agent.agentId)
      continue
    }
    byId.set(agent.agentId, agent)
  }

  const cutIds = findCycleCuts(byId)

  // ---- classify every agent, then wire the surviving edges -----------------
  const nodesById = new Map<AgentId, AgentTreeNode>()
  const orphanedAgentIds: AgentId[] = []
  const cycleBrokenAgentIds: AgentId[] = []
  const roots: AgentTreeNode[] = []

  for (const agent of byId.values()) {
    const attachment = classify(agent, byId, cutIds)
    if (attachment === 'orphaned') orphanedAgentIds.push(agent.agentId)
    if (attachment === 'cycle_broken') cycleBrokenAgentIds.push(agent.agentId)

    nodesById.set(agent.agentId, {
      agent,
      depth: 0,
      attachment,
      children: [],
      descendantCount: 0,
    })
  }

  for (const node of nodesById.values()) {
    if (node.attachment !== 'child') {
      roots.push(node)
      continue
    }
    // `classify` returned `child`, so the parent exists and the edge is not cut.
    const parent = nodesById.get(node.agent.parentAgentId as AgentId)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  // ---- depth and descendant counts, iteratively ----------------------------
  // A recursive walk would be the obvious implementation, but the input is
  // untrusted; the loop below cannot recurse and cannot exceed the node count
  // even if `findCycleCuts` were ever wrong.
  let maxDepth = -1
  const seen = new Set<AgentId>()
  const stack: AgentTreeNode[] = [...roots].reverse()

  while (stack.length > 0) {
    const node = stack.pop() as AgentTreeNode
    if (seen.has(node.agent.agentId)) {
      // Defensive: a node reached twice would mean the tree is not a tree.
      node.children = []
      continue
    }
    seen.add(node.agent.agentId)
    if (node.depth > maxDepth) maxDepth = node.depth

    for (const child of node.children) {
      child.depth = node.depth + 1
      stack.push(child)
    }
  }

  for (const node of postOrder(roots)) {
    node.descendantCount = node.children.reduce(
      (total, child) => total + child.descendantCount + 1,
      0,
    )
  }

  return {
    roots,
    nodesById,
    maxDepth,
    orphanedAgentIds,
    cycleBrokenAgentIds,
    duplicateAgentIds,
  }
}

function classify(
  agent: RunAgent,
  byId: Map<AgentId, RunAgent>,
  cutIds: ReadonlySet<AgentId>,
): AgentAttachment {
  if (cutIds.has(agent.agentId)) return 'cycle_broken'
  if (agent.parentAgentId === null) return 'root'
  if (!byId.has(agent.parentAgentId)) return 'orphaned'
  return 'child'
}

/**
 * Finds one agent per cycle whose parent edge has to be cut.
 *
 * Every agent has at most one parent, so the parent relation is a functional
 * graph: each connected component contains at most one cycle. Walking upwards
 * with an explicit "currently on the path" mark therefore finds each cycle once,
 * in linear time, and the node the walk re-enters is the one that gets cut.
 */
function findCycleCuts(byId: Map<AgentId, RunAgent>): Set<AgentId> {
  const cutIds = new Set<AgentId>()
  const resolved = new Set<AgentId>()
  const onPath = new Set<AgentId>()

  for (const start of byId.values()) {
    if (resolved.has(start.agentId)) continue

    const path: AgentId[] = []
    let current: RunAgent | undefined = start

    while (current) {
      if (resolved.has(current.agentId)) break
      if (onPath.has(current.agentId)) {
        // Re-entered a node of the walk we are on: cut its upward edge.
        cutIds.add(current.agentId)
        break
      }

      onPath.add(current.agentId)
      path.push(current.agentId)

      const parentId: AgentId | null = current.parentAgentId
      current = parentId === null ? undefined : byId.get(parentId)
    }

    for (const id of path) {
      onPath.delete(id)
      resolved.add(id)
    }
  }

  return cutIds
}

/** Children before parents, so descendant counts can be summed in one pass. */
function postOrder(roots: readonly AgentTreeNode[]): AgentTreeNode[] {
  const output: AgentTreeNode[] = []
  const stack = [...roots]

  while (stack.length > 0) {
    const node = stack.pop() as AgentTreeNode
    output.push(node)
    stack.push(...node.children)
  }

  return output.reverse()
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

export interface VisibleAgentRow {
  node: AgentTreeNode
  /** `true` when the node has children and they are currently hidden. */
  collapsed: boolean
}

/**
 * Flattens the tree into the rows that are currently on screen.
 *
 * Collapsing is a property of the viewer, not of the data, so it is passed in
 * rather than stored on the node. A collapsed node stays in the list — only its
 * subtree disappears.
 */
export function visibleAgentRows(
  roots: readonly AgentTreeNode[],
  collapsedAgentIds: ReadonlySet<AgentId>,
): VisibleAgentRow[] {
  const rows: VisibleAgentRow[] = []

  const walk = (nodes: readonly AgentTreeNode[]) => {
    for (const node of nodes) {
      const collapsed = node.children.length > 0 && collapsedAgentIds.has(node.agent.agentId)
      rows.push({ node, collapsed })
      if (!collapsed) walk(node.children)
    }
  }

  walk(roots)
  return rows
}

/**
 * Narrows the tree to the agents matching `term`, keeping every ancestor of a
 * match so a deep hit stays reachable instead of appearing at the root.
 *
 * Returns the tree unchanged for an empty term.
 */
export function filterAgentTree(
  roots: readonly AgentTreeNode[],
  term: string,
): AgentTreeNode[] {
  const needle = term.trim().toLowerCase()
  if (needle === '') return [...roots]

  const matches = (node: AgentTreeNode) =>
    `${node.agent.agentId} ${node.agent.displayName} ${node.agent.assignedTask} ${node.agent.role}`
      .toLowerCase()
      .includes(needle)

  const prune = (node: AgentTreeNode): AgentTreeNode | null => {
    const children = node.children
      .map(prune)
      .filter((child): child is AgentTreeNode => child !== null)
    if (children.length === 0 && !matches(node)) return null
    return { ...node, children }
  }

  return roots.map(prune).filter((node): node is AgentTreeNode => node !== null)
}

/** Every `agentId` of the tree that has at least one child. */
export function branchAgentIds(roots: readonly AgentTreeNode[]): AgentId[] {
  const ids: AgentId[] = []
  const stack = [...roots]

  while (stack.length > 0) {
    const node = stack.pop() as AgentTreeNode
    if (node.children.length > 0) {
      ids.push(node.agent.agentId)
      stack.push(...node.children)
    }
  }

  return ids
}
