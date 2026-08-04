/**
 * The representative `full` run.
 *
 * The sequence is built to satisfy the lifecycle rules the backend enforces
 * (ADR 0004), which the standalone examples in `api/examples/` deliberately do
 * not: a run is opened by exactly one root orchestrator, every agent reports
 * `agent.started` before its first other event, and every `parentAgentId` names
 * an agent that already started. The examples are illustrations; this is a
 * runnable order.
 */
import { SequenceBuilder, type Agent } from '../sequence.js'
import type { Scenario } from '../types.js'
import {
  COMPONENT_IDS as C,
  NOTIFICATIONS_ORDERS_RELATIONSHIP,
  PRICING_TAX_RELATIONSHIP,
  RELATIONSHIP_IDS as R,
  ROUNDING_COMPONENT,
  SNAPSHOT_COMPONENTS,
  SNAPSHOT_RELATIONSHIPS,
  TAX_COMPONENT,
  TAX_ROUNDING_RELATIONSHIP,
} from './architecture.js'
import {
  CHANGE_IDS,
  LEGACY_REMOVAL_DIFF,
  NOTIFICATIONS_DIFF,
  PRICING_DIFF,
  TAX_DIFF,
  TAX_TEST_DIFF,
  type DiffFile,
} from './diffs.js'
import { NOTIFICATIONS_FEEDBACK, PRICING_TAX_FEEDBACK } from './feedback.js'

export const FULL_RUN_ID = 'run-2026-08-04-0001'

/**
 * The agent tree. Four subagents below one root, two of them delegated by
 * another subagent — depth 3 including the root, with two branches running in
 * parallel at the deepest level.
 */
const ORCHESTRATOR: Agent = { agentId: 'orchestrator-root', parentAgentId: null }
const ARCHITECT: Agent = { agentId: 'subagent-architecture-mapper', parentAgentId: 'orchestrator-root' }
const IMPLEMENTER: Agent = { agentId: 'subagent-implementer', parentAgentId: 'orchestrator-root' }
const REVIEWER: Agent = { agentId: 'subagent-reviewer', parentAgentId: 'subagent-implementer' }
const TESTER: Agent = { agentId: 'subagent-test-engineer', parentAgentId: 'subagent-implementer' }

const PLAN_ID = 'plan-2026-08-04-0001'
const SNAPSHOT_ID = 'snapshot-2026-08-04-0001'

const STEP = {
  map: 'step-map-architecture',
  extract: 'step-extract-tax',
  dropLegacy: 'step-drop-legacy-rates',
  review: 'step-review-extraction',
  cover: 'step-cover-with-tests',
} as const

const WORK = {
  map: 'work-2026-08-04-0001',
  extract: 'work-2026-08-04-0002',
  review: 'work-2026-08-04-0003',
  tests: 'work-2026-08-04-0004',
} as const

export interface FullScenarioOptions {
  projectId: string
  runId: string
  seed: number
  /**
   * Whether the orchestrator closes the run. Off by default: a run without a
   * terminal event is the state that proves the cockpit derives nothing from
   * silence, and it is the more interesting thing to look at in the browser.
   */
  finish: boolean
}

/** Turns a diff file into a `diff.reported` payload. */
function diffPayload(diff: DiffFile): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    diffId: diff.diffId,
    componentIds: diff.componentIds,
    filePath: diff.filePath,
    unifiedDiff: diff.unifiedDiff,
  }
  if (diff.changeId !== undefined) {
    payload.changeId = diff.changeId
  }
  return payload
}

export function buildFullScenario(options: FullScenarioOptions): Scenario {
  const b = new SequenceBuilder({
    projectId: options.projectId,
    runId: options.runId,
    seed: options.seed,
    scenarioLabel: 'full',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Run start')
  // -------------------------------------------------------------------------
  b.emit(ORCHESTRATOR, 'agent.started', {
    role: 'orchestrator',
    displayName: 'Root Orchestrator',
    assignedTask: 'Extract VAT handling out of the pricing module and keep the architecture model current.',
    capabilities: ['planning', 'delegation', 'review'],
  })
  b.emit(ORCHESTRATOR, 'agent.status_reported', {
    status: 'working',
    note: 'Mapping the current architecture before delegating anything.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Subagents spawn')
  // -------------------------------------------------------------------------
  b.emit(ARCHITECT, 'agent.started', {
    role: 'subagent',
    displayName: 'Architecture Mapper',
    assignedTask: 'Publish the applied architecture model and keep it in sync with the change.',
    capabilities: ['static-analysis', 'architecture'],
  })
  b.emit(IMPLEMENTER, 'agent.started', {
    role: 'subagent',
    displayName: 'Implementer',
    assignedTask: 'Move VAT handling out of pricing into its own module.',
    capabilities: ['go', 'refactoring'],
  })
  // Delegated by the implementer, not by the root: the tree is three levels deep.
  b.emit(REVIEWER, 'agent.started', {
    role: 'subagent',
    displayName: 'Reviewer',
    assignedTask: 'Review the extraction and report component-scoped feedback.',
    capabilities: ['review', 'go'],
  })
  b.emit(TESTER, 'agent.started', {
    role: 'subagent',
    displayName: 'Test Engineer',
    assignedTask: 'Cover the new tax module with table tests.',
    capabilities: ['go', 'testing'],
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Architecture snapshot')
  // -------------------------------------------------------------------------
  b.emit(ARCHITECT, 'agent.status_reported', {
    status: 'working',
    note: 'Reading the module graph.',
  })
  b.emit(ARCHITECT, 'work.step_started', {
    workStepId: WORK.map,
    title: 'Map the applied architecture',
    componentIds: [C.system, C.orders, C.ordersDomain, C.pricing, C.events],
    planStepId: STEP.map,
  })
  b.emit(ARCHITECT, 'architecture.snapshot_published', {
    snapshotId: SNAPSHOT_ID,
    components: SNAPSHOT_COMPONENTS,
    relationships: SNAPSHOT_RELATIONSHIPS,
  })
  b.emit(ARCHITECT, 'work.step_completed', {
    workStepId: WORK.map,
    summary: '17 components across four hierarchy levels, 11 relationships, two NATS topics.',
  })
  b.emit(ARCHITECT, 'agent.progress_reported', {
    percent: 40,
    scope: 'own_task',
    basis: 'completed_steps',
    note: 'Model published; the change itself is still open.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Plan')
  // -------------------------------------------------------------------------
  b.emit(ORCHESTRATOR, 'plan.published', {
    planId: PLAN_ID,
    revision: 1,
    steps: [
      {
        stepId: STEP.map,
        order: 0,
        title: 'Map the applied architecture',
        state: 'done',
        componentIds: [C.system],
      },
      {
        stepId: STEP.extract,
        order: 1,
        title: 'Extract VAT handling into a tax module',
        state: 'in_progress',
        componentIds: [C.pricing, C.tax],
      },
      {
        stepId: STEP.review,
        order: 2,
        title: 'Review the extraction',
        state: 'pending',
        componentIds: [C.pricing, C.tax],
      },
      {
        stepId: STEP.cover,
        order: 3,
        title: 'Cover the tax module with table tests',
        state: 'pending',
        componentIds: [C.tax],
      },
    ],
  })
  // The orchestrator estimates the whole run; the subagents above and below
  // report their own task. The two scopes must stay visibly different.
  b.emit(ORCHESTRATOR, 'agent.progress_reported', {
    percent: 20,
    scope: 'overall_estimate',
    basis: 'reported_estimate',
    note: 'One of four planned steps done.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Proposed changes')
  // -------------------------------------------------------------------------
  b.emit(ARCHITECT, 'component.change_planned', {
    changeId: CHANGE_IDS.addTax,
    operation: 'add',
    component: TAX_COMPONENT,
    rationale: 'Pricing mixes discount and VAT rules, which makes country-specific rates hard to test.',
  })
  b.emit(ARCHITECT, 'relationship.change_planned', {
    changeId: CHANGE_IDS.linkPricingToTax,
    operation: 'add',
    relationship: PRICING_TAX_RELATIONSHIP,
    rationale: 'Pricing will delegate the VAT calculation to the new module.',
  })
  b.emit(ARCHITECT, 'component.change_planned', {
    changeId: CHANGE_IDS.dropLegacyTaxRates,
    operation: 'remove',
    component: {
      componentId: C.legacyTaxRates,
      name: 'Legacy Tax Rates',
      kind: 'module',
      parentComponentId: C.ordersDomain,
      description: 'Superseded by the tax module.',
    },
    rationale: 'The hard-coded German rate has no callers once pricing delegates to tax.',
  })
  b.emit(ARCHITECT, 'relationship.change_planned', {
    changeId: CHANGE_IDS.dropLegacyTaxDependency,
    operation: 'remove',
    relationship: {
      relationshipId: R.pricingLegacyTaxRates,
      sourceComponentId: C.pricing,
      targetComponentId: C.legacyTaxRates,
      kind: 'dependency',
    },
    rationale: 'Removed together with the component it points at.',
  })
  // Planned here and withdrawn again further down, so the cockpit has a
  // retracted proposal to show.
  const withdrawnPlan = b.emit(ARCHITECT, 'relationship.change_planned', {
    changeId: CHANGE_IDS.notificationsReadsOrders,
    operation: 'add',
    relationship: NOTIFICATIONS_ORDERS_RELATIONSHIP,
    rationale: 'The mail body needs order details the topic message does not carry.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Implementation')
  // -------------------------------------------------------------------------
  b.emit(IMPLEMENTER, 'agent.status_reported', {
    status: 'working',
    note: 'Rewriting Total().',
  })
  b.emit(IMPLEMENTER, 'work.step_started', {
    workStepId: WORK.extract,
    title: 'Extract VAT handling into internal/orders/domain/tax',
    componentIds: [C.pricing, C.tax, C.legacyTaxRates],
    planStepId: STEP.extract,
  })
  const pricingDiff = b.emit(IMPLEMENTER, 'diff.reported', diffPayload(PRICING_DIFF))
  b.emit(IMPLEMENTER, 'diff.reported', diffPayload(TAX_DIFF))
  b.emit(IMPLEMENTER, 'diff.reported', diffPayload(TAX_TEST_DIFF))
  b.emit(IMPLEMENTER, 'agent.progress_reported', {
    percent: 65,
    scope: 'own_task',
    basis: 'completed_steps',
    note: 'Tax module compiles; the legacy package is still referenced by tests.',
  })
  // The first diff named only the pricing module although it also introduces the
  // tax import. The log is append-only, so the fix is a new event, not an edit.
  b.emit(IMPLEMENTER, 'correction.issued', {
    correctsClientEventId: pricingDiff,
    reason: 'The diff was attributed to the pricing module only; it also introduces the tax dependency.',
    correctedType: 'diff.reported',
    correctedPayload: {
      ...diffPayload(PRICING_DIFF),
      componentIds: [C.pricing, C.tax],
    },
  })
  b.emit(IMPLEMENTER, 'diff.reported', diffPayload(LEGACY_REMOVAL_DIFF))
  b.emit(IMPLEMENTER, 'diff.reported', diffPayload(NOTIFICATIONS_DIFF))

  // -------------------------------------------------------------------------
  b.beginPhase('Applied changes')
  // -------------------------------------------------------------------------
  b.emit(ARCHITECT, 'component.change_applied', {
    changeId: CHANGE_IDS.addTax,
    operation: 'add',
    component: TAX_COMPONENT,
  })
  b.emit(ARCHITECT, 'relationship.change_applied', {
    changeId: CHANGE_IDS.linkPricingToTax,
    operation: 'add',
    relationship: PRICING_TAX_RELATIONSHIP,
  })
  b.emit(ARCHITECT, 'relationship.change_applied', {
    changeId: CHANGE_IDS.dropLegacyTaxDependency,
    operation: 'remove',
    relationship: {
      relationshipId: R.pricingLegacyTaxRates,
      sourceComponentId: C.pricing,
      targetComponentId: C.legacyTaxRates,
      kind: 'dependency',
    },
  })
  b.emit(ARCHITECT, 'component.change_applied', {
    changeId: CHANGE_IDS.dropLegacyTaxRates,
    operation: 'remove',
    component: {
      componentId: C.legacyTaxRates,
      name: 'Legacy Tax Rates',
      kind: 'module',
      parentComponentId: C.ordersDomain,
    },
  })
  b.emit(ARCHITECT, 'retraction.issued', {
    retractsClientEventId: withdrawnPlan,
    reason: 'The topic message will carry the missing fields instead, so no HTTP edge is needed.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Review')
  // -------------------------------------------------------------------------
  b.emit(REVIEWER, 'agent.status_reported', { status: 'working', note: 'Reading the extraction.' })
  b.emit(REVIEWER, 'work.step_started', {
    workStepId: WORK.review,
    title: 'Review the VAT extraction',
    componentIds: [C.pricing, C.tax],
    planStepId: STEP.review,
  })
  b.emit(REVIEWER, 'feedback.published', {
    feedbackId: 'feedback-2026-08-04-0001',
    componentIds: [C.pricing, C.tax],
    format: 'markdown',
    title: 'VAT extraction changes the discount order',
    body: PRICING_TAX_FEEDBACK,
  })
  b.emit(REVIEWER, 'feedback.published', {
    feedbackId: 'feedback-2026-08-04-0002',
    componentIds: [C.notifications, C.topicOrderCreated],
    format: 'markdown',
    title: 'Notification consumer follows the renamed amount fields',
    body: NOTIFICATIONS_FEEDBACK,
  })
  b.emit(REVIEWER, 'risk.reported', {
    riskId: 'risk-2026-08-04-0001',
    componentIds: [C.pricing, C.tax],
    title: 'Discount and VAT order changed without a migration note',
    detail:
      'Orders priced before and after the change are not comparable. Nothing in this run checked historical orders.',
    severity: 'medium',
  })
  b.emit(REVIEWER, 'problem.reported', {
    problemId: 'problem-2026-08-04-0001',
    componentIds: [C.notifications],
    title: 'Mail template still prints a single amount',
    detail:
      'The consumer reads Total and Vat separately, but the template was not touched, so the VAT line is not shown.',
  })
  b.emit(REVIEWER, 'agent.progress_reported', {
    percent: 80,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(REVIEWER, 'work.step_completed', {
    workStepId: WORK.review,
    summary: 'Two feedback items, one risk, one problem.',
  })
  b.emit(REVIEWER, 'agent.status_reported', {
    status: 'blocked',
    note: 'Waiting for a decision on the fallback VAT rate.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Tests')
  // -------------------------------------------------------------------------
  b.emit(TESTER, 'agent.status_reported', { status: 'working', note: 'Writing the table test.' })
  b.emit(TESTER, 'work.step_started', {
    workStepId: WORK.tests,
    title: 'Cover tax.Rate.Apply with a table test',
    componentIds: [C.tax],
    planStepId: STEP.cover,
  })
  b.emit(TESTER, 'agent.status_reported', {
    status: 'waiting',
    note: 'Waiting for the reviewer to settle the fallback rate before pinning it down.',
  })
  b.emit(TESTER, 'work.step_completed', {
    workStepId: WORK.tests,
    summary: 'Four countries covered, including the fallback.',
  })
  b.emit(TESTER, 'agent.progress_reported', {
    percent: 100,
    scope: 'own_task',
    basis: 'completed_steps',
  })
  b.emit(TESTER, 'agent.status_reported', { status: 'done' })
  b.emit(TESTER, 'agent.finished', {
    outcome: 'completed',
    summary: 'tax_test.go covers DE, AT, CH and the fallback country.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Plan revision')
  // -------------------------------------------------------------------------
  // A revision is a full republish of the plan under the same planId. The
  // earlier revision keeps the step states it was last seen with.
  b.emit(ORCHESTRATOR, 'plan.published', {
    planId: PLAN_ID,
    revision: 2,
    steps: [
      {
        stepId: STEP.map,
        order: 0,
        title: 'Map the applied architecture',
        state: 'done',
        componentIds: [C.system],
      },
      {
        stepId: STEP.extract,
        order: 1,
        title: 'Extract VAT handling into a tax module',
        state: 'done',
        componentIds: [C.pricing, C.tax],
      },
      {
        stepId: STEP.dropLegacy,
        order: 2,
        title: 'Remove the legacy VAT table',
        state: 'in_progress',
        componentIds: [C.legacyTaxRates],
      },
      {
        stepId: STEP.review,
        order: 3,
        title: 'Review the extraction',
        state: 'done',
        componentIds: [C.pricing, C.tax],
      },
      {
        stepId: STEP.cover,
        order: 4,
        title: 'Cover the tax module with table tests',
        state: 'done',
        componentIds: [C.tax],
      },
    ],
  })
  b.emit(ORCHESTRATOR, 'plan.step_updated', {
    planId: PLAN_ID,
    stepId: STEP.dropLegacy,
    state: 'done',
    note: 'Legacy package deleted and the dependency edge removed.',
  })
  b.emit(ORCHESTRATOR, 'plan.step_updated', {
    planId: PLAN_ID,
    stepId: STEP.review,
    state: 'skipped',
    note: 'Re-review of the fallback rate deferred to a follow-up run.',
  })
  b.emit(ORCHESTRATOR, 'agent.progress_reported', {
    percent: 70,
    scope: 'overall_estimate',
    basis: 'reported_estimate',
    note: 'Implementation done; the fallback rate decision is still open.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Open proposals')
  // -------------------------------------------------------------------------
  // Planned and neither applied nor retracted, so the run ends with something in
  // `activeChanges`. Without it the cockpit would have no pending proposal left
  // to render once the run goes quiet, and the `planned` overlay state would only
  // ever be visible while the simulator is mid-flight.
  b.emit(ARCHITECT, 'component.change_planned', {
    changeId: CHANGE_IDS.addRounding,
    operation: 'add',
    component: ROUNDING_COMPONENT,
    rationale: 'Rounding is stated inside tax.Apply today; a shared module would keep it one rule.',
  })
  b.emit(ARCHITECT, 'relationship.change_planned', {
    changeId: CHANGE_IDS.linkTaxToRounding,
    operation: 'add',
    relationship: TAX_ROUNDING_RELATIONSHIP,
    rationale: 'The tax module would delegate the half-up rounding instead of implementing it.',
  })

  // -------------------------------------------------------------------------
  b.beginPhase('Wind down')
  // -------------------------------------------------------------------------
  b.emit(REVIEWER, 'agent.status_reported', { status: 'done' })
  b.emit(REVIEWER, 'agent.finished', {
    outcome: 'completed',
    summary: 'Extraction reviewed; the fallback rate stays an open question.',
  })
  b.emit(IMPLEMENTER, 'work.step_completed', {
    workStepId: WORK.extract,
    summary: 'Pricing delegates to tax; the legacy package is gone.',
  })
  b.emit(IMPLEMENTER, 'agent.status_reported', { status: 'done' })
  b.emit(IMPLEMENTER, 'agent.finished', {
    outcome: 'completed',
    summary: 'VAT handling extracted, five files reported as unified diffs.',
  })
  b.emit(ARCHITECT, 'agent.status_reported', { status: 'done' })
  b.emit(ARCHITECT, 'agent.finished', {
    outcome: 'completed',
    summary: 'Model updated: tax added, the legacy module and its edge removed.',
  })
  b.emit(ORCHESTRATOR, 'agent.status_reported', {
    status: 'idle',
    note: 'All subagents finished. The fallback rate decision is left to the human reviewer.',
  })

  if (options.finish) {
    // -----------------------------------------------------------------------
    b.beginPhase('Run finished')
    // -----------------------------------------------------------------------
    b.emit(ORCHESTRATOR, 'run.finished', {
      outcome: 'completed',
      summary:
        'VAT handling extracted into its own module, the architecture model updated and the review reported.',
    })
  }

  return {
    name: 'full',
    projectId: options.projectId,
    runId: options.runId,
    steps: b.build(),
  }
}
