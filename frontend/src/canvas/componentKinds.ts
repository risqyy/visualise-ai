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

import type { TFunction } from 'i18next'

import type { Component, ComponentKind, Technology } from '@/api/types'
import type { CanvasKey } from '@/i18n'
import { resources } from '@/i18n/resources'

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
  /**
   * Key of the badge text. `null` for a kind the contract gained after this
   * table was written — that one is drawn with its reported value, because a
   * word the cockpit does not know is still a fact the agent reported.
   */
  labelKey: CanvasKey | null
  icon: LucideIcon
}

type ComponentKindCatalogueKey = keyof typeof resources.de.canvas.componentKind

export const COMPONENT_KIND_STYLES: Record<ComponentKind, ComponentKindStyle> = {
  system: { id: 'system', labelKey: 'componentKind.system', icon: Boxes },
  service: { id: 'service', labelKey: 'componentKind.service', icon: Server },
  module: { id: 'module', labelKey: 'componentKind.module', icon: Package },
  datastore: { id: 'datastore', labelKey: 'componentKind.datastore', icon: Database },
  queue: { id: 'queue', labelKey: 'componentKind.queue', icon: Inbox },
  topic: { id: 'topic', labelKey: 'componentKind.topic', icon: Radio },
  ui: { id: 'ui', labelKey: 'componentKind.ui', icon: Layers },
  external: { id: 'external', labelKey: 'componentKind.external', icon: Globe },
  library: { id: 'library', labelKey: 'componentKind.library', icon: Library },
}

export function componentKindStyle(kind: ComponentKind): ComponentKindStyle {
  return COMPONENT_KIND_STYLES[kind] ?? { id: kind, labelKey: null, icon: Package }
}

/** Badge text of a component kind; the reported value when we have no word. */
export function componentKindLabel(kind: ComponentKind, t: TFunction<'canvas'>): string {
  const key = componentKindStyle(kind).labelKey
  return key === null ? kind : t(key)
}

/**
 * The visible kind labels are searchable in both supported languages. Keeping
 * these values sourced from the catalogues means a localized badge and its
 * command-search index cannot drift apart.
 */
export function componentKindSearchLabels(kind: ComponentKind): string[] {
  const key = componentKindStyle(kind).labelKey
  if (key === null || !key.startsWith('componentKind.')) return []
  const catalogueKey = key.slice('componentKind.'.length) as ComponentKindCatalogueKey
  return [
    resources.de.canvas.componentKind[catalogueKey],
    resources.en.canvas.componentKind[catalogueKey],
  ].filter((label, index, labels): label is string => labels.indexOf(label) === index)
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
