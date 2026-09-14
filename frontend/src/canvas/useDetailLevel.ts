import { useStore } from '@xyflow/react'
import { useContext } from 'react'

import { detailLevelForZoom, type DetailLevel } from './detailLevel'
import { DetailOverrideContext } from './detailOverride'

/**
 * The current detail level, derived from the canvas zoom.
 *
 * The selector deliberately returns the *level* and not the zoom: React Flow's
 * store notifies on every zoom frame, and a node that re-rendered 60 times a
 * second while the user scrolls would make a large model crawl. Selecting the
 * derived string means a node only re-renders when it actually has to show
 * something different.
 */
export function useDetailLevel(): DetailLevel {
  const override = useContext(DetailOverrideContext)
  return useStore((state) => override ?? detailLevelForZoom(state.transform[2]))
}
