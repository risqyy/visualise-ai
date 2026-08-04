/**
 * The `self` scenario reports this repository. Its whole value is that nothing
 * in it is invented, so the assertions below are about truthfulness as much as
 * about correctness:
 *
 * * every envelope still satisfies the published contract,
 * * the lifecycle preconditions the backend enforces hold,
 * * the sequence is deterministic,
 * * **no `nats_topic` relationship exists**, because this project has no message
 *   bus and the contract's having the kind is not a reason to report one, and
 * * every component a relationship names is actually in the snapshot.
 */
import { describe, expect, it } from 'vitest'

import { loadContract } from '../src/contract.js'
import { DEFAULT_OPTIONS } from '../src/options.js'
import { buildSelfScenario, DEFAULT_PROJECT_IDS, DEFAULT_RUN_IDS } from '../src/scenarios/index.js'
import { SELF_SNAPSHOT_COMPONENTS, SELF_SNAPSHOT_RELATIONSHIPS } from '../src/scenarios/selfArchitecture.js'
import { SELF_DIFFS } from '../src/scenarios/selfDiffs.js'
import type { EventEnvelope } from '../src/types.js'

const contract = loadContract()

const base = {
  projectId: DEFAULT_PROJECT_IDS.self,
  runId: DEFAULT_RUN_IDS.self,
  seed: DEFAULT_OPTIONS.seed,
}

const scenario = buildSelfScenario(base)
const events = scenario.steps.map((step) => step.event)

const eventsOf = (type: string): EventEnvelope[] => events.filter((event) => event.type === type)

const snapshot = eventsOf('architecture.snapshot_published')[0]?.payload as {
  components: { componentId: string; parentComponentId: string | null; kind: string }[]
  relationships: { relationshipId: string; kind: string; sourceComponentId: string; targetComponentId: string }[]
}

describe('contract conformance', () => {
  it('validates every event as IngestEventRequest', () => {
    for (const step of scenario.steps) {
      expect(() => contract.assertIngestible(step.event)).not.toThrow()
    }
  })

  it('reports nothing outside the closed catalogue', () => {
    const catalogue = new Set(contract.eventTypes)
    for (const event of events) {
      expect(catalogue).toContain(event.type)
    }
  })

  it('expects a first delivery for every step', () => {
    for (const step of scenario.steps) {
      expect(step.expect).toEqual({ status: 201, duplicate: false })
    }
  })
})

describe('lifecycle preconditions', () => {
  it('opens the run with exactly one root orchestrator, first', () => {
    const roots = events.filter(
      (event) =>
        event.type === 'agent.started' &&
        event.parentAgentId === null &&
        (event.payload as { role?: string }).role === 'orchestrator',
    )

    expect(roots).toHaveLength(1)
    expect(events[0]).toBe(roots[0])
  })

  it('reports agent.started before any other event of that agent', () => {
    const started = new Set<string>()
    for (const event of events) {
      if (event.type === 'agent.started') {
        started.add(event.agentId)
        continue
      }
      expect(started, `${event.agentId} reported ${event.type} before agent.started`).toContain(
        event.agentId,
      )
    }
  })

  it('names only already started agents as parentAgentId', () => {
    const started = new Set<string>()
    for (const event of events) {
      if (event.parentAgentId !== null) {
        expect(
          started,
          `parent ${event.parentAgentId} of ${event.agentId} never started`,
        ).toContain(event.parentAgentId)
      }
      if (event.type === 'agent.started') started.add(event.agentId)
    }
  })

  it('corrects and retracts only events that were sent earlier', () => {
    const seen = new Set<string>()
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>
      const target = payload.correctsClientEventId ?? payload.retractsClientEventId
      if (typeof target === 'string') {
        expect(seen, `${event.type} refers to an unsent event`).toContain(target)
      }
      seen.add(event.clientEventId)
    }
  })

  it('keeps every event inside one project and one run', () => {
    for (const event of events) {
      expect(event.projectId).toBe(scenario.projectId)
      expect(event.runId).toBe(scenario.runId)
    }
  })

  it('leaves the run open', () => {
    // Same reason as the full scenario: no state is derived from silence, and a
    // run without a terminal event is the honest cockpit state.
    expect(events.some((event) => event.type === 'run.finished')).toBe(false)
  })
})

describe('determinism', () => {
  it('produces byte-identical envelopes for two builds with the same seed', () => {
    const again = buildSelfScenario(base)

    expect(again.steps.map((s) => s.event)).toEqual(scenario.steps.map((s) => s.event))
    expect(again.steps.map((s) => s.pauseMs)).toEqual(scenario.steps.map((s) => s.pauseMs))
  })

  it('changes every client event id when the seed changes', () => {
    const other = buildSelfScenario({ ...base, seed: base.seed + 1 })
    const ids = scenario.steps.map((s) => s.event.clientEventId)
    const otherIds = other.steps.map((s) => s.event.clientEventId)

    expect(otherIds).toHaveLength(ids.length)
    expect(otherIds.some((id, index) => id === ids[index])).toBe(false)
  })

  it('draws every client event id as a distinct UUIDv4', () => {
    const ids = events.map((event) => event.clientEventId)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reports a strictly increasing timeline', () => {
    const times = events.map((event) => Date.parse(event.occurredAt))
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThan(times[i - 1] as number)
    }
  })
})

describe('this project has no message bus', () => {
  it('reports no nats_topic relationship anywhere in the scenario', () => {
    // The contract knows the kind and the `full` scenario demonstrates it. This
    // repository has no NATS, no broker and no queue, so reporting one here
    // would be a fabrication — which is precisely what this scenario exists to
    // avoid. If a future edit adds one, this test is where it is refused.
    const serialised = JSON.stringify(events)
    expect(serialised).not.toContain('nats_topic')
  })

  it('reports no queue and no topic component', () => {
    const kinds = new Set(snapshot.components.map((component) => component.kind))
    expect(kinds).not.toContain('queue')
    expect(kinds).not.toContain('topic')
  })

  it('uses only relationship kinds this repository actually has', () => {
    const kinds = new Set(snapshot.relationships.map((relationship) => relationship.kind))
    // `async` is the post-commit publish hook, `data` the two GORM connections,
    // `http` the Nginx routes and the client calls, `dependency` the imports.
    // `grpc` and `nats_topic` have no counterpart in this repository.
    expect([...kinds].sort()).toEqual(['async', 'data', 'dependency', 'http'])
  })
})

describe('the published model is internally consistent', () => {
  it('resolves every parentComponentId inside the snapshot', () => {
    const ids = new Set(snapshot.components.map((component) => component.componentId))
    for (const component of snapshot.components) {
      if (component.parentComponentId === null) continue
      expect(ids, `${component.componentId} has an unknown parent`).toContain(
        component.parentComponentId,
      )
    }
  })

  it('resolves every component a relationship names', () => {
    const ids = new Set(snapshot.components.map((component) => component.componentId))
    for (const relationship of snapshot.relationships) {
      expect(ids, `${relationship.relationshipId} has an unknown source`).toContain(
        relationship.sourceComponentId,
      )
      expect(ids, `${relationship.relationshipId} has an unknown target`).toContain(
        relationship.targetComponentId,
      )
    }
  })

  it('lists parents before their children', () => {
    const seen = new Set<string>()
    for (const component of SELF_SNAPSHOT_COMPONENTS) {
      if (component.parentComponentId !== null) {
        expect(seen, `${component.componentId} precedes its parent`).toContain(
          component.parentComponentId,
        )
      }
      seen.add(component.componentId)
    }
  })

  it('assigns every component and every relationship a unique id', () => {
    const componentIds = SELF_SNAPSHOT_COMPONENTS.map((c) => c.componentId)
    const relationshipIds = SELF_SNAPSHOT_RELATIONSHIPS.map((r) => r.relationshipId)

    expect(new Set(componentIds).size).toBe(componentIds.length)
    expect(new Set(relationshipIds).size).toBe(relationshipIds.length)
  })

  it('nests at least four hierarchy levels', () => {
    const parents = new Map(
      snapshot.components.map((component) => [component.componentId, component.parentComponentId]),
    )
    const depthOf = (id: string): number => {
      let depth = 0
      let current: string | null | undefined = id
      while (current !== null && current !== undefined) {
        depth += 1
        current = parents.get(current) ?? null
      }
      return depth
    }

    expect(Math.max(...[...parents.keys()].map(depthOf))).toBeGreaterThanOrEqual(4)
  })
})

describe('the run describes real work', () => {
  it('runs one orchestrator and several subagents below it', () => {
    const started = eventsOf('agent.started')
    const roles = started.map((event) => (event.payload as { role: string }).role)

    expect(roles.filter((role) => role === 'orchestrator')).toHaveLength(1)
    expect(roles.filter((role) => role === 'subagent').length).toBeGreaterThanOrEqual(6)
    for (const event of started) {
      if ((event.payload as { role: string }).role === 'subagent') {
        expect(event.parentAgentId).toBe(started[0]?.agentId)
      }
    }
  })

  it('separates the orchestrator estimate from the subagents own-task progress', () => {
    const progress = eventsOf('agent.progress_reported').map((event) => ({
      agentId: event.agentId,
      ...(event.payload as { percent: number; scope: string }),
    }))
    const overall = progress.filter((p) => p.scope === 'overall_estimate')
    const own = progress.filter((p) => p.scope === 'own_task')

    expect(overall.length).toBeGreaterThan(0)
    expect(own.length).toBeGreaterThan(0)
    expect(new Set(overall.map((p) => p.agentId)).size).toBe(1)
    expect(own.some((p) => p.agentId === overall[0]?.agentId)).toBe(false)
  })

  it('publishes two plan revisions that differ by exactly the inserted step', () => {
    const plans = eventsOf('plan.published').map(
      (event) => event.payload as { revision: number; steps: { stepId: string }[] },
    )

    expect(plans.map((plan) => plan.revision)).toEqual([1, 2])

    const first = plans[0]?.steps.map((step) => step.stepId) ?? []
    const second = plans[1]?.steps.map((step) => step.stepId) ?? []
    const inserted = second.filter((stepId) => !first.includes(stepId))

    expect(inserted).toEqual(['step-pr-25-generated-types'])
    expect(first.every((stepId) => second.includes(stepId))).toBe(true)
  })

  it('reports one repository file per diff, several sharing a changeId', () => {
    const diffs = eventsOf('diff.reported').map(
      (event) => event.payload as { diffId: string; changeId?: string; filePath: string; unifiedDiff: string },
    )

    expect(diffs.length).toBeGreaterThanOrEqual(4)
    expect(new Set(diffs.map((diff) => diff.diffId)).size).toBe(diffs.length)
    expect(new Set(diffs.map((diff) => diff.filePath)).size).toBe(diffs.length)

    const grouped = new Map<string, number>()
    for (const diff of diffs) {
      if (diff.changeId === undefined) continue
      grouped.set(diff.changeId, (grouped.get(diff.changeId) ?? 0) + 1)
    }
    expect([...grouped.values()].filter((count) => count > 1).length).toBeGreaterThanOrEqual(2)
    // At least one diff carries no changeId, so the inspector has an ungrouped
    // entry next to the grouped ones.
    expect(diffs.some((diff) => diff.changeId === undefined)).toBe(true)
  })

  it('names a real repository file in every diff and keeps the markers', () => {
    for (const diff of SELF_DIFFS) {
      expect(diff.filePath).not.toMatch(/^\//)
      expect(diff.filePath).not.toContain('\\')
      expect(diff.unifiedDiff).toMatch(/^--- /)
      expect(diff.unifiedDiff).toContain('\n+++ ')
      expect(diff.unifiedDiff).toMatch(/\n@@ -\d+(,\d+)? \+\d+(,\d+)? @@/)
    }
  })

  it('leaves at least one proposal pending and retracts exactly one', () => {
    const planned = eventsOf('component.change_planned')
      .concat(eventsOf('relationship.change_planned'))
      .map((event) => (event.payload as { changeId: string }).changeId)
    const applied = eventsOf('component.change_applied')
      .concat(eventsOf('relationship.change_applied'))
      .map((event) => (event.payload as { changeId?: string }).changeId)
    const retracted = eventsOf('retraction.issued')

    expect(retracted).toHaveLength(1)
    const open = planned.filter(
      (changeId) => !applied.includes(changeId) && changeId !== 'change-adr-0010-full-replay-per-page-load',
    )
    expect(open.length).toBeGreaterThanOrEqual(1)
  })

  it('corrects an earlier event with a payload valid for the corrected type', () => {
    const corrections = eventsOf('correction.issued')
    expect(corrections).toHaveLength(1)

    const payload = corrections[0]?.payload as {
      correctedType: string
      correctedPayload: Record<string, unknown>
    }
    expect(payload.correctedType).toBe('feedback.published')

    // The corrected payload has to satisfy the schema its type selects, so it is
    // validated the same way a first-class event would be.
    const carrier = {
      ...(corrections[0] as EventEnvelope),
      type: payload.correctedType,
      payload: payload.correctedPayload,
    }
    expect(() => contract.assertIngestible(carrier)).not.toThrow()
  })
})
