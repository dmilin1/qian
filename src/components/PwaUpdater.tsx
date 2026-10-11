// Registers the service worker (vite-plugin-pwa, registerType "autoUpdate") and shows a small
// toast when a new version has taken over, instead of reloading in the middle of a card.
// Kept out of the components barrel: `virtual:pwa-register/react` only exists inside Vite.
import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Icon } from './Icon'

/** Check for a new deployment this often while the app stays open (installed PWAs rarely reload). */
const UPDATE_CHECK_MS = 60 * 60 * 1000

export function PwaUpdater() {
  const [needReload, setNeedReload] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useRegisterSW({
    // With autoUpdate the new service worker is already active; the page only needs a reload to
    // run the new code. Let the learner choose when (progress is saved after every answer).
    onNeedReload: () => setNeedReload(true),
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => {
        if (navigator.onLine) void registration.update().catch(() => {})
      }, UPDATE_CHECK_MS)
    },
  })

  if (!needReload || dismissed) return null
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-40 flex justify-center px-5 sm:bottom-6"
    >
      <div className="pointer-events-auto flex max-w-content items-center gap-1 rounded-xl bg-ink py-1.5 pr-1.5 pl-4 text-sm text-paper shadow-pop motion-safe:animate-rise-in">
        <span className="mr-2 py-1">A new version of qian is ready.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-10 cursor-pointer rounded-lg bg-paper/15 px-3 font-medium hover:bg-paper/25"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Later"
          title="Later"
          className="flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-lg hover:bg-paper/15"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  )
}
