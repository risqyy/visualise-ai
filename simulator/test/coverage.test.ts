/**
 * What #14 has to be able to assert against a browser. Each test below maps to
 * one bullet of the mandatory end-to-end acceptance run, so a scenario edit that
 * quietly drops a case fails here instead of in Playwright.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_OPTIONS } from '../src/options.js'
import { buildFullScenario, DEFAULT_PROJECT_IDS } from '../src/scenarios/index.js'
import type { EventEnvelope, ScenarioStep } from '../src/types.js'

const scenario = buildFullScenario({
  projectId: DEFAULT_PROJECT_IDS.full,
  runId: 'run-2026-08-04-0001',
  seed: DEFAULT_OPTIONS.seed,
  finish: true,
})

const eventsOf = (type: string): EventEnvelope[] =>
  scenario.steps.filter((step: ScenarioStep) => step.event.type === type).map((step) => step.event)

const snapshot = eventsOf('architecture.snapshot_published')[0]?.payload as {
  components: { componentId: string; parentComponentId: string | null }[]
  relationships: { kind: string; channel?: string; targetComponentId: string }[]
}

/** Depth of a node in a flat parent-pointer list, root = 1. */
function depthOf(id: string | null, parents: Map<string, string | null>): number {
  let depth = 0
  let current = id
  while (current !== null && current !== undefined) {
    depth += 1
    current = parents.get(current) ?? null
  }
  return depth
}

describe('agent tree', () => {
  const started = eventsOf('agent.started')
  const parents = new Map<string, string | null>(
    started.map((event) => [event.agentId, event.parentAgentId]),
  )

  it('runs at least three subagents', () => {
    const subagents = started.filter(
      (event) => (event.payload as { role?: string }).role === 'subagent',
    )
    expect(subagents.length).toBeGreaterThanOrEqual(3)
  })

  it('nests a subagent below another subagent, three levels including the root', () => {
    const depths = [...parents.keys()].map((id) => depthOf(id, parents))
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(3)
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
    // Every orchestrator estimate is reported by the root; own_task never is.
    expect(new Set(overall.map((p) => p.agentId)).size).toBe(1)
    expect(own.some((p) => p.agentId === overall[0]?.agentId)).toBe(false)
    // The two scopes must be distinguishable at a glance, not accidentally equal.
    for (const estimate of overall) {
      expect(own.some((p) => p.percent === estimate.percent)).toBe(false)
    }
  })

  it('reports several distinct statuses', () => {
    const statuses = new Set(
      eventsOf('agent.status_reported').map((event) => (event.payload as { status: string }).status),
    )
    expect(statuses.size).toBeGreaterThanOrEqual(3)
  })
})

describe('architecture snapshot', () => {
  it('nests components at least three levels deep', () => {
    const parents = new Map<string, string | null>(
      snapshot.components.map((component) => [component.componentId, component.parentComponentId]),
    )
    const depths = snapshot.components.map((component) => depthOf(component.componentId, parents))
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(3)
  })

  it('references only components contained in the same model', () => {
    const known = new Set(snapshot.components.map((component) => component.componentId))
    for (const component of snapshot.components) {
      if (component.parentComponentId !== null) {
        expect(known).toContain(component.parentComponentId)
      }
    }
    for (const relationship of snapshot.relationships) {
      expect(known).toContain(relationship.targetComponentId)
    }
  })

  it('uses every relationship kind of the contract', () => {
    const kinds = new Set(snapshot.relationships.map((relationship) => relationship.kind))
    expect([...kinds].sort()).toEqual(
      ['async', 'data', 'dependency', 'grpc', 'http', 'nats_topic'].sort(),
    )
  })

  it('models at least two separate NATS topics', () => {
    const channels = new Set(
      snapshot.relationships
        .filter((relationship) => relationship.kind === 'nats_topic')
        .map((relationship) => relationship.channel),
    )
    expect(channels.size).toBeGreaterThanOrEqual(2)
  })

  it('fans one topic out to two consumers as two separate relationships', () => {
    const perChannel = new Map<string, number>()
    for (const relationship of snapshot.relationships) {
      if (relationship.kind !== 'nats_topic' || !relationship.channel) continue
      perChannel.set(relationship.channel, (perChannel.get(relationship.channel) ?? 0) + 1)
    }
    // publisher + two consumers on the same channel, never merged into one edge
    expect(Math.max(...perChannel.values())).toBeGreaterThanOrEqual(3)
  })
})

describe('changes', () => {
  const planned = [...eventsOf('component.change_planned'), ...eventsOf('relationship.change_planned')]
  const applied = [...eventsOf('component.change_applied'), ...eventsOf('relationship.change_applied')]

  it('plans component and relationship changes and applies them under the same changeId', () => {
    expect(eventsOf('component.change_planned').length).toBeGreaterThan(0)
    expect(eventsOf('relationship.change_planned').length).toBeGreaterThan(0)

    const plannedIds = new Set(planned.map((event) => (event.payload as { changeId: string }).changeId))
    const appliedIds = new Set(applied.map((event) => (event.payload as { changeId?: string }).changeId))

    expect(appliedIds.size).toBeGreaterThan(0)
    for (const id of appliedIds) {
      expect(plannedIds).toContain(id)
    }
  })

  it('applies every change only after it was planned', () => {
    const seen = new Set<string>()
    for (const step of scenario.steps) {
      const changeId = (step.event.payload as { changeId?: string }).changeId
      if (!changeId) continue
      if (step.event.type.endsWith('.change_planned')) {
        seen.add(changeId)
      } else if (step.event.type.endsWith('.change_applied')) {
        expect(seen, `${changeId} applied without being planned`).toContain(changeId)
      }
    }
  })

  it('removes a component and a relationship', () => {
    const removals = applied.filter(
      (event) => (event.payload as { operation: string }).operation === 'remove',
    )
    expect(removals.length).toBeGreaterThanOrEqual(2)
    expect(removals.some((event) => 'component' in (event.payload as object))).toBe(true)
    expect(removals.some((event) => 'relationship' in (event.payload as object))).toBe(true)
  })

  it('retracts a planned change that was never applied', () => {
    const retractions = eventsOf('retraction.issued')
    expect(retractions).toHaveLength(1)

    const target = (retractions[0]?.payload as { retractsClientEventId: string })
      .retractsClientEventId
    const retracted = scenario.steps.find((step) => step.event.clientEventId === target)?.event

    expect(retracted?.type).toMatch(/\.change_planned$/)
    const changeId = (retracted?.payload as { changeId: string }).changeId
    expect(applied.some((event) => (event.payload as { changeId?: string }).changeId === changeId)).toBe(
      false,
    )
  })

  it('ends the run with a component and a relationship proposal still pending', () => {
    const settled = new Set<string>()
    for (const event of applied) {
      const changeId = (event.payload as { changeId?: string }).changeId
      if (changeId) settled.add(changeId)
    }
    for (const retraction of eventsOf('retraction.issued')) {
      const target = (retraction.payload as { retractsClientEventId: string }).retractsClientEventId
      const original = scenario.steps.find((step) => step.event.clientEventId === target)?.event
      const changeId = (original?.payload as { changeId?: string } | undefined)?.changeId
      if (changeId) settled.add(changeId)
    }

    // Neither applied nor retracted: the cockpit's `activeChanges` must still
    // hold something once the run goes quiet.
    const pending = planned.filter(
      (event) => !settled.has((event.payload as { changeId: string }).changeId),
    )
    expect(pending.some((event) => event.type === 'component.change_planned')).toBe(true)
    expect(pending.some((event) => event.type === 'relationship.change_planned')).toBe(true)
  })

  it('corrects an earlier event instead of rewriting it', () => {
    const corrections = eventsOf('correction.issued')
    expect(corrections.length).toBeGreaterThan(0)

    for (const correction of corrections) {
      const payload = correction.payload as { correctsClientEventId: string; correctedType: string }
      const original = scenario.steps.find(
        (step) => step.event.clientEventId === payload.correctsClientEventId,
      )?.event
      expect(original?.type).toBe(payload.correctedType)
    }
  })
})

describe('component evidence', () => {
  it('reports at least four single-file unified diffs', () => {
    const diffs = eventsOf('diff.reported')
    expect(diffs.length).toBeGreaterThanOrEqual(4)

    for (const diff of diffs) {
      const payload = diff.payload as { filePath: string; unifiedDiff: string }
      expect(payload.filePath.startsWith('/')).toBe(false)
      expect(payload.unifiedDiff).toContain('--- ')
      expect(payload.unifiedDiff).toContain('+++ ')
      expect(payload.unifiedDiff).toContain('@@')
    }
  })

  it('groups several diffs under one changeId', () => {
    const perChange = new Map<string, number>()
    for (const diff of eventsOf('diff.reported')) {
      const changeId = (diff.payload as { changeId?: string }).changeId
      if (!changeId) continue
      perChange.set(changeId, (perChange.get(changeId) ?? 0) + 1)
    }
    expect(Math.max(...perChange.values())).toBeGreaterThanOrEqual(3)
  })

  it('publishes real markdown feedback for several components', () => {
    const feedback = eventsOf('feedback.published')
    expect(feedback.length).toBeGreaterThanOrEqual(2)

    const components = new Set<string>()
    for (const event of feedback) {
      const payload = event.payload as { componentIds: string[]; format: string; body: string }
      expect(payload.format).toBe('markdown')
      payload.componentIds.forEach((id) => components.add(id))
      expect(payload.body).toMatch(/^## /m)
      expect(payload.body).toMatch(/^[-*\d]/m)
      expect(payload.body).toMatch(/`[^`\n]+`/)
    }
    expect(components.size).toBeGreaterThanOrEqual(3)
    // At least one body carries a fenced code block.
    expect(
      feedback.some((event) => (event.payload as { body: string }).body.includes('```')),
    ).toBe(true)
  })

  it('reports a risk and a problem', () => {
    expect(eventsOf('risk.reported').length).toBeGreaterThan(0)
    expect(eventsOf('problem.reported').length).toBeGreaterThan(0)
  })
})

describe('plan', () => {
  it('publishes a revision of the same plan', () => {
    const plans = eventsOf('plan.published').map(
      (event) => event.payload as { planId: string; revision: number },
    )
    expect(plans.length).toBeGreaterThanOrEqual(2)
    expect(new Set(plans.map((plan) => plan.planId)).size).toBe(1)
    expect(plans.map((plan) => plan.revision)).toEqual([1, 2])
  })

  it('updates steps of the published plan', () => {
    const published = eventsOf('plan.published').flatMap((event) =>
      (event.payload as { steps: { stepId: string }[] }).steps.map((step) => step.stepId),
    )
    const updates = eventsOf('plan.step_updated')

    expect(updates.length).toBeGreaterThan(0)
    for (const update of updates) {
      expect(published).toContain((update.payload as { stepId: string }).stepId)
    }
  })

  it('links work steps to plan steps and completes what it starts', () => {
    const started = eventsOf('work.step_started').map(
      (event) => event.payload as { workStepId: string; planStepId?: string },
    )
    const completed = new Set(
      eventsOf('work.step_completed').map(
        (event) => (event.payload as { workStepId: string }).workStepId,
      ),
    )

    expect(started.length).toBeGreaterThan(0)
    for (const step of started) {
      expect(completed, `${step.workStepId} was never completed`).toContain(step.workStepId)
      expect(step.planStepId).toBeDefined()
    }
  })
})
