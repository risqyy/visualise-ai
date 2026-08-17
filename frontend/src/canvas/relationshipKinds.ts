import type { Relationship, RelationshipKind } from '@/api/types'
import type { CanvasKey } from '@/i18n'

/**
 * The visual vocabulary of a typed relationship.
 *
 * **Colour is not a channel here — by design.** `src/index.css` reserves the
 * accent hues for the four work states (`src/state/workStates.ts`), because in
 * this product colour carries the meaning "phase of work". Spending six more
 * hues on relationship kinds would either collide with that or force the reader
 * to learn two unrelated colour languages at once.
 *
 * So every edge is drawn in the same graphite ramp and the kind is carried by
 * three colour-independent channels instead:
 *
 * 1. a **stroke pattern** that is unique per kind,
 * 2. an **arrow head** (open or filled),
 * 3. a **badge** with the kind's abbreviation, rendered as text.
 *
 * A greyscale screenshot of the canvas therefore loses no information about
 * what kind of relationship an edge is.
 */
export interface RelationshipKindStyle {
  id: RelationshipKind
  /**
   * Badge text. The strongest colour-independent channel: it is just text.
   *
   * Deliberately **not** translated — `HTTP`, `gRPC` and `NATS` are protocol
   * names, and `DATA`, `ASYNC` and `DEP` are the same token in both languages.
   * See the technical glossary in `frontend/src/i18n/README.md`.
   */
  abbreviation: string
  /** Key of the full label used in tooltips and the legend. */
  labelKey: CanvasKey
  /** Key of the sentence explaining what the kind means. */
  descriptionKey: CanvasKey
  /**
   * SVG `stroke-dasharray`. Unique across all kinds, so the line alone already
   * distinguishes them.
   */
  strokeDasharray: string
  /** Arrow head. `arrowclosed` is filled, `arrow` is an open chevron. */
  marker: 'arrow' | 'arrowclosed'
  /**
   * Which reported field identifies one relationship among its siblings on the
   * same node pair. For `nats_topic` that is the topic name in `channel`.
   */
  discriminatorField: keyof Pick<Relationship, 'channel' | 'operation' | 'label'>
}

export const RELATIONSHIP_KIND_STYLES: readonly RelationshipKindStyle[] = [
  {
    id: 'http',
    abbreviation: 'HTTP',
    labelKey: 'relationshipKind.http.label',
    descriptionKey: 'relationshipKind.http.description',
    strokeDasharray: '0',
    marker: 'arrowclosed',
    discriminatorField: 'operation',
  },
  {
    id: 'grpc',
    abbreviation: 'gRPC',
    labelKey: 'relationshipKind.grpc.label',
    descriptionKey: 'relationshipKind.grpc.description',
    strokeDasharray: '11 4',
    marker: 'arrowclosed',
    discriminatorField: 'operation',
  },
  {
    id: 'data',
    abbreviation: 'DATA',
    labelKey: 'relationshipKind.data.label',
    descriptionKey: 'relationshipKind.data.description',
    strokeDasharray: '2 4',
    marker: 'arrow',
    discriminatorField: 'operation',
  },
  {
    id: 'async',
    abbreviation: 'ASYNC',
    labelKey: 'relationshipKind.async.label',
    descriptionKey: 'relationshipKind.async.description',
    strokeDasharray: '14 4 2 4',
    marker: 'arrow',
    discriminatorField: 'channel',
  },
  {
    id: 'nats_topic',
    abbreviation: 'NATS',
    labelKey: 'relationshipKind.natsTopic.label',
    descriptionKey: 'relationshipKind.natsTopic.description',
    strokeDasharray: '6 3',
    marker: 'arrowclosed',
    discriminatorField: 'channel',
  },
  {
    id: 'dependency',
    abbreviation: 'DEP',
    labelKey: 'relationshipKind.dependency.label',
    descriptionKey: 'relationshipKind.dependency.description',
    strokeDasharray: '1 6',
    marker: 'arrow',
    discriminatorField: 'label',
  },
]

export const RELATIONSHIP_KIND_STYLE_BY_ID: Record<
  RelationshipKind,
  RelationshipKindStyle
> = Object.fromEntries(
  RELATIONSHIP_KIND_STYLES.map((style) => [style.id, style]),
) as Record<RelationshipKind, RelationshipKindStyle>

/**
 * Ids of the two shared SVG markers. They are declared once per canvas so that
 * an edge component can point several paths at them without React Flow having
 * to synthesise one marker per path.
 */
export const MARKER_IDS = {
  arrow: 'vai-edge-marker-arrow',
  arrowclosed: 'vai-edge-marker-arrowclosed',
  /** Highlighted variant used for the selected relationship. */
  arrowSelected: 'vai-edge-marker-arrow-selected',
  arrowclosedSelected: 'vai-edge-marker-arrowclosed-selected',
} as const

export function markerUrl(
  marker: RelationshipKindStyle['marker'],
  selected = false,
): string {
  if (selected) {
    return marker === 'arrow'
      ? `url(#${MARKER_IDS.arrowSelected})`
      : `url(#${MARKER_IDS.arrowclosedSelected})`
  }
  return marker === 'arrow' ? `url(#${MARKER_IDS.arrow})` : `url(#${MARKER_IDS.arrowclosed})`
}

/** Trims a reported string field; an empty string means "not reported". */
export function reported(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The value that identifies one relationship among the parallel relationships
 * of the same node pair — the topic name for `nats_topic`, the operation for a
 * call, the label otherwise. `null` when the agent reported none of them.
 */
export function relationshipDiscriminator(relationship: Relationship): string | null {
  const style = RELATIONSHIP_KIND_STYLE_BY_ID[relationship.kind]
  const preferred = style ? reported(relationship[style.discriminatorField]) : null
  return (
    preferred ??
    reported(relationship.channel) ??
    reported(relationship.operation) ??
    reported(relationship.label) ??
    null
  )
}

/**
 * Short human-readable name of a relationship: the abbreviation of its kind
 * plus whatever identifies it. Never invents a value — a relationship without
 * any reported detail is shown by its kind alone.
 */
export function relationshipDisplayName(relationship: Relationship): string {
  const style = RELATIONSHIP_KIND_STYLE_BY_ID[relationship.kind]
  const abbreviation = style?.abbreviation ?? relationship.kind
  const discriminator = relationshipDiscriminator(relationship)
  return discriminator ? `${abbreviation} · ${discriminator}` : abbreviation
}

/** Maximum adjunct length that can sit on a route without becoming a paragraph. */
export const MAX_CANVAS_RELATIONSHIP_ADJUNCT_LENGTH = 24

/**
 * Returns the bounded detail allowed on a normal canvas label. Long reported
 * discriminators remain available through the label title, focus state and
 * relationship inspector instead of colliding with nodes and other edges.
 */
export function shortRelationshipDiscriminator(
  relationship: Relationship,
): string | null {
  const discriminator = relationshipDiscriminator(relationship)
  return discriminator !== null &&
    discriminator.length <= MAX_CANVAS_RELATIONSHIP_ADJUNCT_LENGTH
    ? discriminator
    : null
}
