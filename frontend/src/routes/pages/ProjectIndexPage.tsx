import { Link, getRouteApi } from '@tanstack/react-router'

import { useProject } from '@/api/queries'
import { AsyncState, EmptyState } from '@/components/AsyncState'
import { Button } from '@/components/ui/button'

const route = getRouteApi('/projects/$projectId/')

/**
 * `/projects/$projectId` — forwards to the project's current run.
 *
 * The redirect happens in the route loader, so a bookmark to the bare project
 * lands on the current run without ever rendering an intermediate screen. This
 * component is only reached when there is nothing to forward *to*: a project
 * that has not reported a run yet.
 */
export function ProjectIndexPage() {
  const { projectId } = route.useParams()
  const project = useProject(projectId)

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <AsyncState
        isPending={project.isPending}
        isError={project.isError}
        error={project.error}
        emptyTitle="Projekt nicht verfügbar"
        onRetry={() => void project.refetch()}
      >
        {/* A project has no display name in the contract — it is its slug. */}
        <h1 className="font-mono text-xl font-semibold">{projectId}</h1>
        <EmptyState
          className="mt-4"
          title="Noch kein Run gemeldet"
          description="Für dieses Projekt liegt kein Run vor. Sobald ein Orchestrator ein Ereignis sendet, öffnet dieses Projekt seinen aktuellen Run automatisch."
        />
        <Button asChild variant="outline" className="mt-4">
          <Link to="/projects">Zurück zur Projektliste</Link>
        </Button>
      </AsyncState>
    </main>
  )
}
