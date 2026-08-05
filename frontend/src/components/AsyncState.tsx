import { RefreshCw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { isProblemError } from '@/api/problem'
import { ErrorDescription } from '@/components/ErrorDescription'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ReportedText } from '@/i18n'
import { cn } from '@/lib/utils'

export interface AsyncStateProps {
  /** `true` while the first load is in flight. */
  isPending: boolean
  isError: boolean
  error: unknown
  /** `true` when the request succeeded but returned nothing to show. */
  isEmpty?: boolean
  emptyTitle: string
  emptyDescription?: string
  onRetry?: () => void
  /** Number of skeleton rows rendered while pending. */
  skeletonRows?: number
  className?: string
  children: ReactNode
}

/**
 * One place where loading, error and empty states are rendered.
 *
 * Every pane routes its queries through it so the three states look and behave
 * the same everywhere, and so an empty result is never silently indistinguishable
 * from a failed one.
 */
export function AsyncState({
  isPending,
  isError,
  error,
  isEmpty = false,
  emptyTitle,
  emptyDescription,
  onRetry,
  skeletonRows = 3,
  className,
  children,
}: AsyncStateProps) {
  // `emptyTitle` and `emptyDescription` stay props: what "nothing here" means is
  // the caller's sentence, not this component's.
  const { t } = useTranslation(['common', 'errors'])

  if (isPending) {
    return (
      <div
        className={cn('space-y-2', className)}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="sr-only">{t('common:state.loading')}</span>
        {Array.from({ length: skeletonRows }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <Alert variant="destructive" className={className}>
        <TriangleAlert />
        <AlertTitle>{t('errors:load.title')}</AlertTitle>
        <AlertDescription>
          {/*
            `ErrorDescription` mostly surfaces what the backend reported — the
            problem title and its stable code. That is reported data and is
            rendered verbatim; only its two generic fallbacks are ours and come
            from the catalogue.
          */}
          <p>
            <ErrorDescription error={error} />
          </p>
          {isProblemError(error) && error.errors.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4">
              {/* Field, code and message are the backend's words throughout. */}
              {error.errors.map((violation) => (
                <li key={`${violation.field}:${violation.code}`}>
                  <ReportedText value={violation.field} className="font-mono" />:{' '}
                  <ReportedText value={violation.message} />
                </li>
              ))}
            </ul>
          )}
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
              <RefreshCw />
              {t('common:action.retry')}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        className={className}
      />
    )
  }

  return <>{children}</>
}

export interface EmptyStateProps {
  title: string
  description?: string | undefined
  className?: string | undefined
  children?: ReactNode
}

/** Neutral "nothing was reported" state. Never invents placeholder content. */
export function EmptyState({ title, description, className, children }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-border/70 text-muted-foreground rounded-md border border-dashed px-3 py-4 text-sm',
        className,
      )}
    >
      <p className="text-foreground/80 font-medium">{title}</p>
      {description && <p className="mt-1 text-xs">{description}</p>}
      {children}
    </div>
  )
}
