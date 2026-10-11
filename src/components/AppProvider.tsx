// Wires the framework-free store (src/lib/store.ts) and the shared audio player into React.
// Pages use the hooks in ./hooks.ts; tests can inject an in-memory store and a fake player.
import { useEffect, type ReactNode } from 'react'
import { getAudioPlayer, type AudioPlayer } from '../lib/audio'
import { getAppStore, type AppStore } from '../lib/store'
import { useAppSelector } from '../lib/useAppStore'
import { AppContext } from './context'
import { ThemeSync } from './ThemeSync'

interface Props {
  children: ReactNode
  store?: AppStore
  player?: AudioPlayer
  /** Call store.init() on mount (default true). */
  init?: boolean
}

export function AppProvider({ children, store = getAppStore(), player = getAudioPlayer(), init = true }: Props) {
  useEffect(() => {
    if (init) void store.init()
  }, [store, init])

  // Keep the player's slow rate in sync with settings.
  const slowRate = useAppSelector((s) => s.settings.slowRate, store)
  useEffect(() => {
    player.slowRate = slowRate
  }, [player, slowRate])

  return (
    <AppContext value={{ store, player }}>
      <ThemeSync />
      {children}
    </AppContext>
  )
}
