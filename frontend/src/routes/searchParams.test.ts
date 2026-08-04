import { describe, expect, it } from 'vitest'

import { validateWorkspaceSearch, type WorkspaceSearch } from './searchParams'

// Compile-time proof that the search parameters are typed, not `any`.
// `npm run typecheck` fails if either assertion stops holding.
const validSearch: WorkspaceSearch = {
  component: 'shop-platform.orders.domain',
  focus: 'feedback',
  history: true,
}
// @ts-expect-error 'runs' is not one of the two deep-focus targets
const invalidSearch: WorkspaceSearch = { focus: 'runs' }

describe('validateWorkspaceSearch', () => {
  it('accepts the documented parameters', () => {
    expect(validateWorkspaceSearch({ ...validSearch })).toEqual(validSearch)
  })

  it('rejects an unknown focus target and falls back cleanly', () => {
    expect(validateWorkspaceSearch({ ...invalidSearch })).toEqual({})
  })

  it('rejects a non-boolean history flag', () => {
    expect(validateWorkspaceSearch({ history: 'maybe' })).toEqual({})
    expect(validateWorkspaceSearch({ history: false })).toEqual({ history: false })
  })

  it('rejects an empty component id', () => {
    expect(validateWorkspaceSearch({ component: '' })).toEqual({})
  })

  it('normalises a numeric component id back to a string', () => {
    // TanStack Router parses search values as JSON, so `?component=42` arrives
    // as a number even though the contract calls component ids strings.
    expect(validateWorkspaceSearch({ component: 42 })).toEqual({ component: '42' })
  })

  it('drops parameters the workspace does not know', () => {
    expect(
      validateWorkspaceSearch({ component: 'a-b', somethingElse: 'x' }),
    ).toEqual({ component: 'a-b' })
  })

  it('keeps a valid parameter when a sibling is invalid', () => {
    expect(
      validateWorkspaceSearch({ component: 'a-b', focus: 'nope', history: 1 }),
    ).toEqual({ component: 'a-b' })
  })
})
