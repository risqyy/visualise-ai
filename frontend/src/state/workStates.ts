import {
  Activity,
  CircleCheckBig,
  CircleDashed,
  CircleMinus,
  type LucideIcon,
} from 'lucide-react'

import type { ActiveChange } from '@/api/types'
import type { CanvasKey } from '@/i18n'

/**
 * The four v0 work states.
 *
 * This module is the single definition of what a work state looks like — the
 * legend, the canvas overlays (#10), the agent tree (#11) and the inspector
 * (#12) all read it, so a state can never drift between panes.
 *
 * Two rules are baked in on purpose:
 *
 * 1. **Colour is never the only channel.** Every state carries a text label, an
 *    icon and a line style, so the information survives greyscale, colour
 *    vision deficiency and a monochrome screenshot.
 * 2. **Colour encodes a phase of work, not quality.** Red means "removed", not
 *    "bad"; green means "recently applied", not "good". The cockpit performs no
 *    quality or drift evaluation — the human reviewer judges. The legend states
 *    this explicitly via `WORK_STATE_DISCLAIMER`.
 */
export type WorkStateId = 'planned' | 'active' | 'recently_applied' | 'removed'

export interface WorkStateDefinition {
  id: WorkStateId
  /**
   * Key of the short label rendered next to the colour swatch. Never omitted:
   * the word is the channel that survives greyscale, so it has to exist in
   * every language (#42).
   */
  labelKey: CanvasKey
  /** Key of the sentence explaining what the agent reported for this state. */
  descriptionKey: CanvasKey
  /** CSS custom property holding the colour token. */
  colorVar: string
  /** Tailwind utility bound to the same token, for text and icons. */
  colorClass: string
  /** Second, colour-independent channel: the stroke pattern of an edge. */
  strokeDasharray: string
  /** Second channel for boxes and borders. */
  borderStyle: 'dashed' | 'solid' | 'dotted' | 'double'
  /** Third channel: a distinct glyph per state. */
  icon: LucideIcon
}

export const WORK_STATES: readonly WorkStateDefinition[] = [
  {
    id: 'planned',
    labelKey: 'workState.planned.label',
    descriptionKey: 'workState.planned.description',
    colorVar: '--state-planned',
    colorClass: 'text-state-planned',
    strokeDasharray: '6 4',
    borderStyle: 'dashed',
    icon: CircleDashed,
  },
  {
    id: 'active',
    labelKey: 'workState.active.label',
    descriptionKey: 'workState.active.description',
    colorVar: '--state-active',
    colorClass: 'text-state-active',
    strokeDasharray: '2 3',
    borderStyle: 'double',
    icon: Activity,
  },
  {
    id: 'recently_applied',
    labelKey: 'workState.recentlyApplied.label',
    descriptionKey: 'workState.recentlyApplied.description',
    colorVar: '--state-applied',
    colorClass: 'text-state-applied',
    strokeDasharray: '0',
    borderStyle: 'solid',
    icon: CircleCheckBig,
  },
  {
    id: 'removed',
    labelKey: 'workState.removed.label',
    descriptionKey: 'workState.removed.description',
    colorVar: '--state-removed',
    colorClass: 'text-state-removed',
    strokeDasharray: '1 4',
    borderStyle: 'dotted',
    icon: CircleMinus,
  },
]

export const WORK_STATE_BY_ID: Record<WorkStateId, WorkStateDefinition> =
  Object.fromEntries(WORK_STATES.map((state) => [state.id, state])) as Record<
    WorkStateId,
    WorkStateDefinition
  >

/**
 * Shown with the legend wherever the states appear. The product explicitly does
 * not evaluate agent work, so the colours must not be read as a verdict.
 */
export const WORK_STATE_DISCLAIMER_KEY: CanvasKey = 'legend.disclaimer'

export interface WorkStateInput {
  /** A work step of this element is started and not yet completed. */
  hasActiveWorkStep?: boolean
  /** The most recent change reported for this element, if any. */
  change?: Pick<ActiveChange, 'state' | 'operation'> | null
}

/**
 * Resolves the work state of a component or relationship from what was actually
 * reported. Returns `null` when nothing was reported — the element is then drawn
 * in the neutral graphite of the applied model, with no state colour at all.
 *
 * The contract knows three change states, not two: besides `planned` and
 * `applied` there is `retracted`, a proposal its agent withdrew. A withdrawn
 * proposal contributes **nothing** to the overlay — it is neither planned nor
 * applied, and inventing a fifth colour for it would show the reviewer work
 * that is no longer claimed. A running work step is reported independently of
 * the change and still counts.
 */
export function resolveWorkState(input: WorkStateInput): WorkStateId | null {
  const { hasActiveWorkStep } = input
  const change = input.change?.state === 'retracted' ? null : input.change

  if (change?.state === 'applied' && change.operation === 'remove') return 'removed'
  if (hasActiveWorkStep) return 'active'
  if (change?.state === 'planned') return 'planned'
  if (change?.state === 'applied') return 'recently_applied'
  return null
}
