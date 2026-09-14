import { describe, expect, it } from 'vitest'
import { agent, architectureResponse, component, streamedEvent, RUN_ID } from '@/test/fixtures'
import { buildChangeOverlays } from '@/canvas/changeOverlays'
import { appliedRelationship } from '@/test/architectureFixtures'
import { EMPTY_LEDGER, ingestEvent, observeModel, openWorkSteps, recentAppliedChanges } from './changeLedger'

const a = component({ componentId: 'service-a', name: 'Before', description: 'Old description' })
const b = component({ componentId: 'service-b', name: 'B' })
const edge = appliedRelationship({ relationshipId: 'edge-ab', sourceComponentId: a.componentId, targetComponentId: b.componentId, kind: 'dependency' })
const base = { ...architectureResponse, projectPosition: 1, components: [a, b], relationships: [edge] }

describe('direct MCP canvas evidence', () => {
  it('folds every operation of a maximum batch at one position and deduplicates replay', () => {
    const event = streamedEvent('model.mutation_applied', { expectedModelRevision: 1,
      operations: Array.from({ length: 100 }, (_, i) => ({ op: 'component.add', component: { componentId: `new-${i}`, name: `New ${i}`, kind: 'module', parentComponentId: null } })),
    }, { schemaVersion: '2.0', position: 2 })
    const ledger = ingestEvent(EMPTY_LEDGER, event)
    expect(ledger.history).toHaveLength(100)
    expect(recentAppliedChanges(ledger)).toHaveLength(100)
    expect(ingestEvent(ledger, event)).toBe(ledger)
    expect(ledger.history.every((one) => one.phase === 'applied')).toBe(true)
    expect(openWorkSteps(ledger)).toHaveLength(0)
  })

  it('retains honest prior descriptors across partial updates and ID-only removals', () => {
    let ledger = observeModel(EMPTY_LEDGER, base, 2)
    ledger = ingestEvent(ledger, streamedEvent('model.mutation_applied', { expectedModelRevision: 1, operations: [
      { op: 'component.update', componentId: a.componentId, set: { name: 'After', description: null } },
    ] }, { schemaVersion: '2.0', position: 2 }))
    ledger = ingestEvent(ledger, streamedEvent('model.mutation_applied', { expectedModelRevision: 2, operations: [
      { op: 'relationship.remove', relationshipId: edge.relationshipId },
      { op: 'component.remove', componentId: a.componentId },
    ] }, { schemaVersion: '2.0', position: 3 }))
    expect(ledger.history[2]?.snapshot).toMatchObject({ name: 'After' })
    expect(ledger.history[2]?.snapshot).not.toHaveProperty('description')
    const overlay = buildChangeOverlays({ ...base, projectPosition: 3, components: [b], relationships: [], ledger })
    expect(overlay.extraComponents[0]?.component.name).toBe('After')
    expect(overlay.extraRelationships[0]?.relationship.relationshipId).toBe(edge.relationshipId)
    expect(overlay.extraComponents[0]?.overlay.state).toBe('removed')
  })

  it('does not invent a descriptor from a future snapshot or an unseen removal', () => {
    const event = streamedEvent('model.mutation_applied', { expectedModelRevision: 1, operations: [{ op: 'component.remove', componentId: 'unseen' }] }, { schemaVersion: '2.0', position: 2 })
    const ledger = ingestEvent(observeModel(EMPTY_LEDGER, { ...base, projectPosition: 3 }, 2), event)
    expect(ledger.history[0]?.snapshot).toBeNull()
    const overlay = buildChangeOverlays({ ...base, projectPosition: 2, ledger })
    expect(overlay.extraComponents).toHaveLength(0)
    expect(overlay.evidence?.get('component:unseen')).toHaveLength(1)
    expect(buildChangeOverlays({ ...base, ledger }).evidence?.size).toBe(0)
  })

  it('keeps equal work-step IDs in different runs independent and maps typed completion', () => {
    let ledger = EMPTY_LEDGER
    for (const [i, runId] of ['run-one', 'run-two'].entries()) ledger = ingestEvent(ledger, streamedEvent('work.reported', { report: {
      action: 'step_start', workStepId: 'step-shared', title: 'Work', componentIds: [a.componentId],
    } }, { schemaVersion: '2.0', position: i + 1, runId }))
    ledger = ingestEvent(ledger, streamedEvent('work.reported', { report: { action: 'step_complete', workStepId: 'step-shared', summary: 'Done' } }, { schemaVersion: '2.0', position: 3, runId: 'run-one' }))
    expect(openWorkSteps(ledger).map((one) => one.runId)).toEqual(['run-two'])
  })

  it('merges live and hydrated overlapping scopes; clear and finish affect only their owner', () => {
    const scope = { componentIds: [a.componentId], relationshipIds: [edge.relationshipId] }
    const event = streamedEvent('work.scope_reported', { scope }, { schemaVersion: '2.0', position: 3, agentId: 'agent-a' })
    let ledger = ingestEvent(EMPTY_LEDGER, event)
    const agents = { projectPosition: 2, agents: [agent({ agentId: 'agent-b', workScope: scope, workScopePosition: 2 })] }
    const overlay = buildChangeOverlays({ ...base, ledger, agents })
    expect(overlay.components.get(a.componentId)?.agentIds).toEqual(['agent-b', 'agent-a'])
    expect(overlay.relationships.get(edge.relationshipId)?.contributions).toHaveLength(2)
    ledger = ingestEvent(ledger, streamedEvent('work.reported', { report: { action: 'agent_finish', outcome: 'completed', summary: 'Done' } }, { schemaVersion: '2.0', position: 4, agentId: 'agent-a' }))
    const terminal = buildChangeOverlays({ ...base, ledger, agents })
    expect(terminal.components.get(a.componentId)?.state).toBe('active')
    expect(terminal.evidence?.get(`component:${a.componentId}`)?.find((one) => one.agentId === 'agent-a')?.terminal).toBe(true)
    const closed = buildChangeOverlays({ ...base, ledger, agents, terminalRunId: RUN_ID })
    expect(closed.total).toBe(0)
    expect(closed.evidence?.get(`component:${a.componentId}`)).toHaveLength(2)
    expect(buildChangeOverlays({ ...base, components: [], relationships: [], ledger, agents }).total).toBe(0)
    const cleared = ingestEvent(EMPTY_LEDGER, streamedEvent('work.scope_reported', { scope: { componentIds: [], relationshipIds: [] } }, { schemaVersion: '2.0', position: 4, agentId: 'agent-b' }))
    expect(buildChangeOverlays({ ...base, ledger: cleared, agents }).total).toBe(0)
  })

  it('does not complete steps on status done and lets a newer working report supersede stale hydration', () => {
    let ledger = ingestEvent(EMPTY_LEDGER, streamedEvent('work.reported', { report: { action: 'step_start', workStepId: 'step-one', title: 'Working', componentIds: [a.componentId] } }, { schemaVersion: '2.0', position: 1 }))
    ledger = ingestEvent(ledger, streamedEvent('work.scope_reported', { scope: { componentIds: [a.componentId], relationshipIds: [edge.relationshipId] } }, { schemaVersion: '2.0', position: 2 }))
    ledger = ingestEvent(ledger, streamedEvent('work.reported', { report: { action: 'status', status: 'done' } }, { schemaVersion: '2.0', position: 3 }))
    expect(buildChangeOverlays({ ...base, ledger }).total).toBe(0)
    expect(openWorkSteps(ledger)).toHaveLength(1)
    ledger = ingestEvent(ledger, streamedEvent('agent.status_reported', { status: 'working' }, { position: 4 }))
    const resumed = buildChangeOverlays({ ...base, ledger, agents: { projectPosition: 3, agents: [agent({ status: 'done' })] } })
    expect(resumed.components.get(a.componentId)?.contributions.map((one) => one.source)).toEqual(['work_step', 'work_scope'])
    expect(resumed.relationships.get(edge.relationshipId)?.state).toBe('active')
  })

  it('treats prototype-named run IDs as normal scope identities', () => {
    const ledger = ingestEvent(EMPTY_LEDGER, streamedEvent('work.scope_reported', { scope: { componentIds: [a.componentId], relationshipIds: [] } }, { schemaVersion: '2.0', position: 2, runId: 'constructor' }))
    expect(buildChangeOverlays({ ...base, ledger }).components.get(a.componentId)?.state).toBe('active')
  })

  it('never renders an ID-only removal using a pending proposal descriptor', () => {
    const ledger = ingestEvent(EMPTY_LEDGER, streamedEvent('model.mutation_applied', { expectedModelRevision: 1, operations: [{ op: 'component.remove', componentId: a.componentId }] }, { schemaVersion: '2.0', position: 3 }))
    const overlay = buildChangeOverlays({ ...base, components: [], relationships: [], projectPosition: 3, ledger,
      activeChanges: [{ changeId: 'rename-plan', targetKind: 'component', targetId: a.componentId, operation: 'modify', state: 'planned', agentId: 'planner', runId: RUN_ID, position: 1, plannedAt: a.appliedAt, appliedAt: null, retractedAt: null, snapshot: { ...a, name: 'Never applied' } }],
    })
    expect(overlay.extraComponents).toHaveLength(0)
    expect(overlay.evidence?.get(`component:${a.componentId}`)?.map((one) => one.source)).toEqual(['planned_change', 'applied_change'])
  })

  it('does not resurrect an absent component or edge from older applied replay', () => {
    const ledger = ingestEvent(EMPTY_LEDGER, streamedEvent('model.mutation_applied', { expectedModelRevision: 1, operations: [
      { op: 'component.add', component: a }, { op: 'relationship.add', relationship: edge },
    ] }, { schemaVersion: '2.0', position: 2 }))
    const overlay = buildChangeOverlays({ ...base, projectPosition: 5, components: [b], relationships: [], ledger })
    expect(overlay.extraComponents).toHaveLength(0)
    expect(overlay.extraRelationships).toHaveLength(0)
    expect(overlay.evidence?.size).toBe(2)
  })
})
