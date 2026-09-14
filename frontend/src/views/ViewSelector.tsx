import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { useViews } from './queries'

export function ViewSelector({ projectId, viewId, onSelectView }: { projectId: string; viewId?: string | undefined; onSelectView: (id: string | undefined) => void }) {
  const { t } = useTranslation('canvas')
  const views = useViews(projectId)
  const items = views.data?.pages.flatMap((page) => page.items) ?? []
  const found = viewId === undefined || items.some((view) => view.viewId === viewId)
  return <div className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
    <label className="text-xs font-medium" htmlFor="architecture-view-selector">{t('views.label')}</label>
    <select id="architecture-view-selector" data-testid="architecture-view-selector" className="border-input bg-background h-8 min-w-0 max-w-64 rounded-md border px-2 text-xs" value={viewId ?? ''} onChange={(event) => onSelectView(event.target.value || undefined)}>
      <option value="">{t('views.overview')}</option>
      {!found && <option value={viewId}>{viewId}</option>}
      {items.map((view) => <option key={view.viewId} value={view.viewId}>{view.name}</option>)}
    </select>
    {views.hasNextPage && <Button size="sm" variant="ghost" onClick={() => void views.fetchNextPage()} disabled={views.isFetchingNextPage}>{t('views.more')}</Button>}
    {views.isError && <Button size="sm" variant="ghost" onClick={() => void views.refetch()}>{t('views.retry')}</Button>}
  </div>
}
