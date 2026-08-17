import { EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'
import type { TFunction } from 'i18next'
import { memo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { Relationship } from '@/api/types'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/state/uiStore'
import { WORK_STATE_BY_ID } from '@/state/workStates'

import { ChangeOverlayMark } from './ChangeOverlayMark'
import { dominantOverlay, type ChangeOverlay } from './changeOverlays'
import { unfoldsBundles } from './detailLevel'
import {
  fallbackRoute,
  fanOffset,
  fanRoute,
  pointAtRatio,
  roundedPolylinePath,
  selfLoopRoute,
} from './edgeGeometry'
import type { LayoutPoint } from './elkLayout'
import { resolveRelationships, type ArchitectureEdge } from './graphProjection'
import {
  MARKER_IDS,
  RELATIONSHIP_KIND_STYLE_BY_ID,
  markerUrl,
  reported,
  shortRelationshipDiscriminator,
} from './relationshipKinds'
import { useDetailLevel } from './useDetailLevel'

/**
 * One rendered relationship edge.
 *
 * An edge carries **all** relationships the agent reported for its ordered pair
 * of components. Whether they are drawn as one line or as several is a
 * rendering decision that depends on the zoom level and on what the user asked
 * for — it is never a change to the model:
 *
 * * folded (low zoom, default): one line plus a badge with the count, and the
 *   kinds it contains,
 * * unfolded (high zoom, or after a click on the badge): one line per
 *   relationship, each labelled with a bounded identifier — the topic name for
 *   a NATS topic, the operation for a call. Full reported text stays on the
 *   title, focus state, selection and relationship inspector.
 *
 * That is what makes the bundling reversible: no zoom level and no interaction
 * can make a single reported topic unreachable.
 */

interface EdgeRouteProps {
  points: LayoutPoint[]
  strokeDasharray: string
  marker: 'arrow' | 'arrowclosed'
  emphasised: boolean
  interactive: boolean
  testId?: string
  kind?: string
  /** Reported work state of this line, if any. */
  overlay?: ChangeOverlay | null
  /** Dim lines unrelated to the selected relationship. */
  dimmed?: boolean
}

/**
 * One drawn line. The wide transparent path underneath is the hit area: a 1.5 px
 * line is not a pointer target.
 *
 * A line that carries a work state gets **two** colour-independent markers on
 * top of the state colour: a second path underneath drawn in the state's own
 * dash pattern, and the label badge next to it. The line keeps its kind pattern,
 * because that pattern is what identifies the *kind* — the two encodings must
 * not fight over the same channel.
 */
function EdgeRoute({
  points,
  strokeDasharray,
  marker,
  emphasised,
  interactive,
  testId,
  kind,
  overlay = null,
  dimmed = false,
}: EdgeRouteProps) {
  const path = roundedPolylinePath(points)
  if (path === '') return null

  const state = overlay ? WORK_STATE_BY_ID[overlay.state] : null

  return (
    <>
      {interactive && (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          className="react-flow__edge-interaction"
          opacity={dimmed ? 0.25 : 1}
        />
      )}
      {state && (
        <path
          d={path}
          fill="none"
          stroke={`var(${state.colorVar})`}
          strokeWidth={5}
          strokeOpacity={0.35}
          strokeDasharray={
            state.strokeDasharray === '0' ? undefined : state.strokeDasharray
          }
          strokeLinecap="round"
          data-testid={testId ? `${testId}-state` : undefined}
          data-work-state={overlay?.state}
          data-state-dasharray={state.strokeDasharray}
          opacity={dimmed ? 0.25 : 1}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={state ? `var(${state.colorVar})` : 'currentColor'}
        strokeWidth={emphasised ? 2.25 : 1.5}
        strokeDasharray={strokeDasharray === '0' ? undefined : strokeDasharray}
        strokeLinecap="round"
        markerEnd={markerUrl(marker, emphasised)}
        className={cn(
          'transition-colors duration-150',
          !state && (emphasised ? 'text-ring' : 'text-muted-foreground'),
          dimmed && 'opacity-25',
        )}
        data-testid={testId}
        data-relationship-kind={kind}
        data-dasharray={strokeDasharray}
        data-work-state={overlay?.state}
        data-presence={overlay?.presence}
      />
    </>
  )
}

/** HTML badge anchored to a point in flow coordinates. */
function EdgeBadge({
  point,
  children,
  onClick,
  title,
  testId,
  emphasised,
  detail,
  shortDetail,
  dimmed = false,
  onEscape,
}: {
  point: LayoutPoint
  children: ReactNode
  onClick?: () => void
  title?: string
  testId?: string
  emphasised?: boolean
  /** Full reported discriminator, shown on focus and selection. */
  detail?: string | null
  /** Bounded discriminator shown in the normal canvas state. */
  shortDetail?: string | null
  /** Dim badges on edges unrelated to the active selection. */
  dimmed?: boolean
  /** Clear selection without moving keyboard focus away from the badge. */
  onEscape?: () => void
}) {
  const [focused, setFocused] = useState(false)
  const className = cn(
    'pointer-events-auto rounded-sm border px-1 py-px font-mono text-[10px] leading-tight whitespace-nowrap',
    emphasised
      ? 'border-ring/70 bg-popover text-foreground'
      : 'border-border bg-popover/95 text-muted-foreground',
    onClick && 'hover:border-muted-foreground cursor-pointer',
    dimmed && 'opacity-25',
  )
  const style = {
    position: 'absolute' as const,
    transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`,
  }

  if (onClick) {
    return (
      <button
        type="button"
        style={style}
        className={className}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onClick()
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !onEscape) return
          event.preventDefault()
          event.stopPropagation()
          onEscape()
        }}
        title={title}
        aria-current={emphasised ? 'true' : undefined}
        aria-label={
          detail
            ? `${children} · ${detail}`
            : typeof children === 'string'
              ? children
              : undefined
        }
        data-testid={testId}
      >
        {children}
        {detail &&
          (focused || emphasised ? ` · ${detail}` : shortDetail ? ` · ${shortDetail}` : '')}
      </button>
    )
  }

  return (
    <span style={style} className={className} title={title} data-testid={testId}>
      {children}
    </span>
  )
}

/**
 * The work state of an edge, anchored to a point on its route.
 *
 * Positioned away from the kind badge so both stay readable: the kind badge
 * sits at the middle of the line, the state mark closer to the target.
 */
function EdgeOverlayMark({
  point,
  overlay,
  dimmed = false,
}: {
  point: LayoutPoint
  overlay: ChangeOverlay
  dimmed?: boolean
}) {
  return (
    <span
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`,
      }}
      className={cn('pointer-events-auto', dimmed && 'opacity-25')}
    >
      <ChangeOverlayMark overlay={overlay} />
    </span>
  )
}

export const RelationshipEdge = memo(function RelationshipEdge({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeProps<ArchitectureEdge>) {
  const { t } = useTranslation('canvas')
  const level = useDetailLevel()
  const expandedEdgeIds = useUiStore((state) => state.expandedEdgeIds)
  const toggleEdgeExpanded = useUiStore((state) => state.toggleEdgeExpanded)
  const storedSelectedRelationshipId = useUiStore((state) => state.selectedRelationshipId)
  const setSelectedRelationshipId = useUiStore((state) => state.setSelectedRelationshipId)

  if (!data) return null

  // `null` is an explicit URL-backed deselection. Only an omitted field means
  // that an isolated edge render should consult the local store.
  const selectedRelationshipId =
    data.selectedRelationshipId !== undefined
      ? data.selectedRelationshipId
      : storedSelectedRelationshipId

  const resolved = resolveRelationships(data.relationships)
  if (resolved.length === 0) return null

  // The route comes from ELK when it is still valid. After a drag it is not,
  // and a plain orthogonal fallback between the two handles takes over.
  const route: LayoutPoint[] =
    data.route ??
    (data.sourceComponentId === data.targetComponentId
      ? selfLoopRoute({ x: sourceX, y: sourceY }, { x: targetX, y: targetY })
      : fallbackRoute(
          { x: sourceX, y: sourceY },
          { x: targetX, y: targetY },
          data.fallbackOrientation,
        ))

  const overlays = data.overlays ?? {}
  const bundled = resolved.length > 1
  const unfolded = bundled && (unfoldsBundles(level) || expandedEdgeIds.includes(id))
  const selectedEntry = resolved.find(
    (entry) => entry.relationship.relationshipId === selectedRelationshipId,
  )
  const related = selectedEntry !== undefined
  const hasSelection = selectedRelationshipId !== null
  const dimmed = hasSelection && !related
  const selectRelationship = data.onSelectRelationship ?? setSelectedRelationshipId

  if (!bundled || !unfolded) {
    const edgeOverlay = dominantOverlay(Object.values(overlays))
    const kinds = [...new Set(resolved.map((entry) => entry.relationship.kind))]
    const onlyKind = kinds.length === 1 ? kinds[0] : null
    const style = onlyKind ? RELATIONSHIP_KIND_STYLE_BY_ID[onlyKind] : null
    const single = resolved.length === 1 ? (resolved[0] ?? null) : null
    const emphasised = related

    const badgePoint = pointAtRatio(route, 0.5)
    const badgeLabel = bundled
      ? `${resolved.length} × ${
          style
            ? style.abbreviation
            : kinds
                .map((kind) => RELATIONSHIP_KIND_STYLE_BY_ID[kind]?.abbreviation ?? kind)
                .join('/')
        }`
      : (style?.abbreviation ?? '')
    const discriminator = single?.discriminator ?? null
    const shortDiscriminator = single
      ? shortRelationshipDiscriminator(single.relationship)
      : null

    return (
      <>
        <EdgeRoute
          points={route}
          strokeDasharray={style?.strokeDasharray ?? '3 3'}
          marker={style?.marker ?? 'arrow'}
          emphasised={emphasised}
          interactive
          testId={`edge-path-${id}`}
          overlay={edgeOverlay}
          dimmed={dimmed}
          {...(onlyKind ? { kind: onlyKind } : {})}
        />
        <EdgeLabelRenderer>
          {edgeOverlay && (
            <EdgeOverlayMark
              point={pointAtRatio(route, 0.74)}
              overlay={edgeOverlay}
              dimmed={dimmed}
            />
          )}
          {bundled ? (
            <EdgeBadge
              point={badgePoint}
              onClick={() => toggleEdgeExpanded(id)}
              // The display names are built from reported values; they are
              // interpolated into our sentence, never rewritten.
              title={t('edge.bundleExpand', {
                relationships: resolved.map((entry) => entry.displayName).join(', '),
              })}
              testId={`edge-bundle-${id}`}
              dimmed={dimmed}
              {...(hasSelection ? { onEscape: () => selectRelationship(null) } : {})}
            >
              {badgeLabel} ▸
            </EdgeBadge>
          ) : (
            level !== 'overview' &&
            single && (
              <EdgeBadge
                point={badgePoint}
                onClick={() =>
                  selectRelationship(
                    emphasised ? null : single.relationship.relationshipId,
                  )
                }
                title={relationshipTitle(single.relationship, t)}
                testId={`edge-label-${single.relationship.relationshipId}`}
                {...(emphasised ? { emphasised: true } : {})}
                detail={discriminator}
                shortDetail={shortDiscriminator}
                dimmed={dimmed}
                {...(selectedRelationshipId !== null
                  ? { onEscape: () => selectRelationship(null) }
                  : {})}
              >
                {badgeLabel}
              </EdgeBadge>
            )
          )}
        </EdgeLabelRenderer>
      </>
    )
  }

  // Unfolded bundle: one line and one label per reported relationship.
  return (
    <>
      {resolved.map((entry) => {
        const style = RELATIONSHIP_KIND_STYLE_BY_ID[entry.relationship.kind]
        const fanned = fanRoute(
          route,
          fanOffset(entry.index, entry.total),
          data.fallbackOrientation,
        )
        const emphasised = entry.relationship.relationshipId === selectedRelationshipId
        const entryDimmed = hasSelection && !emphasised
        return (
          <EdgeRoute
            key={entry.relationship.relationshipId}
            points={fanned}
            strokeDasharray={style?.strokeDasharray ?? '3 3'}
            marker={style?.marker ?? 'arrow'}
            emphasised={emphasised}
            interactive={false}
            testId={`edge-path-${entry.relationship.relationshipId}`}
            kind={entry.relationship.kind}
            overlay={overlays[entry.relationship.relationshipId] ?? null}
            dimmed={entryDimmed}
          />
        )
      })}
      <EdgeLabelRenderer>
        {resolved.map((entry) => {
          const overlay = overlays[entry.relationship.relationshipId]
          if (!overlay) return null
          const fanned = fanRoute(
            route,
            fanOffset(entry.index, entry.total),
            data.fallbackOrientation,
          )
          return (
            <EdgeOverlayMark
              key={`state-${entry.relationship.relationshipId}`}
              point={pointAtRatio(fanned, 0.74)}
              overlay={overlay}
              dimmed={hasSelection && entry.relationship.relationshipId !== selectedRelationshipId}
            />
          )
        })}
        {resolved.map((entry) => {
          const style = RELATIONSHIP_KIND_STYLE_BY_ID[entry.relationship.kind]
          const fanned = fanRoute(
            route,
            fanOffset(entry.index, entry.total),
            data.fallbackOrientation,
          )
          const emphasised = entry.relationship.relationshipId === selectedRelationshipId
          const entryDimmed = hasSelection && !emphasised
          const discriminator = entry.discriminator
          const shortDiscriminator = shortRelationshipDiscriminator(entry.relationship)
          return (
            <EdgeBadge
              key={entry.relationship.relationshipId}
              point={pointAtRatio(fanned, 0.5)}
              onClick={() =>
                selectRelationship(
                  emphasised ? null : entry.relationship.relationshipId,
                )
              }
              title={relationshipTitle(entry.relationship, t)}
              testId={`edge-label-${entry.relationship.relationshipId}`}
              {...(emphasised ? { emphasised: true } : {})}
              detail={discriminator}
              shortDetail={shortDiscriminator}
              dimmed={entryDimmed}
              {...(hasSelection
                ? { onEscape: () => selectRelationship(null) }
                : {})}
            >
              {style?.abbreviation ?? entry.relationship.kind}
            </EdgeBadge>
          )
        })}
        <EdgeBadge
          point={pointAtRatio(route, 0.12)}
          onClick={() => toggleEdgeExpanded(id)}
          title={t('edge.bundleCollapse')}
          testId={`edge-collapse-${id}`}
          dimmed={dimmed}
        >
          ▾ {resolved.length}
        </EdgeBadge>
      </EdgeLabelRenderer>
    </>
  )
})

/**
 * The `title` of one relationship: our word for its kind, then the values the
 * agent reported for it.
 *
 * The labels are translated; `protocol`, `operation` and `channel` are reported
 * project data — a NATS topic in particular — and are interpolated verbatim. A
 * `title` attribute holds a string, so this is the interpolation half of the
 * translation contract (ADR 0014).
 */
function relationshipTitle(relationship: Relationship, t: TFunction<'canvas'>): string {
  const style = RELATIONSHIP_KIND_STYLE_BY_ID[relationship.kind]
  const parts = [
    style ? t(style.labelKey) : relationship.kind,
    reported(relationship.label),
    reported(relationship.protocol)
      ? t('edge.protocol', { value: relationship.protocol })
      : null,
    reported(relationship.operation)
      ? t('edge.operation', { value: relationship.operation })
      : null,
    reported(relationship.channel)
      ? t('edge.channel', { value: relationship.channel })
      : null,
  ].filter((part): part is string => part !== null && part !== undefined)
  return parts.join('\n')
}

/**
 * The two arrow heads, declared once per canvas.
 *
 * React Flow would synthesise a marker per edge; an edge here draws several
 * paths with different heads, so the canvas owns them instead. The arrow head
 * is one of the three colour-independent channels that distinguish a
 * relationship kind.
 */
export function EdgeMarkerDefs() {
  return (
    <svg className="pointer-events-none absolute size-0" aria-hidden="true">
      <defs>
        <marker
          id={MARKER_IDS.arrowclosed}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--graphite-400)" />
        </marker>
        <marker
          id={MARKER_IDS.arrow}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path
            d="M 1 1 L 9 5 L 1 9"
            fill="none"
            stroke="var(--graphite-400)"
            strokeWidth="1.6"
          />
        </marker>
        <marker
          id={MARKER_IDS.arrowclosedSelected}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ring)" />
        </marker>
        <marker
          id={MARKER_IDS.arrowSelected}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="var(--ring)" strokeWidth="1.6" />
        </marker>
      </defs>
    </svg>
  )
}
