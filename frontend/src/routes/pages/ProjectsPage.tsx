import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useProjects } from '@/api/queries'
import { AsyncState } from '@/components/AsyncState'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ReportedText } from '@/i18n'

/**
 * `/projects` — entry point of the cockpit.
 *
 * The first area migrated onto the translation catalogues (#38), and the worked
 * example of the translation contract: every label here is ours and goes
 * through `t()`, every project id, run id and timestamp is the agent's and goes
 * through `ReportedText` unchanged. The rest of the app follows in #42.
 */
export function ProjectsPage() {
  const { t } = useTranslation('projects')
  const projects = useProjects()
  const list = projects.data?.projects ?? []

  return (
    <main className="min-h-0 flex-1">
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <h1 className="text-xl font-semibold">{t('list.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('list.description')}</p>

          <div className="mt-6">
            <AsyncState
              isPending={projects.isPending}
              isError={projects.isError}
              error={projects.error}
              isEmpty={list.length === 0}
              emptyTitle={t('empty.title')}
              emptyDescription={t('empty.description')}
              onRetry={() => void projects.refetch()}
              skeletonRows={4}
            >
              <ul className="space-y-2">
                {list.map((project) => (
                  <li key={project.projectId}>
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.projectId }}
                      // An accessible name has no room for markup, so the
                      // reported id is interpolated into the translated
                      // sentence instead — i18next passes it through verbatim.
                      aria-label={t('item.openLabel', { projectId: project.projectId })}
                      className="border-border bg-card hover:bg-accent focus-visible:ring-ring flex items-center gap-3 rounded-lg border px-4 py-3 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1">
                        {/*
                          The contract knows no display name for a project: a
                          project is its slug. Nothing is invented here.
                        */}
                        <ReportedText
                          value={project.projectId}
                          className="block truncate font-mono font-medium"
                        />
                        <span className="text-muted-foreground block truncate text-xs">
                          {/*
                            Still the raw reported ISO value. Rendering it in the
                            reader's locale is #40; a format invented here would
                            only have to be undone there.
                          */}
                          {t('item.lastReported')}{' '}
                          <ReportedText value={project.lastEventAt} />
                        </span>
                      </span>
                      <Badge variant="outline" className="text-2xs font-normal">
                        {project.currentRunId ? (
                          <ReportedText value={project.currentRunId} />
                        ) : (
                          t('item.noCurrentRun')
                        )}
                      </Badge>
                      <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </AsyncState>
          </div>
        </div>
      </ScrollArea>
    </main>
  )
}
