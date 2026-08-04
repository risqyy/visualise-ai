import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'

import { useProjects } from '@/api/queries'
import { AsyncState } from '@/components/AsyncState'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

/** `/projects` — entry point of the cockpit. */
export function ProjectsPage() {
  const projects = useProjects()
  const list = projects.data?.projects ?? []

  return (
    <main className="min-h-0 flex-1">
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-3xl px-6 py-10">
          <h1 className="text-xl font-semibold">Projekte</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Beobachtete Projekte. Ein Projekt öffnet direkt seinen aktuellen Run.
          </p>

          <div className="mt-6">
            <AsyncState
              isPending={projects.isPending}
              isError={projects.isError}
              error={projects.error}
              isEmpty={list.length === 0}
              emptyTitle="Noch keine Projekte gemeldet"
              emptyDescription="Ein Projekt entsteht, sobald ein Agent das erste Ereignis an /api/v1/events sendet."
              onRetry={() => void projects.refetch()}
              skeletonRows={4}
            >
              <ul className="space-y-2">
                {list.map((project) => (
                  <li key={project.projectId}>
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.projectId }}
                      className="border-border bg-card hover:bg-accent focus-visible:ring-ring flex items-center gap-3 rounded-lg border px-4 py-3 focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{project.name}</span>
                        <span className="text-muted-foreground block truncate font-mono text-xs">
                          {project.projectId}
                        </span>
                      </span>
                      <Badge variant="outline" className="text-2xs font-normal">
                        {project.runCount} Runs
                      </Badge>
                      <Badge variant="outline" className="text-2xs font-normal">
                        {project.currentRunId ?? 'kein aktueller Run'}
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
