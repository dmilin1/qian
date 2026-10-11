// React hooks for pages. Prefer these over getAppStore()/getAudioPlayer() so tests can inject.
import { use, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { getAudioPlayer, type AudioPlayer } from '../lib/audio'
import type { Settings } from '../lib/settings'
import { getAppStore, type AppSnapshot, type AppStore } from '../lib/store'
import { useAppSelector, useAppSnapshot, useAudioUnlocked } from '../lib/useAppStore'
import { AppContext } from './context'

/** The store (actions: grade, undo, updateSettings, exportData...). */
export function useStore(): AppStore {
  return use(AppContext)?.store ?? getAppStore()
}

/** The shared audio player. */
export function useAudioPlayer(): AudioPlayer {
  return use(AppContext)?.player ?? getAudioPlayer()
}

/** The whole snapshot; re-renders on every store change. */
export function useSnapshot(): AppSnapshot {
  return useAppSnapshot(useStore())
}

/** A slice of the snapshot. The selector must return a primitive or an object from the snapshot. */
export function useSelector<T>(selector: (s: AppSnapshot) => T): T {
  return useAppSelector(selector, useStore())
}

/** Current settings (re-renders only when settings change). */
export function useSettings(): Settings {
  return useSelector((s) => s.settings)
}

/** Settings + a setter: `const [settings, update] = useSettingsState(); update({ toneColors: false })`. */
export function useSettingsState(): [Settings, (patch: Partial<Settings>) => void] {
  const store = useStore()
  return [useSettings(), store.updateSettings]
}

/** Whether audio playback has been unlocked by a user gesture. */
export function useIsAudioUnlocked(): boolean {
  return useAudioUnlocked(useAudioPlayer())
}

/**
 * Sets document.title to "<title> · 千 qian" (or just the brand when title is empty). Use inside a
 * route; it overrides the shell's per-section title.
 */
export function usePageTitle(title: string | null | undefined): void {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = title ? `${title} · 千 qian` : '千 qian'
  }, [title, pathname])
}

/**
 * The current time, refreshed every `intervalMs` and whenever the page becomes visible again
 * (a resumed PWA can sit on a page overnight), for relative times ("in 3 min") and "today".
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return now
}
