import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { buttonClasses } from './buttonStyles'
import { EmptyState } from './Display'

/** Router error boundary: a calm fallback instead of a blank screen. */
export function RouteError() {
  const err = useRouteError()
  const message = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : err instanceof Error
      ? err.message
      : 'Something went wrong.'
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-content flex-col items-center justify-center px-5">
      <EmptyState
        icon="alert"
        title="Something went wrong"
        action={
          <>
            <Link to="/" className={buttonClasses({ variant: 'primary' })} reloadDocument>
              Back to study
            </Link>
          </>
        }
      >
        <p>Your progress is saved. Reloading usually fixes this.</p>
        <p className="mt-2 font-mono text-xs break-words text-faint">{message}</p>
      </EmptyState>
    </div>
  )
}
