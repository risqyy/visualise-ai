import { Link } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'

import { describeError, isProblemError } from '@/api/problem'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/** Route-level error boundary: a failing loader must not blank the cockpit. */
export function ErrorPage({ error, reset }: { error: unknown; reset?: () => void }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>
          {isProblemError(error) ? error.problem.title : 'Ansicht konnte nicht geladen werden'}
        </AlertTitle>
        <AlertDescription>{describeError(error)}</AlertDescription>
      </Alert>
      <div className="mt-4 flex gap-2">
        {reset && (
          <Button variant="outline" onClick={reset}>
            Erneut versuchen
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link to="/projects">Zur Projektliste</Link>
        </Button>
      </div>
    </main>
  )
}

/** Shown for unknown paths. */
export function NotFoundPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold">Seite nicht gefunden</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Diese Adresse gehört zu keiner Ansicht des Cockpits.
      </p>
      <Button asChild variant="outline" className="mt-4">
        <Link to="/projects">Zur Projektliste</Link>
      </Button>
    </main>
  )
}
