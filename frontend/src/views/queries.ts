import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { fetchJson } from '@/api/fetchJson'
import { queryKeys } from '@/api/queryKeys'
import type { ViewListResponse, ViewResponse } from '@/api/types'

export function useViews(projectId: string) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.views(projectId), 'list'],
    queryFn: ({ signal, pageParam }) => fetchJson<ViewListResponse>(`/projects/${encodeURIComponent(projectId)}/views`, { signal, query: { limit: 50, cursor: pageParam } }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  })
}
export function useView(projectId: string, viewId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.view(projectId, viewId ?? ''),
    queryFn: ({ signal }) => fetchJson<ViewResponse>(`/projects/${encodeURIComponent(projectId)}/view`, { signal, query: { viewId } }),
    enabled: viewId !== undefined,
  })
}
