import type { Relationship, RelationshipKind } from '@/api/types'

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
  /** Badge text. The strongest colour-independent channel: it is just text. */
  abbreviation: string
  /** Full German label used in tooltips and the legend. */
  label: string
  /** One sentence explaining what the kind means. */
  description: string
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
    label: 'HTTP-Aufruf',
    description: 'Synchroner HTTP-Aufruf von der Quelle zum Ziel.',
    strokeDasharray: '0',
    marker: 'arrowclosed',
    discriminatorField: 'operation',
  },
  {
    id: 'grpc',
    abbreviation: 'gRPC',
    label: 'gRPC-Aufruf',
    description: 'Synchroner gRPC-Aufruf von der Quelle zum Ziel.',
    strokeDasharray: '11 4',
    marker: 'arrowclosed',
    discriminatorField: 'operation',
  },
  {
    id: 'data',
    abbreviation: 'DATA',
    label: 'Datenzugriff',
    description: 'Lesender oder schreibender Zugriff auf einen Datenspeicher.',
    strokeDasharray: '2 4',
    marker: 'arrow',
    discriminatorField: 'operation',
  },
  {
    id: 'async',
    abbreviation: 'ASYNC',
    label: 'Asynchrone Nachricht',
    description: 'Asynchroner Nachrichtenfluss ohne unmittelbare Antwort.',
    strokeDasharray: '14 4 2 4',
    marker: 'arrow',
    discriminatorField: 'channel',
  },
  {
    id: 'nats_topic',
    abbreviation: 'NATS',
    label: 'NATS-Topic',
    description:
      'Ein einzelnes NATS-Topic. Jedes Topic bleibt eine eigene Beziehung und wird nie zusammengefasst.',
    strokeDasharray: '6 3',
    marker: 'arrowclosed',
    discriminatorField: 'channel',
  },
  {
    id: 'dependency',
    abbreviation: 'DEP',
    label: 'Abhängigkeit',
    description: 'Strukturelle Abhängigkeit ohne konkretes Laufzeitprotokoll.',
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
