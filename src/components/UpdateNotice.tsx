import { cx } from './cx'
import { Icon } from './Icon'
import { dismissUpdate, reloadApp, useUpdateState } from './pwaUpdate'

/**
 * In-flow "new version" notice at the top of the page (AppShell's <main>, RouteError). Kept in
 * the page flow rather than as a fixed toast so it never covers the study buttons. The
 * role="status" wrapper stays mounted so screen readers announce the text when it appears.
 */
export function UpdateNotice({ className }: { className?: string }) {
  const state = useUpdateState()
  return (
    <div role="status">
      {state === 'ready' ? (
        <div className={cx('flex items-center gap-3 rounded-xl border border-line bg-sunken py-1.5 pr-1.5 pl-4 text-sm text-ink', className)}>
          <Icon name="info" size={18} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 py-1">A new version of qian is ready.</span>
          <button
            type="button"
            onClick={() => reloadApp()}
            className="min-h-10 cursor-pointer rounded-lg bg-card px-3 font-medium text-ink shadow-sm hover:bg-paper"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={dismissUpdate}
            aria-label="Later"
            title="Later"
            className="flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-card hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
