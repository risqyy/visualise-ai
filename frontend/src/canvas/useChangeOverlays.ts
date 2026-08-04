import { useMemo } from 'react'

import type { ArchitectureResponse, ProjectId } from '@/api/types'
import { selectLedgerFor, useChangeLedgerStore } from '@/state/changeLedgerStore'

import {
  buildChangeOverlays,
  EMPTY_OVERLAY_MODEL,
  type ChangeOverlayModel,
} from './changeOverlays'

/**
 * The change overlay of one project, from the two sources it has.
 *
 * * `architecture.activeChanges` — the **pending proposals**, authoritative and
 *   server-side: the read API drops a change from that list the moment it is
 *   applied or retracted, so a withdrawn proposal disappears without the client
 *   remembering anything.
 * * the **change ledger** — the states the read API cannot express, folded out
 *   of the SSE stream: a work step that is running, a change that was just
 *   applied, an element an applied change removed.
 *
 * Both are read-only inputs. Nothing here writes back into the query cache, and
 * the overlay never becomes part of `components`/`relationships`.
 */
export function useChangeOverlays(
  projectId: ProjectId,
  architecture: ArchitectureResponse | undefined,
): ChangeOverlayModel {
  const ledger = useChangeLedgerStore((state) => selectLedgerFor(state, projectId))

  return useMemo(() => {
    // Nothing loaded yet: an overlay without a model to put it on would be a
    // claim about components the cockpit has not seen.
    if (!architecture) return EMPTY_OVERLAY_MODEL
    return buildChangeOverlays({
      components: architecture.components,
      relationships: architecture.relationships,
      activeChanges: architecture.activeChanges,
      ledger,
    })
  }, [architecture, ledger])
}
