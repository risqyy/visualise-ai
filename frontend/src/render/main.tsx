import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant } from '@xyflow/react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { CSSProperties } from 'react'
import { I18nextProvider } from 'react-i18next'
import { ARCHITECTURE_EDGE_TYPES, ARCHITECTURE_NODE_TYPES } from '@/canvas/flowRegistry'
import { EdgeMarkerDefs } from '@/canvas/RelationshipEdge'
import { DetailOverrideContext } from '@/canvas/detailOverride'
import { createI18n } from '@/i18n/createI18n'
import { prepare, DETAILS, type Snapshot, type Settings } from './prepare'
import { painted } from './painted'
import '@xyflow/react/dist/style.css'
import '@/index.css'
import './render.css'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
let started = false
async function visualiseRender(snapshot: Snapshot, settings: Settings) {
  if (started) throw new Error('Each native rendering requires a fresh browser context')
  started = true
  await document.fonts.ready
  const graph = await prepare(snapshot, settings)
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing native render root')
  flushSync(() => createRoot(root).render(
    <I18nextProvider i18n={createI18n({ language: 'en' })}>
      <ReactFlowProvider>
        <DetailOverrideContext.Provider value={DETAILS[settings.detailLevel]}>
          <ReactFlow nodes={graph.nodes} edges={graph.edges}
            style={{ '--vai-canvas-zoom': graph.viewport.zoom, '--vai-canvas-zoom-inverse': 1 / graph.viewport.zoom } as CSSProperties}
            nodeTypes={ARCHITECTURE_NODE_TYPES} edgeTypes={ARCHITECTURE_EDGE_TYPES}
            defaultViewport={graph.viewport} minZoom={0.12} maxZoom={2.5}
            nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
            panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
            preventScrolling={false} proOptions={{ hideAttribution: true }}>
            <EdgeMarkerDefs />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--canvas-grid)" />
          </ReactFlow>
        </DetailOverrideContext.Provider>
      </ReactFlowProvider>
    </I18nextProvider>,
  ))
  await document.fonts.ready
  // React Flow resolves measurements and handles on animation frames. Wait for
  // the actual complete native DOM, then two final paint frames before capture.
  for (let attempt = 0; attempt < 120; attempt++) {
    await frame()
    try {
      painted(graph, settings)
      await frame()
      await frame()
      return painted(graph, settings)
    } catch {
      // The process deadline owns the overall bound; a failed mount is explicit.
    }
  }
  throw new Error('Native graph did not finish painting')
}
declare global {
  interface Window { visualiseRender: typeof visualiseRender }
}
window.visualiseRender = visualiseRender
