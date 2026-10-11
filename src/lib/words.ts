// Word list + audio manifest access.
import type { AudioManifest, AudioManifestEntry, Word } from '../data/types'
import wordsJson from '../data/words.json'
import manifestJson from '../data/audio-manifest.json'

export interface WordIndex {
  /** All words sorted by rank (most frequent first). */
  readonly list: readonly Word[]
  /** Word ids in rank order. */
  readonly order: readonly string[]
  get(id: string): Word | undefined
  has(id: string): boolean
  /** 0-based position in rank order, or -1. */
  indexOf(id: string): number
}

export function createWordIndex(words: readonly Word[]): WordIndex {
  const list = [...words].sort((a, b) => a.rank - b.rank)
  const byId = new Map<string, Word>()
  const pos = new Map<string, number>()
  list.forEach((w, i) => {
    if (byId.has(w.id)) throw new Error(`Duplicate word id: ${w.id}`)
    byId.set(w.id, w)
    pos.set(w.id, i)
  })
  return {
    list,
    order: list.map((w) => w.id),
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    indexOf: (id) => pos.get(id) ?? -1,
  }
}

export function createManifest(m: AudioManifest) {
  return {
    voiceId: m.voiceId,
    model: m.model,
    entry: (id: string): AudioManifestEntry | undefined => m.entries[id],
    /** Path relative to the site base, or undefined when there is no clip. */
    path: (id: string, kind: 'word' | 'example'): string | undefined => m.entries[id]?.[kind],
  }
}
export type Manifest = ReturnType<typeof createManifest>

/** Join a manifest path onto the site base (import.meta.env.BASE_URL, e.g. "/qian/"). */
export function resolveAudioUrl(path: string, base: string = import.meta.env.BASE_URL ?? '/'): string {
  if (/^(https?:|data:|blob:)/.test(path)) return path
  const b = base.endsWith('/') ? base : base + '/'
  return b + path.replace(/^\/+/, '')
}

let defaultIndex: WordIndex | null = null
let defaultManifest: Manifest | null = null

/** The app's word list (src/data/words.json). */
export function getWords(): WordIndex {
  return (defaultIndex ??= createWordIndex(wordsJson as unknown as Word[]))
}

/** The app's audio manifest (src/data/audio-manifest.json). */
export function getManifest(): Manifest {
  return (defaultManifest ??= createManifest(manifestJson as unknown as AudioManifest))
}
