import { createContext } from 'react'

import type { ComponentId } from '@/api/types'

/**
 * How a rendered node reaches back into the canvas.
 *
 * React Flow compares `nodeTypes` by identity and re-renders a node when its
 * `data` changes, so a callback can travel through neither: putting the
 * expand/collapse handler on the node data would re-render every node whenever
 * anything about the disclosure changed, and would make the node data something
 * other than a pure function of the model.
 *
 * A context provided inside the canvas keeps the graph pure and gives the two
 * node renderers exactly the one action they need.
 */
export interface CanvasNodeActions {
  /** Opens or closes one container. */
  toggleCollapsed: (componentId: ComponentId, collapsed: boolean) => void
}

export const CanvasNodeActionsContext = createContext<CanvasNodeActions>({
  toggleCollapsed: () => {},
})
