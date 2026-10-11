// "A new version is ready" state, shared between PwaUpdater (registers the service worker; only
// works inside Vite) and UpdateNotice (renders the in-flow notice in AppShell / RouteError).
import { useSyncExternalStore } from 'react'

export type UpdateState = 'none' | 'ready' | 'dismissed'

let state: UpdateState = 'none'
const listeners = new Set<() => void>()

function set(next: UpdateState): void {
  if (next === state) return
  state = next
  listeners.forEach((l) => l())
}

/** A new service worker has taken over; the page needs a reload to run the new code. */
export function markUpdateReady(): void {
  if (state === 'none') set('ready')
}

export function dismissUpdate(): void {
  if (state === 'ready') set('dismissed')
}

/** Test helper. */
export function resetUpdateState(): void {
  set('none')
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, () => state, () => 'none')
}

type ReloadTarget = { location: Pick<Location, 'pathname' | 'search' | 'reload'>; history: Pick<History, 'replaceState'> }

/**
 * Hard-reload the app, optionally landing on another hash route. `replaceState` changes the URL
 * without a hashchange, so the router doesn't soft-navigate first; the reload then starts from a
 * fresh module graph (needed after a failed lazy import, which React.lazy caches).
 */
export function reloadApp(hash?: string, win: ReloadTarget = window): void {
  if (hash !== undefined) win.history.replaceState(null, '', win.location.pathname + win.location.search + hash)
  win.location.reload()
}
