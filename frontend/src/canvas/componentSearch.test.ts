import { describe, expect, it } from 'vitest'

import type { Component } from '@/api/types'

import { componentSearchEntries, searchComponentEntries } from './componentSearch'

const components: Component[] = [
  {
    componentId: 'platform',
    name: 'Platform',
    kind: 'system' as const,
    parentComponentId: null,
    technology: { framework: 'React' },
    tags: ['core'],
  },
  {
    componentId: 'platform.orders',
    name: 'Orders',
    kind: 'service' as const,
    parentComponentId: 'platform',
    technology: { language: 'TypeScript', runtime: 'Node.js' },
    tags: ['checkout'],
  },
  {
    componentId: 'platform.billing',
    name: 'Orders',
    kind: 'service' as const,
    parentComponentId: 'platform',
    technology: { framework: 'chi' },
    tags: ['payments'],
  },
]

describe('component search inventory', () => {
  it('keeps container paths and searches every reported field', () => {
    const entries = componentSearchEntries(components)
    const orders = entries.find((entry) => entry.component.componentId === 'platform.orders')

    expect(orders?.containerPath).toEqual(['Platform'])
    expect(searchComponentEntries(entries, 'TypeScript')).toHaveLength(1)
    expect(searchComponentEntries(entries, 'checkout')).toHaveLength(1)
    expect(searchComponentEntries(entries, 'platform.orders')).toHaveLength(1)
    expect(searchComponentEntries(entries, 'service')).toHaveLength(2)
  })

  it('includes overlay-only components while preferring applied rows for duplicate ids', () => {
    const entries = componentSearchEntries(components.slice(0, 1), [
      components[1]!,
      { ...components[0]!, name: 'Overlay copy' },
    ])

    expect(entries.map((entry) => entry.component.componentId)).toEqual([
      'platform',
      'platform.orders',
    ])
    expect(entries[0]?.component.name).toBe('Platform')
  })

  it('does not loop when a malformed hierarchy contains a cycle', () => {
    const cyclic = [
      { ...components[0]!, parentComponentId: 'platform.orders' },
      components[1]!,
    ]
    const entries = componentSearchEntries(cyclic)

    expect(entries[0]?.containerPath).toEqual(['Orders'])
    expect(entries[1]?.containerPath).toEqual(['Platform'])
  })
})
