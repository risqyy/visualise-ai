import type {
  ActiveChange,
  ComponentHistoryEntry,
  ComponentHistoryResponse,
  ComponentInspectorResponse,
  FeedbackEntry,
  InspectorWorkStep,
  ReportedDiff,
  ReportedProblem,
  ReportedRisk,
} from '@/api/types'

import { agent, component, PROJECT_ID, RUN_ID } from './fixtures'

/**
 * Contract-shaped inspector fixtures.
 *
 * They mirror what the simulator actually reports (`simulator/src/scenarios/`):
 * three single-file diffs sharing `change-2026-08-04-0007`, one diff of another
 * change, one unattributed diff, and markdown feedback with headings, lists,
 * inline code and a fenced block. Reusing the simulator's shape means a test
 * that passes here describes the demo run rather than an invented one.
 */

export const COMPONENT_ID = 'shop-platform.orders.domain.tax'
export const OLDER_RUN_ID = 'run-2026-08-03-0001'

export const CHANGE_ID = 'change-2026-08-04-0007'
export const OTHER_CHANGE_ID = 'change-2026-08-04-0009'

export const REVIEWER_AGENT_ID = 'subagent-reviewer'
export const IMPLEMENTER_AGENT_ID = 'subagent-implementer'

const FENCE = '```'

/** Markdown with the constructs the renderer has to handle. Trusted content. */
export const FEEDBACK_MARKDOWN = [
  '## Was ich angesehen habe',
  '',
  'Die Extraktion der Steuerlogik aus `pricing` in das neue Modul `tax`.',
  '',
  '1. **Die Reihenfolge hat sich geändert.**',
  '2. Die Rundung ist jetzt einmal pro Bestellung festgelegt.',
  '',
  '- offener Punkt: Fallback-Land',
  '',
  FENCE + 'go',
  'total := discounted.Add(tax.For(order.DeliveryCountry).Apply(discounted))',
  FENCE,
  '',
].join('\n')

export function feedbackEntry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    feedbackId: 'feedback-2026-08-04-0001',
    runId: RUN_ID,
    agentId: REVIEWER_AGENT_ID,
    format: 'markdown',
    title: 'Steuerlogik extrahiert',
    body: FEEDBACK_MARKDOWN,
    createdAt: '2026-08-04T09:20:00Z',
    position: 30,
    ...overrides,
  }
}

export function reportedDiff(overrides: Partial<ReportedDiff> = {}): ReportedDiff {
  return {
    diffId: 'diff-2026-08-04-0011',
    runId: RUN_ID,
    agentId: IMPLEMENTER_AGENT_ID,
    changeId: CHANGE_ID,
    filePath: 'internal/orders/domain/pricing/pricing.go',
    unifiedDiff: [
      '--- a/internal/orders/domain/pricing/pricing.go',
      '+++ b/internal/orders/domain/pricing/pricing.go',
      '@@ -18,5 +18,5 @@ func (p *Pricing) Total(order Order) money.Amount {',
      ' \tsum := money.Zero(order.Currency)',
      '-\tvat := legacy.RateDE',
      '+\tvat := tax.For(order.DeliveryCountry)',
      ' \treturn sum.Add(vat)',
      '',
    ].join('\n'),
    createdAt: '2026-08-04T09:15:00Z',
    position: 21,
    ...overrides,
  }
}

/** The three files of `change-2026-08-04-0007`, as the simulator reports them. */
export const CHANGE_DIFFS: ReportedDiff[] = [
  reportedDiff(),
  reportedDiff({
    diffId: 'diff-2026-08-04-0012',
    filePath: 'internal/orders/domain/tax/tax.go',
    position: 22,
    unifiedDiff: [
      '--- /dev/null',
      '+++ b/internal/orders/domain/tax/tax.go',
      '@@ -0,0 +1,4 @@',
      '+package tax',
      '+',
      '+// For returns the rate of a delivery country.',
      '+func For(country string) Rate { return rates[country] }',
      '',
    ].join('\n'),
  }),
  reportedDiff({
    diffId: 'diff-2026-08-04-0013',
    filePath: 'internal/orders/domain/tax/tax_test.go',
    position: 23,
    unifiedDiff: [
      '--- /dev/null',
      '+++ b/internal/orders/domain/tax/tax_test.go',
      '@@ -0,0 +1,2 @@',
      '+package tax_test',
      '+',
      '',
    ].join('\n'),
  }),
]

/** A second change, by a different agent — must never merge with the first. */
export const OTHER_CHANGE_DIFF = reportedDiff({
  diffId: 'diff-2026-08-04-0014',
  changeId: OTHER_CHANGE_ID,
  agentId: REVIEWER_AGENT_ID,
  filePath: 'internal/orders/domain/legacy/tax_rates.go',
  position: 24,
  unifiedDiff: [
    '--- a/internal/orders/domain/legacy/tax_rates.go',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-package legacy',
    '-const RateDE = 0.19',
    '',
  ].join('\n'),
})

/** Reported without a `changeId`: an unplanned fix that stands on its own. */
export const UNATTRIBUTED_DIFF = reportedDiff({
  diffId: 'diff-2026-08-04-0015',
  changeId: null,
  filePath: 'internal/notifications/consumer.go',
  position: 25,
  unifiedDiff: [
    '--- a/internal/notifications/consumer.go',
    '+++ b/internal/notifications/consumer.go',
    '@@ -27,3 +27,3 @@ func (c *Consumer) Start(ctx context.Context) error {',
    '-\tc.total = c.total.Add(msg.Order.Gross)',
    '+\tc.total = c.total.Add(msg.Order.Total)',
    ' \treturn nil',
    '',
  ].join('\n'),
})

export const ALL_DIFFS: ReportedDiff[] = [
  UNATTRIBUTED_DIFF,
  OTHER_CHANGE_DIFF,
  ...[...CHANGE_DIFFS].reverse(),
]

export function workStep(overrides: Partial<InspectorWorkStep> = {}): InspectorWorkStep {
  return {
    workStepId: 'work-2026-08-04-0003',
    runId: RUN_ID,
    agentId: IMPLEMENTER_AGENT_ID,
    planStepId: 'step-extract-tax',
    title: 'Steuerlogik in ein eigenes Modul ziehen',
    startedAt: '2026-08-04T09:10:00Z',
    completedAt: null,
    summary: null,
    position: 20,
    ...overrides,
  }
}

export const RISK: ReportedRisk = {
  riskId: 'risk-2026-08-04-0001',
  runId: RUN_ID,
  agentId: REVIEWER_AGENT_ID,
  title: 'Unbekanntes Lieferland fällt still auf 19 % zurück',
  detail: 'Der Fallback ist für Deutschland richtig und überall sonst falsch.',
  severity: 'medium',
  createdAt: '2026-08-04T09:21:00Z',
  position: 31,
}

export const PROBLEM: ReportedProblem = {
  problemId: 'problem-2026-08-04-0001',
  runId: RUN_ID,
  agentId: IMPLEMENTER_AGENT_ID,
  title: 'Der Replay-Pfad des Notification-Consumers ist ungeprüft',
  detail: '',
  createdAt: '2026-08-04T09:22:00Z',
  position: 32,
}

export const ACTIVE_CHANGE: ActiveChange = {
  changeId: 'change-2026-08-04-0012',
  targetKind: 'component',
  targetId: COMPONENT_ID,
  operation: 'modify',
  state: 'planned',
  runId: RUN_ID,
  agentId: IMPLEMENTER_AGENT_ID,
  plannedAt: '2026-08-04T09:25:00Z',
  appliedAt: null,
  retractedAt: null,
  snapshot: {},
  position: 33,
}

export function inspectorPage(
  overrides: Partial<ComponentInspectorResponse> = {},
): ComponentInspectorResponse {
  return {
    projectPosition: 42,
    runId: RUN_ID,
    component: component({ componentId: COMPONENT_ID, name: 'Tax', kind: 'module' }),
    responsibleAgent: agent({
      agentId: IMPLEMENTER_AGENT_ID,
      parentAgentId: 'orchestrator-root',
      role: 'subagent',
      displayName: 'Implementer',
      assignedTask: 'Steuerlogik aus pricing extrahieren.',
      status: 'working',
      statusNote: 'Tests laufen',
    }),
    currentWorkStep: workStep(),
    feedback: [feedbackEntry()],
    diffs: ALL_DIFFS,
    nextDiffCursor: null,
    risks: [RISK],
    problems: [PROBLEM],
    activeChanges: [ACTIVE_CHANGE],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const ORIGINAL_CLIENT_EVENT_ID = '11111111-1111-4111-8111-111111111111'
const RETRACTED_CLIENT_EVENT_ID = '22222222-2222-4222-8222-222222222222'

export function historyEntry(
  overrides: Partial<ComponentHistoryEntry> = {},
): ComponentHistoryEntry {
  return {
    position: 10,
    serverEventId: 'aaaaaaaa-0000-4000-8000-000000000010',
    clientEventId: ORIGINAL_CLIENT_EVENT_ID,
    runId: OLDER_RUN_ID,
    agentId: REVIEWER_AGENT_ID,
    parentAgentId: 'orchestrator-root',
    type: 'feedback.published',
    schemaVersion: '1.0',
    occurredAt: '2026-08-03T11:00:00Z',
    receivedAt: '2026-08-03T11:00:01Z',
    payload: {},
    ...overrides,
  }
}

/**
 * Newest first: a retraction, a correction, and the two statements they refer
 * to. Both originals stay in the list — that is the property under test.
 */
export const HISTORY_ENTRIES: ComponentHistoryEntry[] = [
  historyEntry({
    position: 13,
    serverEventId: 'aaaaaaaa-0000-4000-8000-000000000013',
    clientEventId: '44444444-4444-4444-8444-444444444444',
    type: 'retraction.issued',
    occurredAt: '2026-08-03T12:00:00Z',
    payload: {
      retractsClientEventId: RETRACTED_CLIENT_EVENT_ID,
      reason: 'Der gemeldete Diff gehörte zu einer anderen Komponente.',
    },
  }),
  historyEntry({
    position: 12,
    serverEventId: 'aaaaaaaa-0000-4000-8000-000000000012',
    clientEventId: '33333333-3333-4333-8333-333333333333',
    type: 'correction.issued',
    occurredAt: '2026-08-03T11:30:00Z',
    payload: {
      correctsClientEventId: ORIGINAL_CLIENT_EVENT_ID,
      reason: 'Die Rundungsaussage war falsch herum formuliert.',
      correctedType: 'feedback.published',
      correctedPayload: {},
    },
  }),
  historyEntry({
    position: 11,
    serverEventId: 'aaaaaaaa-0000-4000-8000-000000000011',
    clientEventId: RETRACTED_CLIENT_EVENT_ID,
    type: 'diff.reported',
    occurredAt: '2026-08-03T11:15:00Z',
  }),
  historyEntry(),
]

export function historyPage(
  overrides: Partial<ComponentHistoryResponse> = {},
): ComponentHistoryResponse {
  return {
    projectPosition: 42,
    entries: HISTORY_ENTRIES,
    nextCursor: null,
    ...overrides,
  }
}

export const INSPECTOR_PATH = `/api/v1/projects/${PROJECT_ID}/components/${COMPONENT_ID}`
export const HISTORY_PATH = `${INSPECTOR_PATH}/history`
