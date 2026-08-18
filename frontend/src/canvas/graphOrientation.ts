/** The two supported readings of the architecture graph. */
export const GRAPH_ORIENTATIONS = ['top-down', 'left-right'] as const

export type GraphOrientation = (typeof GRAPH_ORIENTATIONS)[number]

/** Top-down is the default because vertical space is the scarce resource in a wide workspace. */
export const DEFAULT_GRAPH_ORIENTATION: GraphOrientation = 'top-down'

export type ElkDirection = 'DOWN' | 'RIGHT'

export function elkDirectionForOrientation(orientation: GraphOrientation): ElkDirection {
  return orientation === 'top-down' ? 'DOWN' : 'RIGHT'
}

export function orientationForElkDirection(direction: ElkDirection): GraphOrientation {
  return direction === 'DOWN' ? 'top-down' : 'left-right'
}
