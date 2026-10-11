import { isRouteErrorResponse, useRouteError } from 'react-router'
import { buttonClasses } from './buttonStyles'
import { EmptyState } from './Display'
import { reloadApp } from './pwaUpdate'
import { UpdateNotice } from './UpdateNotice'

/**
 * Router error boundary: a calm fallback instead of a blank screen. A stale lazy chunk after a
 * deploy is first handled by PwaUpdater (one automatic reload on `vite:preloadError`); if it still
 * lands here, the button does a real reload (React.lazy caches the failed import until then).
 */
export function RouteError() {
  const err = useRouteError()
  const message = isRouteErrorResponse(err)
    ? `${err.status} ${err.statusText}`
    : err instanceof Error
      ? err.message
      : 'Something went wrong.'
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-content flex-col justify-center px-5 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <UpdateNotice />
      <EmptyState
        icon="alert"
        title="Something went wrong"
        action={
          // A real reload, not a hash link: changing only the fragment never reloads the page.
          <button type="button" className={buttonClasses({ variant: 'primary' })} onClick={() => reloadApp('#/')}>
            Back to study
          </button>
        }
      >
        <p>Your progress is saved. Reloading usually fixes this.</p>
        <p className="mt-2 font-mono text-xs wrap-break-word text-muted">{message}</p>
      </EmptyState>
    </div>
  )
}
