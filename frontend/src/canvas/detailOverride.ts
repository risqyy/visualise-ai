import { createContext } from 'react'
import type { DetailLevel } from './detailLevel'

/** Isolated native renderers specify detail independently of their camera. */
export const DetailOverrideContext = createContext<DetailLevel | null>(null)
