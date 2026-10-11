// Tracks which clip is playing so every AudioButton for that clip shows a "playing" state,
// including playback started programmatically (autoplay). Start playback via playClip()
// rather than player.play() to get this.
import { useSyncExternalStore } from 'react'
import type { AudioPlayer, ClipKind, PlayOptions, PlayResult } from '../lib/audio'

export interface NowPlaying {
  wordId: string
  kind: ClipKind
  slow: boolean
}

let current: NowPlaying | null = null
let token = 0
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/**
 * Play a clip through `player` and track it. Resolves like player.play(): when playback ends
 * ('clip' | 'tts'), is stopped/replaced ('stopped'), is refused by autoplay policy ('blocked'),
 * or fails ('failed').
 */
export function playClip(player: AudioPlayer, wordId: string, kind: ClipKind = 'word', opts: PlayOptions = {}): Promise<PlayResult> {
  const mine = ++token
  current = { wordId, kind, slow: !!opts.slow }
  emit()
  const done = () => {
    if (token === mine) {
      current = null
      emit()
    }
  }
  let p: Promise<PlayResult>
  try {
    p = player.play(wordId, kind, opts)
  } catch {
    done()
    return Promise.resolve('failed')
  }
  return p.then(
    (r) => {
      done()
      return r
    },
    () => {
      done()
      return 'failed' as PlayResult
    },
  )
}

/** Stop playback (pending playClip promises resolve 'stopped'). */
export function stopPlayback(player: AudioPlayer): void {
  player.stop()
  if (current) {
    token++
    current = null
    emit()
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
const getCurrent = () => current

/** The clip currently playing (via playClip), or null. */
export function useNowPlaying(): NowPlaying | null {
  return useSyncExternalStore(subscribe, getCurrent, getCurrent)
}

/** Whether this specific clip is playing. Pass `slow` to distinguish the slow button. */
export function useIsPlaying(wordId: string, kind: ClipKind = 'word', slow?: boolean): boolean {
  const now = useNowPlaying()
  return !!now && now.wordId === wordId && now.kind === kind && (slow === undefined || now.slow === slow)
}
