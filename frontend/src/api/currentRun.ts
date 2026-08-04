import { queryOptions, useQuery } from '@tanstack/react-query'

import { fetchJson } from './fetchJson'
import { isProblemError } from './problem'
import { queryKeys } from './queryKeys'
import type { ProjectId, RunDetail, RunResponse } from './types'

/**
 * The project's current run, resolved through the contract's `current` alias.
 *
 * ADR 0005 makes "the current run" its own endpoint rather than a flag on the
 * list, and this hook is why that matters here: the run list is cursor-paged, so
 * scanning it for `isCurrent` would silently stop working as soon as the current
 * run is not on the first page. `/runs/current` answers the question directly.
 *
 * **A project without a current run is not an error.** The contract reports it
 * as `404 current_run_not_found`, explicitly distinct from "this run id is
 * wrong", so that case resolves to `null` and the pane renders an empty state.
 * Every other failure still surfaces as an error.
 *
 * The query key is nested **below** `queryKeys.runs(projectId)` on purpose:
 * `run.finished` already invalidates that prefix, so closing a run refreshes the
 * current-run pointer without adding an entry to the event → query-key map.
 */
export const CURRENT_RUN_ALIAS = 'current'

/** The contract's code for "this project never saw a root orchestrator". */
export const CURRENT_RUN_NOT_FOUND = 'current_run_not_found'

export function currentRunQuery(projectId: ProjectId) {
  return queryOptions({
    queryKey: queryKeys.currentRun(projectId),
    queryFn: async ({ signal }): Promise<RunDetail | null> => {
      try {
        const response = await fetchJson<RunResponse>(
          `/projects/${encodeURIComponent(projectId)}/runs/${CURRENT_RUN_ALIAS}`,
          { signal },
        )
        return response.run
      } catch (error) {
        if (isProblemError(error) && error.status === 404) return null
        throw error
      }
    },
  })
}

/** `GET /projects/{projectId}/runs/current` — `null` when there is none. */
export function useCurrentRun(projectId: ProjectId) {
  return useQuery(currentRunQuery(projectId))
}
