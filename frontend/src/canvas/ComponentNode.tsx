import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import { cn } from '@/lib/utils'

import { componentKindStyle, componentTags, technologyParts } from './componentKinds'
import { showsTags, showsTechnology } from './detailLevel'
import { HANDLE_IDS, type ArchitectureNode } from './graphProjection'
import { useDetailLevel } from './useDetailLevel'

/**
 * The two node renderers of the architecture canvas.
 *
 * `ComponentNode` draws a component without children, `CompoundNode` draws a
 * container around its children. Both take their size from the layout and
 * **never change it with the detail level** — the box is a fixed part of the
 * layout, only its content grows with the zoom (see `./detailLevel`).
 */

/** Invisible, non-interactive connection points. v0 is read-only. */
function NodeHandles() {
  return (
    <>
      <Handle
        type="target"
        id={HANDLE_IDS.target}
        position={Position.Left}
        isConnectable={false}
        className="!size-1.5 !border-0 !bg-transparent"
      />
      <Handle
        type="source"
        id={HANDLE_IDS.source}
        position={Position.Right}
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

function TechnologyRow({ parts }: { parts: string[] }) {
  if (parts.length === 0) return null
  return (
    <p
      className="text-muted-foreground truncate font-mono text-[10px] leading-tight"
      data-testid="node-technology"
      title={parts.join(' · ')}
    >
      {parts.join(' · ')}
    </p>
  )
}

function TagRow({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1 overflow-hidden" data-testid="node-tags">
      {tags.map((tag) => (
        <li
          key={tag}
          className="bg-secondary/70 text-muted-foreground rounded-sm px-1 text-[10px] leading-tight"
        >
          {tag}
        </li>
      ))}
    </ul>
  )
}

export const ComponentNode = memo(function ComponentNode({
  data,
  selected,
}: NodeProps<ArchitectureNode>) {
  const level = useDetailLevel()
  const { component } = data
  const kind = componentKindStyle(component.kind)
  const Icon = kind.icon
  const technology = technologyParts(component.technology)
  const tags = componentTags(component)

  return (
    <div
      className={cn(
        'bg-card/95 border-border flex h-full w-full flex-col gap-1 overflow-hidden rounded-md border px-2.5 py-2 text-left shadow-sm transition-colors',
        'hover:border-muted-foreground/60',
        selected && 'ring-ring border-ring/70 ring-2',
      )}
      data-testid={`canvas-node-${component.componentId}`}
      data-component-id={component.componentId}
      data-detail-level={level}
      data-selected={selected ? 'true' : 'false'}
    >
      <div className="flex items-start gap-1.5">
        <Icon className="text-muted-foreground mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span
          className="text-foreground min-w-0 flex-1 truncate text-[13px] leading-tight font-medium"
          title={component.name}
          data-testid="node-name"
        >
          {component.name}
        </span>
        <KindBadge label={kind.label} />
      </div>

      {showsTechnology(level) && <TechnologyRow parts={technology} />}
      {showsTags(level) && <TagRow tags={tags} />}

      <NodeHandles />
    </div>
  )
})

export const CompoundNode = memo(function CompoundNode({
  data,
  selected,
}: NodeProps<ArchitectureNode>) {
  const level = useDetailLevel()
  const { component, childCount } = data
  const kind = componentKindStyle(component.kind)
  const Icon = kind.icon
  const technology = technologyParts(component.technology)

  return (
    <div
      className={cn(
        'border-border/90 bg-card/35 h-full w-full rounded-lg border',
        selected && 'ring-ring border-ring/70 ring-2',
      )}
      data-testid={`canvas-node-${component.componentId}`}
      data-component-id={component.componentId}
      data-detail-level={level}
      data-compound="true"
      data-selected={selected ? 'true' : 'false'}
    >
      {/* Header row. The ELK padding reserves exactly this height at the top of
          the container, so it never overlaps a child. */}
      <div className="border-border/70 flex h-10 items-center gap-1.5 border-b px-2.5">
        <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        <span
          className="text-foreground min-w-0 flex-1 truncate text-[13px] leading-tight font-medium"
          title={component.name}
          data-testid="node-name"
        >
          {component.name}
        </span>
        {showsTechnology(level) && technology.length > 0 && (
          <span
            className="text-muted-foreground max-w-40 truncate font-mono text-[10px]"
            data-testid="node-technology"
          >
            {technology.join(' · ')}
          </span>
        )}
        <span className="text-muted-foreground shrink-0 text-[10px]">
          {childCount} Kinder
        </span>
        <KindBadge label={kind.label} />
      </div>

      <NodeHandles />
    </div>
  )
})

