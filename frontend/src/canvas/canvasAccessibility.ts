import type { TFunction } from 'i18next'

import type { ComponentId, Identifier } from '@/api/types'
import type { CanvasKey } from '@/i18n'

import { dominantOverlay, overlayLabel, type ChangeOverlay } from './changeOverlays'
import { componentKindLabel } from './componentKinds'
import { DISCLOSURE_LABEL_KEYS } from './detailLevel'
import type { ArchitectureEdge, ArchitectureNode } from './graphProjection'
import { RELATIONSHIP_KIND_STYLE_BY_ID, relationshipDiscriminator } from './relationshipKinds'

/**
 * The accessible surface of the architecture canvas.
 *
 * React Flow makes every node and every edge a tab stop by default, but it
 * names neither: a node arrives in the accessibility tree as an unnamed
 * `group` with the roledescription `node`, and an edge as `Edge from <id> to
 * <id>`. The canvas applies a roving tab index to the visible nodes and keeps
 * relationships programmatically focusable only. What the canvas draws — the
 * component's name, its kind, whether it contains other components, and the
 * work state an agent reported for it — is invisible to a screen reader. This
 * module is the counterpart of the drawing code: it turns exactly the same
 * facts into an accessible name.
 *
 * Four rules hold here and are covered by tests:
 *
 * 1. **Everything visible is announced, and nothing else is.** The work state
 *    comes from `overlayLabel`, the single definition the boxes, the marks, the
 *    legend and the inspector already use (`src/state/workStates.ts`). This
 *    module never invents a second vocabulary and never adds a judgement: a
 *    state is a phase of work, `entfernt` means "is being removed", not "bad".
 * 2. **Reported data is passed through verbatim.** Component names,
 *    component ids and technology strings are what an agent reported. They are
 *    never translated, shortened or reworded — only the surrounding German
 *    scaffolding is this module's own.
 * 3. **Every accessible name is unique.** Two components may legitimately carry
 *    the same reported name in two different containers. The name is therefore
 *    qualified with as much of the container path as it takes to tell them
 *    apart, and with the component id when even that is not enough.
 * 4. **Colour is not a channel at all here.** A screen reader receives the
 *    state as words, which is the same information the visible label, icon and
 *    border style carry (ADR 0003).
 *
 * Everything the canvas says is injected as a `CanvasVoice`: `t` for the
 * sentences (`canvas:a11y.*`, #42) and `count` for the counted nouns
 * (`common:count.*`, #40). This module is pure and free of React by design —
 * the same discipline `graphProjection.ts` follows — so it can hold neither a
 * `t` of its own nor a plural table of its own. One injected seam keeps both
 * out and keeps the module testable without rendering anything.
 */

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/** The counted nouns this module speaks. */
export type CanvasCountNoun = 'component' | 'relationship' | 'agent'

/**
 * Turns a count into text in the reader's language — `10 Komponenten`,
 * `10 components`, `1 Komponente`.
 *
 * Passed in rather than looked up. This module is pure and free of React by
 * design (it is the counterpart of `graphProjection`), so it cannot hold a
 * `t` of its own; and building one here would mean a second plural table,
 * which is exactly what #40 removed. The two React callers —
 * `ArchitectureCanvas` and `ComponentNode` — get theirs from
 * `useCanvasCountText`, which resolves against the catalogues.
 */
export type CountText = (noun: CanvasCountNoun, count: number) => string

/**
 * Everything the canvas needs in order to speak.
 *
 * Two halves, from two issues, injected as one value:
 *
 * * `t` — the `canvas` namespace, which holds every sentence the graph says
 *   about itself (`a11y.*`, `tool.*`, the component and relationship
 *   vocabularies). #42 moved them out of this file and into the catalogues.
 * * `count` — counted nouns from `common:count.*`, which #40 made
 *   locale-aware. A second plural table here is exactly what that issue removed.
 *
 * Passed in rather than looked up, because this module is pure and free of
 * React by design (it is the counterpart of `graphProjection`). The two React
 * callers — `ArchitectureCanvas` and `ComponentNode` — get theirs from
 * `useCanvasVoice`, which resolves both against the catalogues.
 */
export interface CanvasVoice {
  t: TFunction<'canvas'>
  count: CountText
}

// ---------------------------------------------------------------------------
// The texts
// ---------------------------------------------------------------------------

/**
 * Keys of every accessible string of the canvas, in one object.
 *
 * The entries that take a value are **key plus interpolation**, not string
 * concatenation: German and English put the noun, the verb and the container
 * in different places, and only a whole sentence per language can carry that.
 * The interpolated values are either already-counted nouns or reported project
 * data — a component name, a component id — and i18next passes an interpolated
 * value through byte for byte (ADR 0014).
 */
export const CANVAS_A11Y_KEYS = {
  graphLabel: 'graph.label',
  graphInstructions: 'graph.instructions',
  nodeInstructions: 'graph.nodeInstructions',
  edgeInstructions: 'graph.edgeInstructions',

  containerRoleDescription: 'a11y.containerRole',
  componentRoleDescription: 'a11y.componentRole',
  relationshipRoleDescription: 'a11y.relationshipRole',

  contains: 'a11y.contains',
  collapsedNote: 'a11y.collapsedNote',
  inContainer: 'a11y.inContainer',
  identifiedBy: 'a11y.identifiedBy',

  noWorkState: 'a11y.noWorkState',
  proposalNote: 'a11y.proposalNote',
  ghostNote: 'a11y.ghostNote',
  rolledUpNote: 'a11y.rolledUpNote',

  fromTo: 'a11y.fromTo',
  bundleOf: 'a11y.bundleOf',
  furtherRelationships: 'a11y.furtherRelationships',
  agentsReporting: 'a11y.agentsReporting',
} as const satisfies Record<string, CanvasKey>

/**
 * German replacements for React Flow's built-in English a11y strings.
 *
 * This is not only a translation. React Flow's default node description offers
 * "press delete to remove it" and "use the arrow keys to move the node around",
 * and neither is true here: `deleteKeyCode` is `null`, and the canvas is a
 * read-only view of what an agent reported. Announcing an action that does not
 * exist is the same defect as not announcing one that does.
 */
export function canvasAriaLabelConfig(t: TFunction<'canvas'>) {
  return {
    // React Flow renders the `keyboardDisabled` variant while keyboard a11y is
    // *enabled*; both keys carry the same text so the rendered one is right
    // either way.
    'node.a11yDescription.default': t(CANVAS_A11Y_KEYS.nodeInstructions),
    'node.a11yDescription.keyboardDisabled': t(CANVAS_A11Y_KEYS.nodeInstructions),
    'edge.a11yDescription.default': t(CANVAS_A11Y_KEYS.edgeInstructions),
    'controls.ariaLabel': t('a11y.zoomControls'),
    'controls.zoomIn.ariaLabel': t('a11y.zoomIn'),
    'controls.zoomOut.ariaLabel': t('a11y.zoomOut'),
    'controls.fitView.ariaLabel': t('a11y.fitView'),
    'controls.interactive.ariaLabel': t('a11y.toggleInteractive'),
    'minimap.ariaLabel': t('graph.minimapLabel'),
    'handle.ariaLabel': t('a11y.handle'),
  } as const
}

// ---------------------------------------------------------------------------
// Work state as words
// ---------------------------------------------------------------------------

/**
 * The reported work state of an element, spelled out.
 *
 * `null` produces the explicit "nothing was reported" — the visible node is
 * equally explicit about it by carrying no mark at all, and a screen reader
 * must be able to tell "no state" from "state not conveyed".
 */
export function workStatePhrase(
  overlay: ChangeOverlay | null,
  voice: CanvasVoice,
  rolledUp = false,
): string[] {
  if (!overlay) return [voice.t(CANVAS_A11Y_KEYS.noWorkState)]
  const parts = [overlayLabel(overlay, voice.t)]
  if (rolledUp) parts.push(voice.t(CANVAS_A11Y_KEYS.rolledUpNote))
  if (overlay.presence === 'proposal') parts.push(voice.t(CANVAS_A11Y_KEYS.proposalNote))
  if (overlay.presence === 'ghost') parts.push(voice.t(CANVAS_A11Y_KEYS.ghostNote))
  if (overlay.agentIds.length > 1) {
    parts.push(
      voice.t(CANVAS_A11Y_KEYS.agentsReporting, {
        agents: voice.count('agent', overlay.agentIds.length),
      }),
    )
  }
  return parts
}

// ---------------------------------------------------------------------------
// Node names
// ---------------------------------------------------------------------------

/** Maximum number of container levels a name is qualified with. */
const MAX_QUALIFIER_DEPTH = 16

interface NameCandidate {
  id: ComponentId
  /** Name, kind and — for a container — how many components it holds. */
  base: string
  /** Names of the ancestors, nearest container first. */
  ancestors: string[]
}

function baseName(node: ArchitectureNode, voice: CanvasVoice): string {
  const { component, isCompound, childCount } = node.data
  const parts = [component.name, componentKindLabel(component.kind, voice.t)]
  if (isCompound) {
    parts.push(
      voice.t(CANVAS_A11Y_KEYS.contains, {
        components: voice.count('component', childCount),
      }),
    )
  }
  return parts.join(', ')
}

function qualified(
  candidate: NameCandidate,
  depth: number,
  t: TFunction<'canvas'>,
): string {
  if (depth === 0) return candidate.base
  const path = candidate.ancestors
    .slice(0, depth)
    .map((container) => t(CANVAS_A11Y_KEYS.inContainer, { container }))
  return [candidate.base, ...path].join(', ')
}

/**
 * The identifying part of every node's accessible name, guaranteed unique.
 *
 * The name starts as "name, kind" (plus the child count for a container) and is
 * qualified with the container path only as far as it has to be: a component
 * whose name is already unambiguous does not drag its whole hierarchy along.
 * When even the full path collides — two identically named siblings of the same
 * kind in the same container — the reported component id decides, because it is
 * unique by contract.
 *
 * The work state is deliberately *not* part of this: it changes while the user
 * watches, and an identity that moves with it would not be an identity.
 */
export function identifyingNames(
  nodes: readonly ArchitectureNode[],
  voice: CanvasVoice,
): Map<ComponentId, string> {
  const nameById = new Map<ComponentId, string>()
  const parentById = new Map<ComponentId, ComponentId | undefined>()
  for (const node of nodes) {
    nameById.set(node.id, node.data.component.name)
    parentById.set(node.id, node.parentId)
  }

  const candidates: NameCandidate[] = nodes.map((node) => {
    const ancestors: string[] = []
    let current = node.parentId
    const seen = new Set<ComponentId>([node.id])
    while (current !== undefined && !seen.has(current) && ancestors.length < MAX_QUALIFIER_DEPTH) {
      seen.add(current)
      ancestors.push(nameById.get(current) ?? current)
      current = parentById.get(current)
    }
    return { id: node.id, base: baseName(node, voice), ancestors }
  })

  const result = new Map<ComponentId, string>()
  let pending = candidates
  let depth = 0

  while (pending.length > 0) {
    const groups = new Map<string, NameCandidate[]>()
    for (const candidate of pending) {
      const label = qualified(candidate, depth, voice.t)
      const group = groups.get(label)
      if (group) group.push(candidate)
      else groups.set(label, [candidate])
    }

    const next: NameCandidate[] = []
    for (const [label, group] of groups) {
      const first = group[0]
      if (group.length === 1 && first) {
        result.set(first.id, label)
        continue
      }
      // Only go one container level deeper when every member of the collision
      // still has one; otherwise the reported id settles it right away.
      const canGoDeeper =
        depth < MAX_QUALIFIER_DEPTH &&
        group.every((candidate) => candidate.ancestors.length > depth)
      if (canGoDeeper) {
        next.push(...group)
        continue
      }
      for (const candidate of group) {
        result.set(
          candidate.id,
          `${qualified(candidate, depth, voice.t)}, ${voice.t(
            CANVAS_A11Y_KEYS.identifiedBy,
            { componentId: candidate.id },
          )}`,
        )
      }
    }

    pending = next
    depth += 1
  }

  return result
}

/**
 * The full accessible name of one node: identity, disclosure, reported state.
 *
 * The two things after the identity are the ones that move while the user
 * watches — whether the container is open, and what an agent reported — and
 * they are deliberately *outside* the identity for exactly that reason.
 */
export function nodeAccessibleName(
  node: ArchitectureNode,
  identity: string,
  voice: CanvasVoice,
): string {
  const { collapsed, hiddenDescendantCount, childCount, overlay, overlayRolledUp } =
    node.data
  const parts = [identity]
  // A closed container looks different and has to sound different: what is
  // behind it is not on screen and is not a tab stop either.
  if (collapsed === true) {
    parts.push(
      voice.t(CANVAS_A11Y_KEYS.collapsedNote, {
        components: voice.count('component', hiddenDescendantCount ?? childCount),
      }),
    )
  }
  parts.push(...workStatePhrase(overlay, voice, overlayRolledUp === true))
  return parts.join(', ')
}

/**
 * The accessible name of the control that expands or collapses a container.
 *
 * The verbs come from `DISCLOSURE_LABEL_KEYS`, the collection #34 created for the
 * same reason this module exists — one place per vocabulary, so the button, its
 * tooltip and its accessible name cannot drift into three different words. What
 * this function adds is the *component*: a canvas full of buttons that all say
 * "Aufklappen" tells a screen reader which action is available and not which
 * box it belongs to.
 */
export function nodeDisclosureLabel(
  componentName: string,
  expanded: boolean,
  voice: CanvasVoice,
  hiddenCount?: number,
): string {
  if (expanded) {
    return `${voice.t(DISCLOSURE_LABEL_KEYS.collapse)}: ${componentName}`
  }
  const suffix =
    hiddenCount === undefined ? '' : ` (${voice.count('component', hiddenCount)})`
  return `${voice.t(DISCLOSURE_LABEL_KEYS.expand)}: ${componentName}${suffix}`
}

/**
 * Puts role, name, state and (when requested) the roving tab index on every node.
 *
 * `role="group"` is what React Flow already gives a focusable node, and it is
 * kept on purpose. A node is not a leaf widget: a container renders a real
 * disclosure `<button>` inside it (#34), and `button`, `option` and the other
 * widget roles make their children *presentational* — a node marked up as a
 * button would take that toggle out of the accessibility tree entirely. What
 * was missing was never the role, it was the name.
 *
 * The selection therefore travels as `aria-current`, which is a **global**
 * ARIA state and valid on `group`, and which says precisely what a canvas
 * selection is: the current item among a set of related ones.
 * `aria-roledescription` carries the distinction the role cannot — a container
 * that holds other components against a single component — so the two are told
 * apart by words rather than by the size of a box.
 */
export function withNodeAccessibility(
  nodes: readonly ArchitectureNode[],
  voice: CanvasVoice,
  /** The one node that is the graph's Tab entry, when roving focus is active. */
  rovingNodeId?: ComponentId | null,
): ArchitectureNode[] {
  const identities = identifyingNames(nodes, voice)
  return nodes.map((node) => ({
    ...node,
    ariaRole: 'group',
    ariaLabel: nodeAccessibleName(node, identities.get(node.id) ?? node.id, voice),
    domAttributes: {
      'aria-roledescription': node.data.isCompound
        ? voice.t(CANVAS_A11Y_KEYS.containerRoleDescription)
        : voice.t(CANVAS_A11Y_KEYS.componentRoleDescription),
      ...(node.selected === true || node.data.relationshipSelected === true
        ? { 'aria-current': true as const }
        : {}),
      ...(rovingNodeId !== undefined
        ? { tabIndex: node.id === rovingNodeId ? 0 : -1 }
        : {}),
    },
  }))
}

// ---------------------------------------------------------------------------
// Edge names
// ---------------------------------------------------------------------------

/** Reported component names by id, for naming the endpoints of an edge. */
export function componentNamesById(
  nodes: readonly ArchitectureNode[],
): Map<ComponentId, string> {
  return new Map(nodes.map((node) => [node.id, node.data.component.name]))
}

/**
 * How many relationships of a bundle are spelled out before the name switches
 * to a count. A closed container can lift a dozen relationships onto one line
 * (`collapse.ts`); reading all of them out is not a name any more. The bundle
 * stays fully resolvable — unfolding it gives every single one its own label,
 * which is what ADR 0008 requires of a bundle.
 */
const MAX_NAMED_RELATIONSHIPS = 6

/** The accessible name of one drawn edge. */
export function edgeAccessibleName(
  edge: ArchitectureEdge,
  names: ReadonlyMap<ComponentId, string>,
  voice: CanvasVoice,
): string {
  const relationships = edge.data?.relationships ?? []
  const parts = [
    voice.t(CANVAS_A11Y_KEYS.fromTo, {
      source: names.get(edge.source) ?? edge.source,
      target: names.get(edge.target) ?? edge.target,
    }),
  ]

  if (relationships.length > 1) {
    parts.push(
      voice.t(CANVAS_A11Y_KEYS.bundleOf, {
        relationships: voice.count('relationship', relationships.length),
      }),
    )
  }
  for (const relationship of relationships.slice(0, MAX_NAMED_RELATIONSHIPS)) {
    const kind = RELATIONSHIP_KIND_STYLE_BY_ID[relationship.kind]
    const label = kind ? voice.t(kind.labelKey) : relationship.kind
    const discriminator = relationshipDiscriminator(relationship)
    parts.push(discriminator ? `${label} ${discriminator}` : label)
  }
  if (relationships.length > MAX_NAMED_RELATIONSHIPS) {
    parts.push(
      voice.t(CANVAS_A11Y_KEYS.furtherRelationships, {
        relationships: voice.count(
          'relationship',
          relationships.length - MAX_NAMED_RELATIONSHIPS,
        ),
      }),
    )
  }

  parts.push(
    ...workStatePhrase(dominantOverlay(Object.values(edge.data?.overlays ?? {})), voice),
  )
  return parts.join(', ')
}

/**
 * Names every edge and marks it as a relationship.
 *
 * React Flow makes edges focusable and labels them `Edge from <id> to <id>` —
 * English, built from ids rather than from the reported names, and identical
 * for a single call and for a bundle of three NATS topics. Although the
 * composite keeps them out of the Tab sequence, programmatic edge activation
 * still needs a meaningful name, so the edges are named from the same reported
 * data the line is drawn from.
 */
export function withEdgeAccessibility(
  edges: readonly ArchitectureEdge[],
  names: ReadonlyMap<ComponentId, string>,
  voice: CanvasVoice,
  selectedRelationshipId: Identifier | null = null,
): ArchitectureEdge[] {
  return edges.map((edge) => ({
    ...edge,
    ariaLabel: edgeAccessibleName(edge, names, voice),
    domAttributes: {
      'aria-roledescription': voice.t(CANVAS_A11Y_KEYS.relationshipRoleDescription),
      // Relationships remain programmatically focusable for the existing
      // relationship keyboard actions, but they are not another Tab entry in
      // the composite component graph.
      tabIndex: -1,
      ...(selectedRelationshipId !== null &&
      edge.data?.relationships.some(
        (relationship) => relationship.relationshipId === selectedRelationshipId,
      )
        ? { 'aria-current': true as const }
        : {}),
    },
  }))
}
