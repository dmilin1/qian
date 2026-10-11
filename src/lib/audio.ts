// Audio playback: pre-generated clips (manifest) with a speechSynthesis (zh-TW) fallback.
import { getManifest, getWords, resolveAudioUrl, type Manifest } from './words'

export type ClipKind = 'word' | 'example'
/** clip = mp3 played; tts = speechSynthesis fallback; blocked = autoplay policy refused (needs a tap); */
export type PlayResult = 'clip' | 'tts' | 'blocked' | 'failed' | 'stopped'

export interface PlayOptions {
  slow?: boolean
}

export interface AudioPlayerOptions {
  manifest?: Manifest
  /** Text to speak when falling back to TTS. Defaults to the word / example characters. */
  textFor?: (wordId: string, kind: ClipKind) => string | undefined
  baseUrl?: string
  slowRate?: number
  createAudio?: () => HTMLAudioElement
  speech?: SpeechSynthesis | null
  /** Where to listen for the first user gesture (default: window). */
  gestureTarget?: EventTarget | null
  /** Safety timeout for TTS utterances whose `end` event never fires. */
  ttsTimeoutMs?: number
}

const TTS_RATE = 0.9
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const
const PRELOAD_MAX = 8
const PREFERRED_VOICE = /taiwan|hsiaochen|hsiaoyu|meijia|mei-jia|hanhan|yating|zhiwei/i
// 0.1 s of silence, used to unlock the shared <audio> element inside the first user gesture.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

/** Best voice for Taiwan Mandarin: known Taiwan voices, then any zh-TW, then any zh-*. */
export function pickZhVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const norm = (l: string) => l.replace('_', '-').toLowerCase()
  const tw = voices.filter((v) => norm(v.lang) === 'zh-tw' || norm(v.lang).startsWith('zh-hant-tw'))
  return (
    tw.find((v) => PREFERRED_VOICE.test(v.name)) ??
    voices.find((v) => norm(v.lang).startsWith('zh') && PREFERRED_VOICE.test(v.name)) ??
    tw[0] ??
    voices.find((v) => norm(v.lang).startsWith('zh') || norm(v.lang).startsWith('cmn')) ??
    null
  )
}

function defaultTextFor(wordId: string, kind: ClipKind): string | undefined {
  const w = getWords().get(wordId)
  return kind === 'word' ? w?.trad : w?.example.trad
}

export class AudioPlayer {
  private manifest: Manifest
  private textFor: (wordId: string, kind: ClipKind) => string | undefined
  private baseUrl: string | undefined
  private createAudio: () => HTMLAudioElement
  private speech: SpeechSynthesis | null
  private ttsTimeoutMs: number
  private el: HTMLAudioElement | null = null
  private token = 0
  private finishCurrent: ((r: PlayResult) => void) | null = null
  private preloaded = new Map<string, HTMLAudioElement>()
  private listeners = new Set<() => void>()
  private gestureTarget: EventTarget | null
  private _unlocked = false
  slowRate: number

  constructor(opts: AudioPlayerOptions = {}) {
    this.manifest = opts.manifest ?? getManifest()
    this.textFor = opts.textFor ?? defaultTextFor
    this.baseUrl = opts.baseUrl
    this.slowRate = opts.slowRate ?? 0.7
    this.createAudio = opts.createAudio ?? (() => new Audio())
    this.speech = opts.speech !== undefined ? opts.speech : (globalThis.speechSynthesis ?? null)
    this.ttsTimeoutMs = opts.ttsTimeoutMs ?? 15_000
    this.gestureTarget = opts.gestureTarget !== undefined ? opts.gestureTarget : typeof window !== 'undefined' ? window : null
    this.listenForGesture(true)
  }

  private listenForGesture(on: boolean) {
    for (const t of GESTURES) {
      if (on) this.gestureTarget?.addEventListener(t, this.onGesture)
      else this.gestureTarget?.removeEventListener(t, this.onGesture)
    }
  }

  // ----- unlocked state (for autoplay policies), useSyncExternalStore-friendly -----

  get unlocked(): boolean {
    return this._unlocked
  }
  getUnlocked = (): boolean => this._unlocked
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private setUnlocked(v: boolean) {
    if (this._unlocked === v) return
    this._unlocked = v
    for (const l of this.listeners) l()
  }

  private onGesture = () => {
    this.unlock()
  }

  /** Call from inside a user gesture (also done automatically on the first pointer/key event). */
  unlock(): void {
    if (this._unlocked) return
    this.setUnlocked(true)
    this.listenForGesture(false)
    // Prime the shared element and speech engine within the gesture (needed on iOS Safari).
    const el = this.element()
    if (!this.finishCurrent) {
      try {
        el.src = SILENT_WAV
        const p = el.play()
        if (p && typeof p.catch === 'function') p.catch(() => {})
      } catch {
        // ignore
      }
    }
    try {
      if (this.speech && !this.speech.speaking && typeof SpeechSynthesisUtterance !== 'undefined') {
        const u = new SpeechSynthesisUtterance('')
        u.volume = 0
        this.speech.speak(u)
      }
    } catch {
      // ignore
    }
  }

  private element(): HTMLAudioElement {
    if (!this.el) {
      this.el = this.createAudio()
      this.el.preload = 'auto'
    }
    return this.el
  }

  urlFor(wordId: string, kind: ClipKind): string | undefined {
    const p = this.manifest.path(wordId, kind)
    return p ? resolveAudioUrl(p, this.baseUrl) : undefined
  }

  /** Stop whatever is playing. A pending play() resolves with 'stopped'. */
  stop(): void {
    this.token++
    const finish = this.finishCurrent
    this.finishCurrent = null
    if (this.el) {
      try {
        this.el.pause()
      } catch {
        // ignore
      }
    }
    try {
      if (this.speech?.speaking || this.speech?.pending) this.speech.cancel()
    } catch {
      // ignore
    }
    finish?.('stopped')
  }

  /**
   * Play a word or example clip. Resolves when playback ends (or is stopped / fails), so
   * callers can chain: `await play(id,'word'); await play(id,'example')`.
   */
  play(wordId: string, kind: ClipKind = 'word', opts: PlayOptions = {}): Promise<PlayResult> {
    this.stop()
    const token = this.token
    const url = this.urlFor(wordId, kind)
    if (!url) return this.speak(wordId, kind, opts, token)

    return new Promise<PlayResult>((resolve) => {
      const el = this.element()
      let settled = false
      const cleanup = () => {
        el.removeEventListener('ended', onEnded)
        el.removeEventListener('error', onError)
      }
      const finish = (r: PlayResult) => {
        if (settled) return
        settled = true
        cleanup()
        if (this.finishCurrent === finish) this.finishCurrent = null
        resolve(r)
      }
      const fallback = () => {
        if (settled) return
        settled = true
        cleanup()
        if (this.finishCurrent === finish) this.finishCurrent = null
        if (token !== this.token) return resolve('stopped')
        resolve(this.speak(wordId, kind, opts, token))
      }
      const onEnded = () => finish('clip')
      const onError = () => fallback()
      this.finishCurrent = finish
      el.addEventListener('ended', onEnded)
      el.addEventListener('error', onError)
      try {
        el.src = url
        el.playbackRate = opts.slow ? this.slowRate : 1
        el.preservesPitch = true
        ;(el as unknown as { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true
        const p = el.play()
        if (p && typeof p.then === 'function') {
          p.then(
            () => {
              if (token === this.token) this.setUnlocked(true)
            },
            (err: unknown) => {
              if (settled || token !== this.token) return
              if ((err as { name?: string })?.name === 'NotAllowedError') {
                // Autoplay refused (e.g. iOS after backgrounding): wait for the next gesture.
                this.setUnlocked(false)
                this.listenForGesture(true)
                finish('blocked')
              } else fallback()
            },
          )
        }
      } catch {
        fallback()
      }
    })
  }

  private speak(wordId: string, kind: ClipKind, opts: PlayOptions, token: number): Promise<PlayResult> {
    const text = this.textFor(wordId, kind)
    const synth = this.speech
    if (!text || !synth || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve('failed')
    return new Promise<PlayResult>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (r: PlayResult) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (this.finishCurrent === finish) this.finishCurrent = null
        resolve(r)
      }
      if (token !== this.token) return finish('stopped')
      this.finishCurrent = finish
      try {
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'zh-TW'
        const voice = pickZhVoice(synth.getVoices())
        if (voice) u.voice = voice
        u.rate = opts.slow ? TTS_RATE * this.slowRate : TTS_RATE
        u.onend = () => finish('tts')
        u.onerror = (ev) => {
          const err = (ev as SpeechSynthesisErrorEvent).error
          finish(err === 'not-allowed' ? 'blocked' : err === 'interrupted' || err === 'canceled' ? 'stopped' : 'failed')
        }
        synth.speak(u)
        timer = setTimeout(() => finish('tts'), this.ttsTimeoutMs)
      } catch {
        finish('failed')
      }
    })
  }

  /** Warm the browser cache for upcoming cards (word + example clips). */
  preload(wordIds: readonly string[], kinds: readonly ClipKind[] = ['word', 'example']): void {
    for (const id of wordIds) {
      for (const kind of kinds) {
        const url = this.urlFor(id, kind)
        if (!url || this.preloaded.has(url)) continue
        try {
          const a = this.createAudio()
          a.preload = 'auto'
          a.src = url
          this.preloaded.set(url, a)
        } catch {
          // ignore
        }
        while (this.preloaded.size > PRELOAD_MAX) {
          const oldest = this.preloaded.keys().next().value as string
          this.preloaded.delete(oldest)
        }
      }
    }
  }

  dispose(): void {
    this.stop()
    this.listenForGesture(false)
    this.listeners.clear()
    this.preloaded.clear()
  }
}

let shared: AudioPlayer | null = null

/** App-wide player (keeps one <audio> element so the iOS gesture unlock sticks). */
export function getAudioPlayer(): AudioPlayer {
  return (shared ??= new AudioPlayer())
}
