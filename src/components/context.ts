import { createContext } from 'react'
import type { AudioPlayer } from '../lib/audio'
import type { AppStore } from '../lib/store'

export interface AppContextValue {
  store: AppStore
  player: AudioPlayer
}

/** null outside <AppProvider>; hooks then fall back to the app-wide singletons. */
export const AppContext = createContext<AppContextValue | null>(null)
