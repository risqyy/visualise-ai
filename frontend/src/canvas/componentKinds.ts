import {
  Boxes,
  Database,
  Globe,
  Inbox,
  Layers,
  Library,
  Package,
  Radio,
  Server,
  type LucideIcon,
} from 'lucide-react'

import type { Component, ComponentKind, Technology } from '@/api/types'

import { reported } from './relationshipKinds'

/**
 * Display vocabulary for the nine component kinds of the contract.
 *
 * Like the relationship kinds, a component kind is never expressed through
 * colour — the accent hues belong to the work states. A node carries its kind
 * as a text badge plus a glyph, which survives greyscale and is readable at the
 * lowest detail level, where the kind is all a node shows besides its name.
 */
export interface ComponentKindStyle {
  id: ComponentKind
  label: string
  icon: LucideIcon
}

export const COMPONENT_KIND_STYLES: Record<ComponentKind, ComponentKindStyle> = {
  system: { id: 'system', label: 'System', icon: Boxes },
  service: { id: 'service', label: 'Service', icon: Server },
  module: { id: 'module', label: 'Modul', icon: Package },
  datastore: { id: 'datastore', label: 'Datenspeicher', icon: Database },
  queue: { id: 'queue', label: 'Queue', icon: Inbox },
  topic: { id: 'topic', label: 'Topic', icon: Radio },
  ui: { id: 'ui', label: 'UI', icon: Layers },
  external: { id: 'external', label: 'Extern', icon: Globe },
  library: { id: 'library', label: 'Bibliothek', icon: Library },
}

export function componentKindStyle(kind: ComponentKind): ComponentKindStyle {
  return COMPONENT_KIND_STYLES[kind] ?? { id: kind, label: kind, icon: Package }
}

/**
 * The reported technology metadata as an ordered list of non-empty parts.
 *
 * Nothing is inferred and nothing is filled in: a component whose agent
 * reported no technology simply has no technology row. The read API sends empty
 * strings rather than omitting fields, so empties are filtered here.
 */
export function technologyParts(technology: Technology | undefined): string[] {
  if (!technology) return []
  return [
    reported(technology.language),
    reported(technology.framework),
    reported(technology.runtime),
    reported(technology.version),
  ].filter((part): part is string => part !== null)
}

/** Reported tags with empties removed. */
export function componentTags(component: Component): string[] {
  return (component.tags ?? [])
    .map((tag) => reported(tag))
    .filter((tag): tag is string => tag !== null)
}
