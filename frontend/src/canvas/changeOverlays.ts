import {
  changeSnapshot,
  type ActiveChange,
  type AgentId,
  type AppliedComponent,
  type AppliedRelationship,
  type ChangeOperation,
  type Component,
  type ComponentId,
  type Identifier,
  type Relationship,
  type RunId,
  type Timestamp,
} from '@/api/types'
import {
  openWorkSteps as openWorkStepsOf,
  recentAppliedChanges,
  type ChangeLedger,
} from '@/state/changeLedger'
import { resolveWorkState, WORK_STATE_BY_ID, type WorkStateId } from '@/state/workStates'

/**
 * Builds the change overlay of one architecture snapshot.
 *
 * The overlay is drawn **next to and on top of** the applied model, never inside
 * it. That separation is not a style choice: the read API delivers the applied
 * model in `components`/`relationships` and the proposals in `activeChanges`,
 * and a planned change is by contract not part of the model. Merging the two
 * here would make the canvas assert something the agent never reported — that
 * the change already happened.
 *
 * Three kinds of element come out of this module:
 *
 * | presence   | what it is                                            |
 * | ---------- | ----------------------------------------------------- |
 * | `applied`  | an element of the applied model, with a state on it   |
 * | `proposal` | announced, not in the applied model — drawn from `ActiveChange.snapshot` |
 * | `ghost`    | removed by an applied change — kept as evidence of what disappeared |
 *
 * **Concurrent work is merged, never collapsed.** Every reported contribution
 * for the same target is kept in `contributions`, together with the agent that
 * reported it. The single work state on the element is the dominant phase
 * (`resolveWorkState` decides), but the agents behind it stay countable and
 * listable, so one agent's change can never silently overwrite another's.
 */

export type OverlayPresence = 'applied' | 'proposal' | 'ghost'

export type ContributionSource = 'planned_change' | 'applied_change' | 'work_step'

/** One reported statement about a target, kept verbatim. */
export interface OverlayContribution {
  source: ContributionSource
  agentId: AgentId
  runId: RunId
  /** `null` for a work step — it reports work, not an operation on the model. */
  operation: ChangeOperation | null
  at: Timestamp
  position: number
  /** Change id, work step id, or `null` when the agent reported none. */
  reference: Identifier | null
  /** Short human-readable description of what was reported. */
  detail: string
}

export interface ChangeOverlay {
  targetKind: 'component' | 'relationship'
  targetId: string
  state: WorkStateId
  presence: OverlayPresence
  /** Operation of the newest change; `null` when only a work step is running. */
  operation: ChangeOperation | null
  /** Every reported contribution, oldest first. Nothing is dropped. */
  contributions: OverlayContribution[]
  /** Distinct agents behind those contributions, in first-seen order. */
  agentIds: AgentId[]
  /**
   * The reported descriptor of a `proposal` or a `ghost`. `null` for an applied
   * element — that one is already in the model.
   */
  descriptor: Component | Relationship | null
}

export interface OverlayComponent {
  component: Component
  overlay: ChangeOverlay
}

export interface OverlayRelationship {
  relationship: Relationship
  overlay: ChangeOverlay
}

export type WorkStateCounts = Record<WorkStateId, number>

export const EMPTY_WORK_STATE_COUNTS: WorkStateCounts = {
  planned: 0,
  active: 0,
  recently_applied: 0,
  removed: 0,
}

export interface ChangeOverlayModel {
  /** Overlay of an applied component, by component id. */
  components: ReadonlyMap<ComponentId, ChangeOverlay>
  /** Overlay of an applied relationship, by relationship id. */
  relationships: ReadonlyMap<Identifier, ChangeOverlay>
  /** Components to draw that the applied model does not contain. */
  extraComponents: OverlayComponent[]
  /** Relationships to draw that the applied model does not contain. */
  extraRelationships: OverlayRelationship[]
  counts: WorkStateCounts
  /** Total number of elements carrying an overlay. */
  total: number
}

export const EMPTY_OVERLAY_MODEL: ChangeOverlayModel = {
  components: new Map(),
  relationships: new Map(),
  extraComponents: [],
  extraRelationships: [],
  counts: EMPTY_WORK_STATE_COUNTS,
  total: 0,
}

/**
 * German verbs for the three contract operations.
 *
 * They describe the operation and nothing else. No word here may suggest a
 * verdict: the cockpit reports what an agent is doing, it does not grade it.
 */
export const CHANGE_OPERATION_LABELS: Record<ChangeOperation, string> = {
  add: 'hinzufügen',
  modify: 'ändern',
  remove: 'entfernen',
}

export const CHANGE_OPERATION_PARTICIPLES: Record<ChangeOperation, string> = {
  add: 'hinzugefügt',
  modify: 'geändert',
  remove: 'entfernt',
}

/**
 * The label an overlay carries on the canvas — always text, never only colour.
 *
 * `geplant · entfernen` and `geplant · hinzufügen` are the same colour and the
 * same border style; the operation is what tells them apart, so it is spelled
 * out rather than encoded.
 */
export function overlayLabel(overlay: ChangeOverlay): string {
  const state = WORK_STATE_BY_ID[overlay.state].label
  if (overlay.operation === null) return state
  const operation =
    overlay.state === 'planned'
      ? CHANGE_OPERATION_LABELS[overlay.operation]
      : CHANGE_OPERATION_PARTICIPLES[overlay.operation]
  return `${state} · ${operation}`
}

/**
 * Precedence when several relationships of one drawn edge carry a state.
 *
 * Identical to the precedence `resolveWorkState` applies to a single element,
 * so a bundle can never announce a weaker phase than one of its members.
 */
const STATE_PRECEDENCE: readonly WorkStateId[] = [
  'removed',
  'active',
  'planned',
  'recently_applied',
]

/** The state a bundle of overlays shows on its line. `null` when there is none. */
export function dominantOverlay(
  overlays: readonly ChangeOverlay[],
): ChangeOverlay | null {
  let best: ChangeOverlay | null = null
  for (const overlay of overlays) {
    if (
      best === null ||
      STATE_PRECEDENCE.indexOf(overlay.state) < STATE_PRECEDENCE.indexOf(best.state)
    ) {
      best = overlay
    }
  }
  return best
}

/**
 * The full text an overlay carries in its `title`.
 *
 * Every contribution is listed with the agent that reported it, so two agents
 * working on the same component are readable line by line instead of being
 * summarised into one. The text is plain prose and states phases only — it
 * never says whether a change is good, risky or right.
 */
export function overlayTitle(overlay: ChangeOverlay): string {
  const definition = WORK_STATE_BY_ID[overlay.state]
  const lines = [`${overlayLabel(overlay)} — ${definition.description}`]
  if (overlay.presence === 'proposal') {
    lines.push('Vorschlag: nicht Teil des angewandten Architekturmodells.')
  }
  if (overlay.presence === 'ghost') {
    lines.push('Nicht mehr Teil des angewandten Architekturmodells.')
  }
  if (overlay.agentIds.length > 1) {
    lines.push(`${overlay.agentIds.length} Agents melden zu diesem Element:`)
  }
  for (const contribution of overlay.contributions) {
    lines.push(`• ${contribution.agentId}: ${contribution.detail}`)
  }
  return lines.join('\n')
}

export interface ChangeOverlayInput {
  components: readonly AppliedComponent[]
  relationships: readonly AppliedRelationship[]
  /** Pending proposals, as the read API returns them (state `planned` only). */
  activeChanges: readonly ActiveChange[]
  ledger: ChangeLedger
}

interface Draft {
  targetKind: 'component' | 'relationship'
  targetId: string
  contributions: OverlayContribution[]
  /** Newest non-work-step contribution, which decides the state. */
  latestChange: { state: 'planned' | 'applied'; operation: ChangeOperation } | null
  latestChangePosition: number
  hasActiveWorkStep: boolean
  descriptor: Component | Relationship | null
}

export function buildChangeOverlays(input: ChangeOverlayInput): ChangeOverlayModel {
  const appliedComponentIds = new Set(input.components.map((one) => one.componentId))
  const appliedRelationshipIds = new Set(
    input.relationships.map((one) => one.relationshipId),
  )

  const drafts = new Map<string, Draft>()
  const draftFor = (
    targetKind: 'component' | 'relationship',
    targetId: string,
  ): Draft => {
    const key = `${targetKind}:${targetId}`
    const existing = drafts.get(key)
    if (existing) return existing
    const created: Draft = {
      targetKind,
      targetId,
      contributions: [],
      latestChange: null,
      latestChangePosition: -1,
      hasActiveWorkStep: false,
      descriptor: null,
    }
    drafts.set(key, created)
    return created
  }

  const recordChange = (
    draft: Draft,
    phase: 'planned' | 'applied',
    operation: ChangeOperation,
    position: number,
    descriptor: Component | Relationship | null,
  ): void => {
    if (position < draft.latestChangePosition) return
    draft.latestChange = { state: phase, operation }
    draft.latestChangePosition = position
    if (descriptor !== null) draft.descriptor = descriptor
  }

  // ---- 1. pending proposals, straight from the read model -----------------
  // These are authoritative: the server drops a change from `activeChanges` the
  // moment it is applied or retracted, so a withdrawn proposal disappears here
  // without the client having to remember anything.
  for (const change of input.activeChanges) {
    if (change.state !== 'planned') continue
    const draft = draftFor(change.targetKind, change.targetId)
    draft.contributions.push({
      source: 'planned_change',
      agentId: change.agentId,
      runId: change.runId,
      operation: change.operation,
      at: change.plannedAt ?? '',
      position: change.position,
      reference: change.changeId,
      detail: `Änderung angekündigt: ${CHANGE_OPERATION_LABELS[change.operation]}`,
    })
    recordChange(
      draft,
      'planned',
      change.operation,
      change.position,
      changeSnapshot(change),
    )
  }

  // ---- 2. recently applied changes, from the event log --------------------
  for (const entry of recentAppliedChanges(input.ledger)) {
    const draft = draftFor(entry.targetKind, entry.targetId)
    draft.contributions.push({
      source: 'applied_change',
      agentId: entry.agentId,
      runId: entry.runId,
      operation: entry.operation,
      at: entry.occurredAt,
      position: entry.position,
      reference: entry.changeId,
      detail: `Änderung angewandt: ${CHANGE_OPERATION_PARTICIPLES[entry.operation]}`,
    })
    recordChange(draft, 'applied', entry.operation, entry.position, entry.snapshot)
  }

  // ---- 3. open work steps -------------------------------------------------
  for (const step of openWorkStepsOf(input.ledger)) {
    for (const componentId of step.componentIds) {
      const draft = draftFor('component', componentId)
      draft.hasActiveWorkStep = true
      draft.contributions.push({
        source: 'work_step',
        agentId: step.agentId,
        runId: step.runId,
        operation: null,
        at: step.occurredAt,
        position: step.position,
        reference: step.workStepId,
        detail: `Arbeitsschritt läuft: ${step.title}`,
      })
    }
  }

  // ---- 4. resolve --------------------------------------------------------
  const components = new Map<ComponentId, ChangeOverlay>()
  const relationships = new Map<Identifier, ChangeOverlay>()
  const extraComponents: OverlayComponent[] = []
  const extraRelationships: OverlayRelationship[] = []
  const counts: WorkStateCounts = { ...EMPTY_WORK_STATE_COUNTS }

  for (const draft of [...drafts.values()].sort((a, b) =>
    a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0,
  )) {
    const state = resolveWorkState({
      hasActiveWorkStep: draft.hasActiveWorkStep,
      change: draft.latestChange,
    })
    if (state === null) continue

    const inAppliedModel =
      draft.targetKind === 'component'
        ? appliedComponentIds.has(draft.targetId)
        : appliedRelationshipIds.has(draft.targetId)

    const presence: OverlayPresence = inAppliedModel
      ? 'applied'
      : state === 'removed'
        ? 'ghost'
        : 'proposal'

    // A proposal or a ghost can only be drawn when the agent actually reported
    // a descriptor for it. Without one there is nothing to place on the canvas,
    // and inventing a box would be inventing a component.
    if (!inAppliedModel && draft.descriptor === null) continue

    const contributions = [...draft.contributions].sort((a, b) => a.position - b.position)
    const agentIds: AgentId[] = []
    for (const contribution of contributions) {
      if (!agentIds.includes(contribution.agentId)) agentIds.push(contribution.agentId)
    }

    const overlay: ChangeOverlay = {
      targetKind: draft.targetKind,
      targetId: draft.targetId,
      state,
      presence,
      operation: draft.latestChange?.operation ?? null,
      contributions,
      agentIds,
      descriptor: inAppliedModel ? null : draft.descriptor,
    }

    counts[state] += 1

    if (draft.targetKind === 'component') {
      if (inAppliedModel) components.set(draft.targetId, overlay)
      else
        extraComponents.push({
          component: draft.descriptor as Component,
          overlay,
        })
    } else {
      if (inAppliedModel) relationships.set(draft.targetId, overlay)
      else
        extraRelationships.push({
          relationship: draft.descriptor as Relationship,
          overlay,
        })
    }
  }

  return {
    components,
    relationships,
    extraComponents,
    extraRelationships,
    counts,
    total: components.size + relationships.size + extraComponents.length + extraRelationships.length,
  }
}

/**
 * Compact fingerprint of an overlay model.
 *
 * Used to decide whether a re-render is worth it. It covers exactly what is
 * drawn — target, state, presence, operation and the number of agents behind it
 * — and nothing that only exists in a tooltip.
 */
export function overlaySignature(model: ChangeOverlayModel): string {
  const parts: string[] = []
  const push = (overlay: ChangeOverlay): void => {
    parts.push(
      `${overlay.targetKind}:${overlay.targetId}=${overlay.state}/${overlay.presence}/${
        overlay.operation ?? '-'
      }/${overlay.agentIds.length}`,
    )
  }
  for (const overlay of model.components.values()) push(overlay)
  for (const overlay of model.relationships.values()) push(overlay)
  for (const entry of model.extraComponents) push(entry.overlay)
  for (const entry of model.extraRelationships) push(entry.overlay)
  return parts.sort().join('|')
}
