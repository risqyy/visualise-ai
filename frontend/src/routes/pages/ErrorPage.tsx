import { Link } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { isProblemError } from '@/api/problem'
import { ErrorDescription } from '@/components/ErrorDescription'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ReportedText } from '@/i18n'

/** Route-level error boundary: a failing loader must not blank the cockpit. */
export function ErrorPage({ error, reset }: { error: unknown; reset?: () => void }) {
  const { t } = useTranslation(['errors', 'common'])

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>
          {/* The backend's own title is reported data; ours is the fallback. */}
          {isProblemError(error) ? (
            <ReportedText value={error.problem.title} />
          ) : (
            t('errors:route.title')
          )}
        </AlertTitle>
        <AlertDescription>
          <ErrorDescription error={error} />
        </AlertDescription>
      </Alert>
      <div className="mt-4 flex gap-2">
        {reset && (
          <Button variant="outline" onClick={reset}>
            {t('common:action.retry')}
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link to="/projects">{t('errors:route.backToProjects')}</Link>
        </Button>
      </div>
    </main>
  )
}

/** Shown for unknown paths. */
export function NotFoundPage() {
  const { t } = useTranslation('errors')

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold">{t('notFound.title')}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{t('notFound.description')}</p>
      <Button asChild variant="outline" className="mt-4">
        <Link to="/projects">{t('route.backToProjects')}</Link>
      </Button>
    </main>
  )
}
