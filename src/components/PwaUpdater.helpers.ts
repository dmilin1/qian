// Plain logic behind PwaUpdater.tsx, kept free of `virtual:pwa-register` so it is easy to test.

/** Check for a new deployment this often while the app stays open (installed PWAs rarely reload). */
export const UPDATE_CHECK_MS = 60 * 60 * 1000
/** Minimum gap between update checks triggered by resuming the app or coming back online. */
export const RESUME_CHECK_GAP_MS = 10 * 60 * 1000
/** Reload at most once per this window after a lazy chunk fails to load (avoids a reload loop). */
export const CHUNK_RELOAD_GAP_MS = 60 * 1000
export const CHUNK_RELOAD_KEY = 'qian:chunk-reload-at'

/**
 * Returns a throttled `check()` that asks the browser to look for a new service worker.
 * Mobile OSes freeze timers in backgrounded standalone apps and resume them without a reload,
 * so the hourly interval alone can leave an installed PWA days behind; `check` also runs on resume.
 */
export function createUpdateCheck(
  registration: Pick<ServiceWorkerRegistration, 'update'>,
  opts: { now?: () => number; online?: () => boolean; minGapMs?: number } = {},
): () => boolean {
  const now = opts.now ?? Date.now
  const online = opts.online ?? (() => navigator.onLine)
  const gap = opts.minGapMs ?? RESUME_CHECK_GAP_MS
  // Registration itself just checked, so the first resume check waits a full gap.
  let last = now()
  return () => {
    if (!online() || now() - last < gap) return false
    last = now()
    void registration.update().catch(() => {})
    return true
  }
}

/**
 * Wires `check` to the hourly timer, to the app becoming visible again, and to coming back online.
 * Returns a cleanup function (PwaUpdater lives for the app's lifetime, so it is mostly for tests).
 */
export function watchForUpdates(check: () => unknown, win: Window = window, doc: Document = document): () => void {
  const timer = win.setInterval(check, UPDATE_CHECK_MS)
  const onVisible = () => {
    if (doc.visibilityState === 'visible') check()
  }
  doc.addEventListener('visibilitychange', onVisible)
  win.addEventListener('online', check)
  return () => {
    win.clearInterval(timer)
    doc.removeEventListener('visibilitychange', onVisible)
    win.removeEventListener('online', check)
  }
}

/**
 * Handler for Vite's `vite:preloadError` (a lazy route chunk failed to load). After a deploy the
 * new service worker deletes the old precached chunks and GitHub Pages no longer serves them, so a
 * page still running the old code can't open a lazy route (Stats). Reload onto the new version
 * (progress is saved after every answer) - at most once per CHUNK_RELOAD_GAP_MS, so a chunk that is
 * missing for another reason falls through to the route error screen instead of looping.
 */
export function handleChunkError(
  e: Event,
  opts: { storage?: Pick<Storage, 'getItem' | 'setItem'> | null; now?: () => number; reload?: () => void } = {},
): boolean {
  const now = (opts.now ?? Date.now)()
  let storage = opts.storage
  if (storage === undefined) {
    try {
      storage = window.sessionStorage
    } catch {
      storage = null
    }
  }
  // Without a working guard a reload could loop; let the error screen handle it instead.
  if (!storage) return false
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY) ?? 0)
    if (now - last < CHUNK_RELOAD_GAP_MS) return false
    storage.setItem(CHUNK_RELOAD_KEY, String(now))
  } catch {
    return false
  }
  e.preventDefault()
  ;(opts.reload ?? (() => window.location.reload()))()
  return true
}

/** Run `fn` when the browser is idle (falls back to a short timeout; Safari lacks requestIdleCallback). */
export function whenIdle(fn: () => void, win: Window = window): () => void {
  if (typeof win.requestIdleCallback === 'function') {
    const id = win.requestIdleCallback(fn, { timeout: 10_000 })
    return () => win.cancelIdleCallback(id)
  }
  const id = win.setTimeout(fn, 3000)
  return () => win.clearTimeout(id)
}
