// PWA install helpers. `beforeinstallprompt` can fire right after page load, long before the
// user opens Settings, so the listener is registered when this module is first imported (the
// route table imports SettingsPage eagerly, so that happens at startup).
import { useSyncExternalStore } from 'react'

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

interface InstallState {
  /** A saved beforeinstallprompt event (Chrome, Edge, Samsung Internet, Android). */
  canPrompt: boolean
  /** The app was installed during this session. */
  installedNow: boolean
}

let deferred: BeforeInstallPromptEvent | null = null
let state: InstallState = { canPrompt: false, installedNow: false }
const listeners = new Set<() => void>()

function setState(patch: Partial<InstallState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

function onBeforeInstall(e: Event) {
  // Not calling preventDefault(): the browser may still show its own install UI, and the
  // saved event lets Settings offer an "Install" button as well.
  deferred = e as BeforeInstallPromptEvent
  setState({ canPrompt: true })
}

function onInstalled() {
  deferred = null
  setState({ canPrompt: false, installedNow: true })
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', onBeforeInstall)
  window.addEventListener('appinstalled', onInstalled)
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state,
  )
}

/** Show the browser's install dialog. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred
  if (!e) return 'unavailable'
  try {
    await e.prompt()
    const choice = await e.userChoice
    // A prompt event can only be used once.
    deferred = null
    setState({ canPrompt: false, installedNow: choice.outcome === 'accepted' || state.installedNow })
    return choice.outcome
  } catch {
    deferred = null
    setState({ canPrompt: false })
    return 'unavailable'
  }
}

/** Running as an installed app (home-screen / standalone window). */
export function isStandalone(): boolean {
  try {
    if (globalThis.matchMedia?.('(display-mode: standalone)').matches) return true
    if (globalThis.matchMedia?.('(display-mode: window-controls-overlay)').matches) return true
  } catch {
    // ignore
  }
  return (globalThis.navigator as Navigator & { standalone?: boolean } | undefined)?.standalone === true
}

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined = globalThis.navigator): boolean {
  if (!nav) return false
  const ua = nav.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)
}

/** Test hook: inject a fake prompt event. */
export function __setDeferredPrompt(e: BeforeInstallPromptEvent | null) {
  deferred = e
  setState({ canPrompt: !!e, installedNow: false })
}
