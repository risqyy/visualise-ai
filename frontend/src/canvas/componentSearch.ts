import type { Component, ComponentId } from '@/api/types'

import { componentKindSearchLabels } from './componentKinds'

/** One component that can be found from the canvas command search. */
export interface ComponentSearchEntry {
  component: Component
  /** Container names from the root to the immediate parent. */
  containerPath: string[]
  /** Normalised fields used by the query matcher. */
  searchValues: string[]
}

/**
 * Builds the search inventory from both the applied model and overlay-only
 * components. Applied rows win when an overlay repeats their id, exactly like
 * the graph projection does. The result is canonical by component id so live
 * refetches cannot make the command list jump around.
 */
export function componentSearchEntries(
  components: readonly Component[],
  overlayComponents: readonly Component[] = [],
): ComponentSearchEntry[] {
  const byId = new Map<ComponentId, Component>()
  for (const component of [...components, ...overlayComponents]) {
    if (!byId.has(component.componentId)) byId.set(component.componentId, component)
  }

  const ordered = [...byId.values()].sort((left, right) =>
    left.componentId < right.componentId ? -1 : left.componentId > right.componentId ? 1 : 0,
  )
  const nameById = new Map(ordered.map((component) => [component.componentId, component.name]))

  return ordered.map((component) => {
    const containerPath = pathOf(component, byId, nameById)
    const technology = Object.values(component.technology ?? {})
    const tags = component.tags ?? []
    return {
      component,
      containerPath,
      searchValues: normaliseValues([
        component.componentId,
        component.name,
        component.kind,
        ...componentKindSearchLabels(component.kind),
        ...technology,
        ...tags,
        ...containerPath,
      ]),
    }
  })
}

/**
 * Matches every query token against at least one reported field. This keeps a
 * query such as "orders service" useful without inventing a global search
 * index or changing the read contract.
 */
export function searchComponentEntries(
  entries: readonly ComponentSearchEntry[],
  query: string,
): ComponentSearchEntry[] {
  const terms = normalise(query)
    .split(/\s+/)
    .filter(Boolean)
  if (terms.length === 0) return [...entries]
  return entries.filter((entry) =>
    terms.every((term) => entry.searchValues.some((value) => value.includes(term))),
  )
}

function pathOf(
  component: Component,
  byId: ReadonlyMap<ComponentId, Component>,
  nameById: ReadonlyMap<ComponentId, string>,
): string[] {
  const path: string[] = []
  const seen = new Set<ComponentId>([component.componentId])
  let parentId = component.parentComponentId ?? null
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    path.unshift(nameById.get(parentId) ?? parent.name)
    parentId = parent.parentComponentId ?? null
  }
  return path
}

function normaliseValues(values: readonly unknown[]): string[] {
  return values.map((value) => normalise(String(value)))
}

function normalise(value: string): string {
  return value.trim().toLocaleLowerCase()
}
