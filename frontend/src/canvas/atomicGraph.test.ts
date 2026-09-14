import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { component } from '@/test/fixtures'
import { appliedRelationship } from '@/test/architectureFixtures'
import { layoutArchitecture } from './elkLayout'
import type { ArchitectureModel } from './graphProjection'
import { useArchitectureGraph } from './useArchitectureGraph'

vi.mock('./elkLayout', () => ({ layoutArchitecture: vi.fn() }))
const layout = vi.mocked(layoutArchitecture)
const a = component({ componentId: 'aa', parentComponentId: null })
const b = component({ componentId: 'bb', parentComponentId: null })
const parent = component({ componentId: 'parent', parentComponentId: null, kind: 'system' })
const edge = appliedRelationship({ relationshipId: 'aa-bb', sourceComponentId: 'aa', targetComponentId: 'bb', kind: 'dependency' })
beforeEach(() => {
  layout.mockReset()
  layout.mockImplementation(async (nodes) => ({ nodes: nodes.map((node, i) => ({ ...node, position: { x: i * 300, y: 100 } })), routes: {}, bounds: { width: 800, height: 400 } }))
})

it('keeps coherent add/remove/reparent inventory throughout delayed and rejected ELK solves', async () => {
  const initial: ArchitectureModel = { components: [a, parent], relationships: [] }
  const { result, rerender } = renderHook(({ model }) => useArchitectureGraph(model), { initialProps: { model: initial } })
  expect(result.current.edges).toHaveLength(0)
  await waitFor(() => expect(result.current.isRelayouting).toBe(false))
  const position = result.current.nodes.find((one) => one.id === a.componentId)?.position
  let reject!: (reason: Error) => void
  layout.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  rerender({ model: { components: [a, b, parent], relationships: [edge] } })
  expect(result.current.isRelayouting).toBe(true)
  expect(result.current.nodes.map((one) => one.id)).toContain('bb')
  expect(result.current.nodes.find((one) => one.id === 'aa')?.position).toEqual(position)
  const ids = new Set(result.current.nodes.map((one) => one.id))
  expect(result.current.edges.every((one) => ids.has(one.source) && ids.has(one.target))).toBe(true)
  expect(result.current.routes).toEqual({})
  await act(async () => reject(new Error('layout unavailable')))
  expect(result.current.nodes.map((one) => one.id)).toContain('bb')
  expect(result.current.error).toBeInstanceOf(Error)
  layout.mockImplementationOnce(() => new Promise(() => {}))
  rerender({ model: { components: [{ ...a, parentComponentId: 'parent' }, parent], relationships: [] } })
  expect(result.current.nodes.map((one) => one.id)).not.toContain('bb')
  expect(result.current.nodes.find((one) => one.id === 'aa')?.parentId).toBe('parent')
  expect(result.current.edges).toHaveLength(0)
})
