import type { ComponentId } from '@/api/types'

import { dominantOverlay, overlayLabel, type ChangeOverlay } from './changeOverlays'
import { componentKindStyle } from './componentKinds'
import { DISCLOSURE_LABELS } from './detailLevel'
import type { ArchitectureEdge, ArchitectureNode } from './graphProjection'
import { RELATIONSHIP_KIND_STYLE_BY_ID, relationshipDiscriminator } from './relationshipKinds'

/**
 * The accessible surface of the architecture canvas.
 *
 * React Flow makes every node and every edge a tab stop, but it names neither:
 * a node arrives in the accessibility tree as an unnamed `group` with the
 * roledescription `node`, and an edge as `Edge from <id> to <id>`. What the
 * canvas draws — the component's name, its kind, whether it contains other
 * components, and the work state an agent reported for it — is invisible to a
 * screen reader. This module is the counterpart of the drawing code: it turns
 * exactly the same facts into an accessible name.
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
 * All German strings the canvas speaks live in `CANVAS_A11Y_TEXT` so the
 * translation work of #42 has a single place to pull from. Counted nouns are
 * the exception and deliberately so: they are already localised, and this
 * module takes them as a `CountText` from its caller rather than owning a
 * second plural table (ADR 0019).
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

// ---------------------------------------------------------------------------
// The texts
// ---------------------------------------------------------------------------

/**
 * Every accessible string of the canvas, in one object.
 *
 * Hard-coded German for now — the i18n migration is #42, and the translation
 * contract of #38 already records that accessible names have to travel with it.
 */
export const CANVAS_A11Y_TEXT = {
  /** Accessible name of the whole drawing surface. */
  graphLabel: 'Interaktiver Architekturgraph',

  /**
   * Read out when the graph is entered. It describes what is there and how to
   * operate it — and it stops at what the cockpit can actually do: v0 observes,
   * it does not let anyone edit the reported architecture.
   */
  graphInstructions:
    'Architekturgraph des Projekts. Mit der Tabulatortaste zwischen den Komponenten ' +
    'und Beziehungen wechseln. Enter oder Leertaste wählt die fokussierte Komponente ' +
    'aus und zeigt sie im Inspector; eine erneute Aktivierung hebt die Auswahl auf, ' +
    'Escape ebenfalls. Jede Komponente nennt ihren gemeldeten Namen, ihre Art, ob sie ' +
    'weitere Komponenten enthält, in welchem Container sie liegt und welchen ' +
    'Änderungsstatus ein Agent für sie gemeldet hat. Der Graph ist eine Beobachtung: ' +
    'das gemeldete Architekturmodell lässt sich hier nicht bearbeiten.',

  /** Description attached to every node by React Flow. */
  nodeInstructions:
    'Enter oder Leertaste wählt diese Komponente aus und zeigt sie im Inspector. ' +
    'Escape hebt die Auswahl auf. Die Komponente lässt sich nicht bearbeiten oder ' +
    'entfernen — das Cockpit beobachtet nur.',

  /** Description attached to every edge by React Flow. */
  edgeInstructions:
    'Enter oder Leertaste wählt diese Beziehung aus; bei einer Sammelkante klappt sie ' +
    'die enthaltenen Beziehungen auf und wieder zu. Escape hebt die Auswahl auf.',

  /** `aria-roledescription` of a component that contains other components. */
  containerRoleDescription: 'Architekturcontainer',
  /** `aria-roledescription` of a component without children. */
  componentRoleDescription: 'Architekturkomponente',
  /** `aria-roledescription` of a drawn relationship. */
  relationshipRoleDescription: 'Architekturbeziehung',

  /** Container part of a node name. Takes the already-counted noun. */
  contains: (components: string) => `Container mit ${components}`,
  /**
   * Said by a container whose children are not drawn right now. Mirrors the
   * "… eingeklappt" line the closed box shows, so the two channels say the same
   * thing (#34 / ADR 0017).
   */
  collapsedNote: (components: string) => `eingeklappt, ${components} verborgen`,
  /** One step of the container path. */
  inContainer: (containerName: string) => `in ${containerName}`,
  /** Last-resort qualifier when name, kind and container path still collide. */
  identifiedBy: (componentId: ComponentId) => `Komponenten-ID ${componentId}`,

  /** Said when an agent reported nothing about this element. */
  noWorkState: 'kein Änderungsstatus gemeldet',
  /** Said for an announced element that the applied model does not contain. */
  proposalNote: 'angekündigt, noch nicht Teil des angewandten Architekturmodells',
  /** Said for an element an applied change removed. */
  ghostNote: 'nicht mehr Teil des angewandten Architekturmodells',
  /**
   * Said when the state on a closed container was reported for something
   * *inside* it. Without this the name would claim the container itself is the
   * element an agent is working on (`rollUpOverlay` in `collapse.ts`).
   */
  rolledUpNote: 'gemeldet für eine eingeklappte Komponente darin',

  /** Direction part of an edge name. */
  fromTo: (sourceName: string, targetName: string) =>
    `Beziehung von ${sourceName} zu ${targetName}`,
  /** Said for an edge that renders more than one reported relationship. */
  bundleOf: (relationships: string) => `Sammelkante mit ${relationships}`,
  /** Tail of a bundle name that is too long to read out in full. */
  furtherRelationships: (relationships: string) => `und ${relationships} weitere`,
  /** Said when more than one agent reported for the same element. */
  agentsReporting: (agents: string) => `${agents} melden dazu`,
} as const

/**
 * German replacements for React Flow's built-in English a11y strings.
 *
 * This is not only a translation. React Flow's default node description offers
 * "press delete to remove it" and "use the arrow keys to move the node around",
 * and neither is true here: `deleteKeyCode` is `null`, and the canvas is a
 * read-only view of what an agent reported. Announcing an action that does not
 * exist is the same defect as not announcing one that does.
 */
export const CANVAS_ARIA_LABEL_CONFIG = {
  // React Flow renders the `keyboardDisabled` variant while keyboard a11y is
  // *enabled*; both keys carry the same text so the rendered one is right
  // either way.
  'node.a11yDescription.default': CANVAS_A11Y_TEXT.nodeInstructions,
  'node.a11yDescription.keyboardDisabled': CANVAS_A11Y_TEXT.nodeInstructions,
  'edge.a11yDescription.default': CANVAS_A11Y_TEXT.edgeInstructions,
  'controls.ariaLabel': 'Zoomsteuerung des Architekturgraphen',
  'controls.zoomIn.ariaLabel': 'Hineinzoomen',
  'controls.zoomOut.ariaLabel': 'Herauszoomen',
  'controls.fitView.ariaLabel': 'Ansicht einpassen',
  'controls.interactive.ariaLabel': 'Interaktivität umschalten',
  'minimap.ariaLabel': 'Übersichtskarte der Architektur',
  'handle.ariaLabel': 'Verbindungspunkt',
} as const

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
  countText: CountText,
  rolledUp = false,
): string[] {
  if (!overlay) return [CANVAS_A11Y_TEXT.noWorkState]
  const parts = [overlayLabel(overlay)]
  if (rolledUp) parts.push(CANVAS_A11Y_TEXT.rolledUpNote)
  if (overlay.presence === 'proposal') parts.push(CANVAS_A11Y_TEXT.proposalNote)
  if (overlay.presence === 'ghost') parts.push(CANVAS_A11Y_TEXT.ghostNote)
  if (overlay.agentIds.length > 1) {
    parts.push(
      CANVAS_A11Y_TEXT.agentsReporting(countText('agent', overlay.agentIds.length)),
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

function baseName(node: ArchitectureNode, countText: CountText): string {
  const { component, isCompound, childCount } = node.data
  const parts = [component.name, componentKindStyle(component.kind).label]
  if (isCompound) {
    parts.push(CANVAS_A11Y_TEXT.contains(countText('component', childCount)))
  }
  return parts.join(', ')
}

function qualified(candidate: NameCandidate, depth: number): string {
  if (depth === 0) return candidate.base
  const path = candidate.ancestors
    .slice(0, depth)
    .map((name) => CANVAS_A11Y_TEXT.inContainer(name))
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
  countText: CountText,
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
    return { id: node.id, base: baseName(node, countText), ancestors }
  })

  const result = new Map<ComponentId, string>()
  let pending = candidates
  let depth = 0

  while (pending.length > 0) {
    const groups = new Map<string, NameCandidate[]>()
    for (const candidate of pending) {
      const label = qualified(candidate, depth)
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
          `${qualified(candidate, depth)}, ${CANVAS_A11Y_TEXT.identifiedBy(candidate.id)}`,
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
  countText: CountText,
): string {
  const { collapsed, hiddenDescendantCount, childCount, overlay, overlayRolledUp } =
    node.data
  const parts = [identity]
  // A closed container looks different and has to sound different: what is
  // behind it is not on screen and is not a tab stop either.
  if (collapsed === true) {
    parts.push(
      CANVAS_A11Y_TEXT.collapsedNote(
        countText('component', hiddenDescendantCount ?? childCount),
      ),
    )
  }
  parts.push(...workStatePhrase(overlay, countText, overlayRolledUp === true))
  return parts.join(', ')
}

/**
 * The accessible name of the control that expands or collapses a container.
 *
 * The verbs come from `DISCLOSURE_LABELS`, the collection #34 created for the
 * same reason this module exists — one place per vocabulary, so the button, its
 * tooltip and its accessible name cannot drift into three different words. What
 * this function adds is the *component*: a canvas full of buttons that all say
 * "Aufklappen" tells a screen reader which action is available and not which
 * box it belongs to.
 */
export function nodeDisclosureLabel(
  componentName: string,
  expanded: boolean,
  countText: CountText,
  hiddenCount?: number,
): string {
  if (expanded) return `${DISCLOSURE_LABELS.collapse}: ${componentName}`
  const suffix =
    hiddenCount === undefined ? '' : ` (${countText('component', hiddenCount)})`
  return `${DISCLOSURE_LABELS.expand}: ${componentName}${suffix}`
}

/**
 * Puts role, name and state on every node.
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
  countText: CountText,
): ArchitectureNode[] {
  const identities = identifyingNames(nodes, countText)
  return nodes.map((node) => ({
    ...node,
    ariaRole: 'group',
    ariaLabel: nodeAccessibleName(node, identities.get(node.id) ?? node.id, countText),
    domAttributes: {
      'aria-roledescription': node.data.isCompound
        ? CANVAS_A11Y_TEXT.containerRoleDescription
        : CANVAS_A11Y_TEXT.componentRoleDescription,
      ...(node.selected === true ? { 'aria-current': true as const } : {}),
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
  countText: CountText,
): string {
  const relationships = edge.data?.relationships ?? []
  const parts = [
    CANVAS_A11Y_TEXT.fromTo(
      names.get(edge.source) ?? edge.source,
      names.get(edge.target) ?? edge.target,
    ),
  ]

  if (relationships.length > 1) {
    parts.push(
      CANVAS_A11Y_TEXT.bundleOf(countText('relationship', relationships.length)),
    )
  }
  for (const relationship of relationships.slice(0, MAX_NAMED_RELATIONSHIPS)) {
    const kind = RELATIONSHIP_KIND_STYLE_BY_ID[relationship.kind]
    const discriminator = relationshipDiscriminator(relationship)
    parts.push(
      discriminator
        ? `${kind?.label ?? relationship.kind} ${discriminator}`
        : (kind?.label ?? relationship.kind),
    )
  }
  if (relationships.length > MAX_NAMED_RELATIONSHIPS) {
    parts.push(
      CANVAS_A11Y_TEXT.furtherRelationships(
        countText('relationship', relationships.length - MAX_NAMED_RELATIONSHIPS),
      ),
    )
  }

  parts.push(
    ...workStatePhrase(
      dominantOverlay(Object.values(edge.data?.overlays ?? {})),
      countText,
    ),
  )
  return parts.join(', ')
}

/**
 * Names every edge and marks it as a relationship.
 *
 * React Flow makes edges focusable and labels them `Edge from <id> to <id>` —
 * English, built from ids rather than from the reported names, and identical
 * for a single call and for a bundle of three NATS topics. A tab stop that
 * announces neither what it connects nor what it carries is the same defect as
 * an unnamed node, so the edges are named from the same reported data the line
 * is drawn from.
 */
export function withEdgeAccessibility(
  edges: readonly ArchitectureEdge[],
  names: ReadonlyMap<ComponentId, string>,
  countText: CountText,
): ArchitectureEdge[] {
  return edges.map((edge) => ({
    ...edge,
    ariaLabel: edgeAccessibleName(edge, names, countText),
    domAttributes: {
      'aria-roledescription': CANVAS_A11Y_TEXT.relationshipRoleDescription,
    },
  }))
}
