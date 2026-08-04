import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'

import { fetchJson } from './fetchJson'
import { queryKeys } from './queryKeys'
import type {
  AgentListResponse,
  ArchitectureResponse,
  ComponentHistoryResponse,
  ComponentId,
  ComponentInspectorResponse,
  PlanListResponse,
  ProjectId,
  ProjectListResponse,
  ProjectResponse,
  RunId,
  RunListResponse,
  RunResponse,
} from './types'

/** Page size used for the two cursor-paged endpoints. */
export const PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// Query options — reusable outside React (route loaders call `ensureQueryData`)
// ---------------------------------------------------------------------------

export function projectsQuery() {
  return queryOptions({
    queryKey: queryKeys.projects(),
    queryFn: ({ signal }) => fetchJson<ProjectListResponse>('/projects', { signal }),
  })
}

export function projectQuery(projectId: ProjectId) {
  return queryOptions({
    queryKey: queryKeys.projectDetail(projectId),
    queryFn: ({ signal }) =>
      fetchJson<ProjectResponse>(`/projects/${encodeURIComponent(projectId)}`, {
        signal,
      }),
  })
}

export function architectureQuery(projectId: ProjectId) {
  return queryOptions({
    queryKey: queryKeys.architecture(projectId),
    queryFn: ({ signal }) =>
      fetchJson<ArchitectureResponse>(
        `/projects/${encodeURIComponent(projectId)}/architecture`,
        { signal },
      ),
  })
}

export function runsQuery(projectId: ProjectId, limit = PAGE_SIZE) {
  return infiniteQueryOptions({
    queryKey: queryKeys.runs(projectId),
    queryFn: ({ signal, pageParam }) =>
      fetchJson<RunListResponse>(`/projects/${encodeURIComponent(projectId)}/runs`, {
        signal,
        query: { limit, cursor: pageParam },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: RunListResponse) => lastPage.nextCursor,
  })
}

export function runQuery(projectId: ProjectId, runId: RunId) {
  return queryOptions({
    queryKey: queryKeys.runDetail(projectId, runId),
    queryFn: ({ signal }) =>
      fetchJson<RunResponse>(
        `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`,
        { signal },
      ),
  })
}

export function agentsQuery(projectId: ProjectId, runId: RunId) {
  return queryOptions({
    queryKey: queryKeys.agents(projectId, runId),
    queryFn: ({ signal }) =>
      fetchJson<AgentListResponse>(
        `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/agents`,
        { signal },
      ),
  })
}

export function plansQuery(projectId: ProjectId, runId: RunId) {
  return queryOptions({
    queryKey: queryKeys.plans(projectId, runId),
    queryFn: ({ signal }) =>
      fetchJson<PlanListResponse>(
        `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/plans`,
        { signal },
      ),
  })
}

export function componentInspectorQuery(
  projectId: ProjectId,
  componentId: ComponentId,
  runId: RunId,
) {
  return queryOptions({
    queryKey: queryKeys.componentInspector(projectId, componentId, runId),
    queryFn: ({ signal }) =>
      fetchJson<ComponentInspectorResponse>(
        `/projects/${encodeURIComponent(projectId)}/components/${encodeURIComponent(componentId)}`,
        { signal, query: { runId } },
      ),
  })
}

export function componentHistoryQuery(
  projectId: ProjectId,
  componentId: ComponentId,
  limit = PAGE_SIZE,
) {
  return infiniteQueryOptions({
    queryKey: queryKeys.componentHistory(projectId, componentId),
    queryFn: ({ signal, pageParam }) =>
      fetchJson<ComponentHistoryResponse>(
        `/projects/${encodeURIComponent(projectId)}/components/${encodeURIComponent(componentId)}/history`,
        { signal, query: { limit, cursor: pageParam } },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ComponentHistoryResponse) => lastPage.nextCursor,
  })
}

// ---------------------------------------------------------------------------
// Hooks — one per read endpoint
// ---------------------------------------------------------------------------

/** `GET /projects` */
export function useProjects() {
  return useQuery(projectsQuery())
}

/** `GET /projects/{projectId}` */
export function useProject(projectId: ProjectId) {
  return useQuery(projectQuery(projectId))
}

/** `GET /projects/{projectId}/architecture` */
export function useArchitecture(projectId: ProjectId) {
  return useQuery(architectureQuery(projectId))
}

/** `GET /projects/{projectId}/runs?limit&cursor` */
export function useRuns(projectId: ProjectId, limit = PAGE_SIZE) {
  return useInfiniteQuery(runsQuery(projectId, limit))
}

/** `GET /projects/{projectId}/runs/{runId}` */
export function useRun(projectId: ProjectId, runId: RunId) {
  return useQuery(runQuery(projectId, runId))
}

/** `GET /projects/{projectId}/runs/{runId}/agents` */
export function useAgents(projectId: ProjectId, runId: RunId) {
  return useQuery(agentsQuery(projectId, runId))
}

/** `GET /projects/{projectId}/runs/{runId}/plans` */
export function usePlans(projectId: ProjectId, runId: RunId) {
  return useQuery(plansQuery(projectId, runId))
}

/**
 * `GET /projects/{projectId}/components/{componentId}?runId={runId}`
 *
 * Disabled while no component is selected: the inspector shows its empty state
 * instead of firing a request without a subject.
 */
export function useComponentInspector(
  projectId: ProjectId,
  componentId: ComponentId | undefined,
  runId: RunId,
) {
  return useQuery({
    ...componentInspectorQuery(projectId, componentId ?? '', runId),
    enabled: Boolean(componentId),
  })
}

/** `GET /projects/{projectId}/components/{componentId}/history?limit&cursor` */
export function useComponentHistory(
  projectId: ProjectId,
  componentId: ComponentId | undefined,
  options: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    ...componentHistoryQuery(projectId, componentId ?? ''),
    enabled: Boolean(componentId) && (options.enabled ?? true),
  })
}
