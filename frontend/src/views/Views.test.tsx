import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { queryKeys } from '@/api/queryKeys'
import type { ArchitectureResponse, SavedView } from '@/api/types'
import { applyLiveEvent } from '@/api/useLiveStream'
import { useUiStore } from '@/state/uiStore'
import { appliedComponent } from '@/test/architectureFixtures'
import { PROJECT_ID, RUN_ID, createFakeFetch, streamedEvent } from '@/test/fixtures'
import { renderApp } from '@/test/renderApp'

const model: ArchitectureResponse = { projectPosition: 4, modelRevision: 1, components: ['node-aa', 'node-bb'].map((id) => appliedComponent({ componentId: id, name: id, kind: 'service', parentComponentId: null })), relationships: [], activeChanges: [] }
const views: SavedView[] = [
  { viewId: 'all/view', name: 'All', kind: 'architecture', selection: { mode: 'all' }, orientation: 'top-down', collapsedComponentIds: [] },
  { viewId: '..', name: 'Detail', kind: 'architecture', selection: { mode: 'explicit', scope: { componentIds: ['node-aa'], relationshipIds: [] } }, orientation: 'left-to-right', collapsedComponentIds: [] },
]
function fixtureFetch() {
  const state = { model, views: structuredClone(views) }
  const fallback = createFakeFetch()
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    let value: unknown
    if (url.pathname.endsWith('/architecture')) value = state.model
    else if (url.pathname.endsWith('/views')) value = { projectId: PROJECT_ID, projectPosition: state.model.projectPosition, modelRevision: state.model.modelRevision, items: state.views.map((view) => ({ viewId: view.viewId, name: view.name, kind: view.kind, viewRevision: 1 })), nextCursor: null }
    else if (url.pathname.endsWith('/view')) value = { projectId: PROJECT_ID, projectPosition: state.model.projectPosition, modelRevision: state.model.modelRevision, view: state.views.find((view) => view.viewId === url.searchParams.get('viewId')), viewRevision: 1, missingReferences: { componentIds: [], relationshipIds: [] }, boundaryRelationshipIds: [] }
    else return fallback(input, init)
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
  }
  return { state, fetchImpl }
}
async function settled(count: string) {
  const canvas = await screen.findByTestId('architecture-canvas')
  await waitFor(() => expect(canvas).toHaveAttribute('data-node-count', count), { timeout: 15_000 })
  await waitFor(() => expect(canvas).toHaveAttribute('data-layouting', 'false'), { timeout: 15_000 })
  return canvas
}

describe('native saved views in the workspace', () => {
  it('switches opaque IDs and restores each view camera, drag, disclosure, bundles and selection', async () => {
    const fetch = fixtureFetch()
    const app = renderApp(`/projects/${PROJECT_ID}/runs/${RUN_ID}?view=all%2Fview`, { fetchImpl: fetch.fetchImpl })
    await settled('2')
    await waitFor(() => expect(useUiStore.getState().cameraInitialized).toBe(true))
    await userEvent.click(screen.getByTestId('canvas-layout-left-right'))
    await settled('2')
    await waitFor(() => expect(screen.getByTestId('architecture-canvas')).toHaveAttribute('data-layout-orientation', 'left-right'))
    act(() => {
      useUiStore.getState().setCamera({ x: 120, y: 80, zoom: 0.65 })
      useUiStore.getState().setNodePosition('node-aa', { x: 200, y: 300 })
      useUiStore.getState().setCollapsedComponentIds(['node-bb'])
      useUiStore.getState().toggleEdgeExpanded('bundle-aa')
      useUiStore.getState().setSelectedComponentId('node-aa')
    })
    await userEvent.selectOptions(screen.getByTestId('architecture-view-selector'), '..')
    await settled('1')
    expect(app.router.state.location.search).toMatchObject({ view: '..' })
    expect(useUiStore.getState().nodePositions).toEqual({})
    await waitFor(() => expect(useUiStore.getState().cameraInitialized).toBe(true))
    act(() => useUiStore.getState().setCamera({ x: 30, y: 40, zoom: 0.9 }))
    await userEvent.selectOptions(screen.getByTestId('architecture-view-selector'), 'all/view')
    const canvas = await settled('2')
    expect(useUiStore.getState()).toMatchObject({ camera: { x: 120, y: 80, zoom: 0.65 }, nodePositions: { 'node-aa': { x: 200, y: 300 } }, collapsedComponentIds: ['node-bb'], expandedEdgeIds: ['bundle-aa'], selectedComponentId: 'node-aa' })
    expect(canvas).toHaveAttribute('data-fit-view-count', '0')
    expect(canvas).toHaveAttribute('data-layout-orientation', 'left-right')
    expect(app.router.state.location.search).toMatchObject({ layout: 'left-right' })
    expect(app.router.state.location.search).toMatchObject({ component: 'node-aa' })
    await userEvent.selectOptions(screen.getByTestId('architecture-view-selector'), '..')
    await settled('1')
    expect(useUiStore.getState().camera).toEqual({ x: 30, y: 40, zoom: 0.9 })
    act(() => {
      useUiStore.getState().setSelectedComponentId('node-bb')
      useUiStore.getState().setCanvasOrientationOverride('top-down')
    })
    await userEvent.selectOptions(screen.getByTestId('architecture-view-selector'), 'all/view')
    await settled('2')
    // A deep link can change only the view while preserving explicit values
    // identical to the departing URL. The remembered B values must still lose.
    await act(async () => { await app.router.navigate({ to: '/projects/$projectId/runs/$runId', params: { projectId: PROJECT_ID, runId: RUN_ID }, search: { view: '..', component: 'node-aa', layout: 'left-right' } }) })
    await settled('1')
    expect(useUiStore.getState()).toMatchObject({ selectedComponentId: 'node-aa', orientationOverride: 'left-right' })
  })

  it('keeps explicit URL selection and global evidence outside a filtered view; live changes preserve its camera', async () => {
    const fetch = fixtureFetch()
    const app = renderApp(`/projects/${PROJECT_ID}/runs/${RUN_ID}?view=..&component=node-bb`, { fetchImpl: fetch.fetchImpl })
    await settled('1')
    expect(screen.getByTestId('view-diagnostics')).toHaveTextContent('außerhalb')
    expect(app.router.state.location.search).toMatchObject({ component: 'node-bb', view: '..' })
    await waitFor(() => expect(useUiStore.getState().cameraInitialized).toBe(true))
    const camera = useUiStore.getState().camera
    fetch.state.model = { ...model, modelRevision: 2, projectPosition: 5, components: model.components.map((component) => component.componentId === 'node-aa' ? { ...component, name: 'Shared rename' } : component) }
    act(() => applyLiveEvent(app.queryClient, streamedEvent('model.mutation_applied', { expectedModelRevision: 1, operations: [{ op: 'component.update', componentId: 'node-aa', set: { name: 'Shared rename' } }] }, { schemaVersion: '2.0', position: 5 })))
    await waitFor(() => expect(app.queryClient.getQueryData<ArchitectureResponse>(queryKeys.architecture(PROJECT_ID))?.components[0]?.name).toBe('Shared rename'))
    await settled('1')
    expect(document.querySelector('[data-id="node-aa"]')).toHaveAttribute('aria-label', expect.stringContaining('Shared rename'))
    expect(useUiStore.getState().camera).toEqual(camera)
    expect(app.router.state.location.search).toMatchObject({ component: 'node-bb' })
  })
  it('preserves the initialized camera when a live view becomes empty and reappears', async () => {
    const fetch = fixtureFetch()
    const app = renderApp(`/projects/${PROJECT_ID}/runs/${RUN_ID}?view=..`, { fetchImpl: fetch.fetchImpl })
    await settled('1')
    await waitFor(() => expect(useUiStore.getState().cameraInitialized).toBe(true))
    act(() => useUiStore.getState().setCamera({ x: 240, y: 130, zoom: 0.7 }))
    const detail = fetch.state.views[1]!
    fetch.state.views[1] = { ...detail, selection: { mode: 'explicit', scope: { componentIds: [], relationshipIds: [] } } }
    await act(async () => { await app.queryClient.invalidateQueries({ queryKey: queryKeys.view(PROJECT_ID, '..') }) })
    await waitFor(() => expect(screen.queryByTestId('architecture-canvas')).not.toBeInTheDocument())
    fetch.state.views[1] = detail
    await act(async () => { await app.queryClient.invalidateQueries({ queryKey: queryKeys.view(PROJECT_ID, '..') }) })
    const canvas = await settled('1')
    expect(canvas).toHaveAttribute('data-fit-view-count', '0')
    expect(useUiStore.getState().camera).toEqual({ x: 240, y: 130, zoom: 0.7 })
  })

})
