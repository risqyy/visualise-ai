import { describe, expect, it } from 'vitest'

import type { Relationship } from '@/api/types'

import {
  MAX_CANVAS_RELATIONSHIP_ADJUNCT_LENGTH,
  shortRelationshipDiscriminator,
} from './relationshipKinds'

const relationship = (overrides: Partial<Relationship>): Relationship => ({
  relationshipId: 'relationship-test',
  sourceComponentId: 'source',
  targetComponentId: 'target',
  kind: 'http',
  ...overrides,
})

describe('normal relationship labels', () => {
  it('keeps a short discriminator as a bounded adjunct', () => {
    const value = 'GET /orders'
    expect(shortRelationshipDiscriminator(relationship({ operation: value }))).toBe(value)
  })

  it('hides a long discriminator from the normal canvas label', () => {
    const value = 'GET /orders/{orderId}/fulfilment/with-a-long-report-name'
    expect(value.length).toBeGreaterThan(MAX_CANVAS_RELATIONSHIP_ADJUNCT_LENGTH)
    expect(shortRelationshipDiscriminator(relationship({ operation: value }))).toBeNull()
  })
})
