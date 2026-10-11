// Registers the service worker (vite-plugin-pwa, registerType "autoUpdate") and flags when a new
// version has taken over, instead of reloading in the middle of a card. The notice itself is
// UpdateNotice, rendered in the page flow by AppShell and RouteError.
// Kept out of the components barrel: `virtual:pwa-register/react` only exists inside Vite.
import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { manifestClipUrls, pruneAudioCache } from '../features/settings/audioCache'
import { getManifest, getWords } from '../lib/words'
import { createUpdateCheck, handleChunkError, watchForUpdates, whenIdle } from './PwaUpdater.helpers'
import { markUpdateReady } from './pwaUpdate'

export function PwaUpdater() {
  useRegisterSW({
    // With autoUpdate the new service worker is already active; the page only needs a reload to
    // run the new code. Let the learner choose when (progress is saved after every answer).
    onNeedReload: markUpdateReady,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // Hourly while open, plus (throttled) whenever the app is resumed or comes back online.
      watchForUpdates(createUpdateCheck(registration))
    },
  })

  useEffect(() => {
    // A page still running old code whose lazy chunk the new deploy deleted: reload onto the new version.
    const onChunkError = (e: Event) => void handleChunkError(e)
    window.addEventListener('vite:preloadError', onChunkError)
    // Drop cached clips the current manifest no longer uses (regenerated clips get new URLs).
    const cancelIdle = whenIdle(() => void pruneAudioCache(manifestClipUrls(getWords(), getManifest())))
    return () => {
      window.removeEventListener('vite:preloadError', onChunkError)
      cancelIdle()
    }
  }, [])

  return null
}
