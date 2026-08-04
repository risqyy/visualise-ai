import type { EdgeTypes, NodeTypes } from '@xyflow/react'

import { ComponentNode, CompoundNode } from './ComponentNode'
import { RelationshipEdge } from './RelationshipEdge'
import {
  COMPONENT_NODE_TYPE,
  COMPOUND_NODE_TYPE,
  RELATIONSHIP_EDGE_TYPE,
} from './graphProjection'

/**
 * The React Flow type registries.
 *
 * They live in their own module because React Flow compares them by identity:
 * a map rebuilt on every render would remount every node and edge on every
 * render. Declaring them once, next to the type constants the projection
 * assigns, also keeps the two from drifting apart.
 */
export const ARCHITECTURE_NODE_TYPES: NodeTypes = {
  [COMPONENT_NODE_TYPE]: ComponentNode,
  [COMPOUND_NODE_TYPE]: CompoundNode,
}

export const ARCHITECTURE_EDGE_TYPES: EdgeTypes = {
  [RELATIONSHIP_EDGE_TYPE]: RelationshipEdge,
}
