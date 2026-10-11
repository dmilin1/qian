// Test helpers: an in-memory store and a fake audio player inside <AppProvider>.
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { FIXTURE_WORDS } from '../lib/__fixtures__/words'
import type { AudioPlayer, PlayResult } from '../lib/audio'
import type { Settings } from '../lib/settings'
import { createAppStore } from '../lib/store'
import { createWordIndex } from '../lib/words'
import { AppProvider } from './AppProvider'

export function makeTestStore(settings: Partial<Settings> = {}) {
  const store = createAppStore({ inMemory: true, storage: null, storageManager: null, words: createWordIndex(FIXTURE_WORDS) })
  if (Object.keys(settings).length) store.updateSettings(settings)
  return store
}

/** A fake player whose play() stays pending until `finish(result)` is called. */
export function makeFakePlayer() {
  let resolve: ((r: PlayResult) => void) | null = null
  const player = {
    slowRate: 0.7,
    play: vi.fn((): Promise<PlayResult> => {
      resolve?.('stopped')
      return new Promise<PlayResult>((r) => (resolve = r))
    }),
    stop: vi.fn(() => {
      resolve?.('stopped')
      resolve = null
    }),
    preload: vi.fn(),
    subscribe: () => () => {},
    getUnlocked: () => true,
  }
  return {
    player: player as unknown as AudioPlayer,
    play: player.play,
    finish(r: PlayResult = 'clip') {
      resolve?.(r)
      resolve = null
    },
  }
}

export function renderWithApp(ui: ReactElement, opts: { settings?: Partial<Settings>; player?: AudioPlayer } = {}) {
  const store = makeTestStore(opts.settings)
  const fake = makeFakePlayer()
  const player = opts.player ?? fake.player
  const result = render(
    <AppProvider store={store} player={player}>
      {ui}
    </AppProvider>,
  )
  return { ...result, store, fake }
}
