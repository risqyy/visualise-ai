import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { TFunction } from 'i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { memo, use } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComponentId } from '@/api/types'
import { ReportedText } from '@/i18n'
import { cn } from '@/lib/utils'
import { WORK_STATE_BY_ID } from '@/state/workStates'

import { ChangeOverlayMark } from './ChangeOverlayMark'
import { nodeDisclosureLabel } from './canvasAccessibility'
import type { ChangeOverlay } from './changeOverlays'
import {
  componentKindLabel,
  componentKindStyle,
  componentTags,
  technologyParts,
} from './componentKinds'
import {
  DISCLOSURE_LABEL_KEYS,
  showsKind,
  showsPrimaryText,
  showsTags,
  showsTechnology,
} from './detailLevel'
import { HANDLE_IDS, type ArchitectureNode } from './graphProjection'
import type { GraphOrientation } from './graphOrientation'
import { CanvasNodeActionsContext } from './nodeActions'
import { useCanvasVoice } from './useCanvasVoice'
import { useDetailLevel } from './useDetailLevel'

/**
 * The two node renderers of the architecture canvas.
 *
 * `ComponentNode` draws a component without children, `CompoundNode` draws a
 * container around its children. Both take their size from the layout and
 * **never change it with the detail level** — the box is a fixed part of the
 * layout, only its content grows with the zoom (see `./detailLevel`).
 *
 * A reported work state is drawn **onto** the box: the border takes the state's
 * line style and colour and a `ChangeOverlayMark` adds the icon and the label.
 * The box size is untouched by it, so a change arriving cannot move the layout
 * under the camera. A node that is not part of the applied model — an announced
 * component, or one an applied change removed — is drawn dimmed and marked as
 * such, so a proposal is never mistaken for something that already exists.
 */

/** Border, tint and data attributes an overlay puts on a node box. */
function overlayBoxProps(
  overlay: ChangeOverlay | null,
  applied: boolean,
  t: TFunction<'canvas'>,
) {
  if (!overlay) {
    return {
      className: '',
      style: undefined,
      attributes: { 'data-applied': applied ? 'true' : 'false' } as Record<string, string>,
    }
  }
  const definition = WORK_STATE_BY_ID[overlay.state]
  return {
    className: cn('border-2', overlay.presence !== 'applied' && 'opacity-80'),
    style: {
      borderColor: `var(${definition.colorVar})`,
      borderStyle: definition.borderStyle,
    } as const,
    attributes: {
      'data-applied': applied ? 'true' : 'false',
      'data-work-state': overlay.state,
      // The word next to the colour, in the active language. It is the
      // colour-independent channel the acceptance suite reads.
      'data-work-state-label': t(definition.labelKey),
      'data-border-style': definition.borderStyle,
      'data-operation': overlay.operation ?? 'none',
      'data-presence': overlay.presence,
      'data-agent-count': String(overlay.agentIds.length),
    } as Record<string, string>,
  }
}

interface DisclosureToggleProps {
  componentId: ComponentId
  /** Reported name of the container this toggle belongs to. */
  componentName: string
  collapsed: boolean
  /** Components hidden behind this container right now. */
  hiddenCount: number
}

/**
 * Expands or collapses one container.
 *
 * `nodrag`/`nopan` stop React Flow from turning the press into a node drag or a
 * canvas pan, and `stopPropagation` keeps it from also selecting the node —
 * opening a container and choosing one are two different intents.
 *
 * The visible `title` stays the short action; the **accessible** name names the
 * container as well (`nodeDisclosureLabel`, #35). A screen reader reaches this
 * button out of context — a canvas full of controls that all announce
 * "Aufklappen" says what would happen but never to what.
 */
function DisclosureToggle({
  componentId,
  componentName,
  collapsed,
  hiddenCount,
}: DisclosureToggleProps) {
  const voice = useCanvasVoice()
  const { toggleCollapsed } = use(CanvasNodeActionsContext)
  const Icon = collapsed ? ChevronRight : ChevronDown
  // The visible title is the short action and counts through the locale-aware
  // formatter (#40); the accessible name additionally says *which* container
  // (#35). Both sentences come out of the catalogue (#42).
  const title = collapsed
    ? voice.t(DISCLOSURE_LABEL_KEYS.expandHidden, {
        hidden: voice.count('component', hiddenCount),
      })
    : voice.t(DISCLOSURE_LABEL_KEYS.collapse)
  const label = nodeDisclosureLabel(
    componentName,
    !collapsed,
    voice,
    collapsed ? hiddenCount : undefined,
  )

  return (
    <button
      type="button"
      className="nodrag nopan text-muted-foreground hover:text-foreground hover:bg-secondary/70 focus-visible:ring-ring -m-0.5 flex shrink-0 items-center gap-0.5 rounded-sm p-0.5 focus-visible:ring-2 focus-visible:outline-none"
      title={title}
      aria-label={label}
      aria-expanded={!collapsed}
      data-testid={`node-disclosure-${componentId}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        toggleCollapsed(componentId, !collapsed)
      }}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  )
}

/** Invisible, non-interactive connection points. v0 is read-only. */
function NodeHandles({ orientation }: { orientation: GraphOrientation }) {
  const topDown = orientation === 'top-down'
  return (
    <>
      <Handle
        type="target"
        id={HANDLE_IDS.target}
        position={topDown ? Position.Top : Position.Left}
        isConnectable={false}
        className="!size-1.5 !border-0 !bg-transparent"
      />
      <Handle
        type="source"
        id={HANDLE_IDS.source}
        position={topDown ? Position.Bottom : Position.Right}
        isConnectable={false}
        className="!size-1.5 !border-0 !bg-transparent"
      />
    </>
  )
}

interface KindBadgeProps {
  label: string
  className?: string
}

function KindBadge({ label, className }: KindBadgeProps) {
  return (
    <span
      className={cn(
        'border-border/80 text-muted-foreground shrink-0 rounded-sm border px-1 py-px text-[10px] leading-tight tracking-wide uppercase',
        className,
      )}
      data-testid="node-kind"
    >
      {label}
    </span>
  )
}

/** The reported technology metadata — the agent's words, never translated. */
function TechnologyRow({ parts }: { parts: string[] }) {
  if (parts.length === 0) return null
  return (
    <p
      className="text-muted-foreground truncate font-mono text-[10px] leading-tight"
      data-testid="node-technology"
      title={parts.join(' · ')}
    >
      <ReportedText value={parts.join(' · ')} />
    </p>
  )
}

/** Reported tags. Same rule as the technology row. */
function TagRow({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1 overflow-hidden" data-testid="node-tags">
      {tags.map((tag) => (
        <li
          key={tag}
          className="bg-secondary/70 text-muted-foreground rounded-sm px-1 text-[10px] leading-tight"
        >
          <ReportedText value={tag} />
        </li>
      ))}
    </ul>
  )
}

export const ComponentNode = memo(function ComponentNode({
  data,
  selected,
}: NodeProps<ArchitectureNode>) {
  const { t } = useTranslation('canvas')
  const level = useDetailLevel()
  const { component, overlay, applied, relationshipSelected } = data
  const kind = componentKindStyle(component.kind)
  const Icon = kind.icon
  const technology = technologyParts(component.technology)
  const tags = componentTags(component)
  const box = overlayBoxProps(overlay, applied, t)

  return (
    <div
      className={cn(
        'bg-card/95 border-border flex h-full w-full flex-col gap-1 overflow-hidden rounded-md border px-2.5 py-2 text-left shadow-sm',
        // Colour and border only, and only over 150 ms: a state arriving must
        // read as a quiet change of appearance, never as motion.
        'transition-[color,background-color,border-color,opacity] duration-150',
        'hover:border-muted-foreground/60',
        box.className,
        selected && 'ring-ring border-ring/70 ring-2',
        relationshipSelected && !selected && 'ring-ring/60 border-ring/60 ring-1',
      )}
      style={box.style}
      data-testid={`canvas-node-${component.componentId}`}
      data-component-id={component.componentId}
      data-detail-level={level}
      data-selected={selected ? 'true' : 'false'}
      data-relationship-selected={relationshipSelected ? 'true' : 'false'}
      {...box.attributes}
    >
      <div className="flex items-start gap-1.5">
        <Icon className="text-muted-foreground mt-px size-3.5 shrink-0" aria-hidden="true" />
        {showsPrimaryText(level) && (
          <span
            className="text-foreground min-w-0 flex-1 truncate text-[13px] leading-tight font-medium"
            title={component.name}
            data-testid="node-name"
          >
            {/* The component's reported name. Not ours, so never translated. */}
            <ReportedText value={component.name} />
          </span>
        )}
        {showsKind(level) && <KindBadge label={componentKindLabel(component.kind, t)} />}
      </div>

      {overlay && (
        <ChangeOverlayMark
          overlay={overlay}
          compact={!showsPrimaryText(level)}
          className="self-start"
        />
      )}
      {showsTechnology(level) && <TechnologyRow parts={technology} />}
      {showsTags(level) && <TagRow tags={tags} />}

      <NodeHandles orientation={data.orientation} />
    </div>
  )
})

export const CompoundNode = memo(function CompoundNode({
  data,
  selected,
}: NodeProps<ArchitectureNode>) {
  const { t } = useTranslation('canvas')
  const { t: tCommon } = useTranslation('common')
  const level = useDetailLevel()
  const {
    component,
    childCount,
    overlay,
    applied,
    collapsed,
    hiddenDescendantCount,
    relationshipSelected,
  } = data
  const kind = componentKindStyle(component.kind)
  const Icon = kind.icon
  const technology = technologyParts(component.technology)
  const box = overlayBoxProps(overlay, applied, t)
  const hiddenCount = hiddenDescendantCount ?? 0

  return (
    <div
      className={cn(
        'border-border/90 bg-card/35 h-full w-full rounded-lg border',
        'transition-[border-color,opacity] duration-150',
        // Closed, the container carries what is behind it as a stacked edge —
        // "there is more inside" without a second box and without a size that
        // depends on the contents.
        collapsed &&
          'bg-card/95 shadow-[4px_4px_0_-1px_var(--card),4px_4px_0_var(--border)]',
        box.className,
        selected && 'ring-ring border-ring/70 ring-2',
        relationshipSelected && !selected && 'ring-ring/60 border-ring/60 ring-1',
      )}
      style={box.style}
      data-testid={`canvas-node-${component.componentId}`}
      data-component-id={component.componentId}
      data-detail-level={level}
      data-compound="true"
      data-selected={selected ? 'true' : 'false'}
      data-relationship-selected={relationshipSelected ? 'true' : 'false'}
      {...(collapsed
        ? {
            'data-collapsed': 'true',
            'data-hidden-count': String(hiddenCount),
            ...(data.overlayRolledUp ? { 'data-overlay-rolled-up': 'true' } : {}),
          }
        : {})}
      {...box.attributes}
    >
      {/* Header row. The ELK padding reserves exactly this height at the top of
          the container, so it never overlaps a child. */}
      <div
        className={cn(
          'border-border/70 flex h-10 items-center gap-1.5 px-2.5',
          !collapsed && 'border-b',
        )}
      >
        <DisclosureToggle
          componentId={component.componentId}
          componentName={component.name}
          collapsed={collapsed === true}
          hiddenCount={collapsed ? hiddenCount : childCount}
        />
        <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        {showsPrimaryText(level) && (
          <span
            className="text-foreground min-w-0 flex-1 truncate text-[13px] leading-tight font-medium"
            title={component.name}
            data-testid="node-name"
          >
            <ReportedText value={component.name} />
          </span>
        )}
        {/* A closed container is only as wide as a leaf, so the metadata moves
            out of the header — squeezed between a technology string and two
            badges, the name is the first thing to lose its space, and the name
            is the one thing that has to stay readable. */}
        {!collapsed && showsTechnology(level) && technology.length > 0 && (
          <span
            className="text-muted-foreground max-w-40 truncate font-mono text-[10px]"
            data-testid="node-technology"
          >
            <ReportedText value={technology.join(' · ')} />
          </span>
        )}
        {overlay && <ChangeOverlayMark overlay={overlay} compact={!showsPrimaryText(level)} />}
        {!collapsed && showsPrimaryText(level) && (
          <span className="text-muted-foreground shrink-0 text-[11px]">
            {tCommon('count.child', { count: childCount })}
          </span>
        )}
        {showsKind(level) && <KindBadge label={componentKindLabel(component.kind, t)} />}
      </div>

      {collapsed && (
        <div className="flex flex-col gap-1 px-2.5 pt-1.5">
          {showsPrimaryText(level) && (
            <p
              className="text-muted-foreground text-[11px] leading-tight"
              data-testid="node-hidden-count"
            >
              {t('node.collapsed', {
                components: tCommon('count.component', { count: hiddenCount }),
              })}
            </p>
          )}
          {showsTechnology(level) && <TechnologyRow parts={technology} />}
        </div>
      )}

      <NodeHandles orientation={data.orientation} />
    </div>
  )
})
