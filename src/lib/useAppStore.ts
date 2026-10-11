// React bindings for the app store and audio player (useSyncExternalStore, no state library).
import { useSyncExternalStore } from 'react'
import type { AudioPlayer } from './audio'
import { getAppStore, type AppSnapshot, type AppStore } from './store'

/** Re-renders on every store change. Snapshot objects are immutable; compare fields as needed. */
export function useAppSnapshot(store: AppStore = getAppStore()): AppSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/**
 * Subscribe to one primitive/stable value of the snapshot (selector must return a primitive or
 * an object already present in the snapshot, never a freshly built object).
 */
export function useAppSelector<T>(selector: (s: AppSnapshot) => T, store: AppStore = getAppStore()): T {
  const get = () => selector(store.getSnapshot())
  return useSyncExternalStore(store.subscribe, get, get)
}

/** Whether audio has been unlocked by a user gesture (autoplay policies). */
export function useAudioUnlocked(player: AudioPlayer): boolean {
  return useSyncExternalStore(player.subscribe, player.getUnlocked, player.getUnlocked)
}
