import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_MANIFEST } from './__fixtures__/words'
import { AudioPlayer, pickZhVoice } from './audio'
import { createManifest } from './words'

type PlayBehavior = 'ok' | 'notAllowed' | 'fail'

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = []
  static behavior: PlayBehavior = 'ok'
  src = ''
  preload = ''
  playbackRate = 1
  preservesPitch = false
  paused = true
  plays: string[] = []
  constructor() {
    super()
    FakeAudio.instances.push(this)
  }
  play(): Promise<void> {
    this.plays.push(this.src)
    if (FakeAudio.behavior === 'notAllowed') return Promise.reject(Object.assign(new Error('nope'), { name: 'NotAllowedError' }))
    if (FakeAudio.behavior === 'fail') return Promise.reject(Object.assign(new Error('404'), { name: 'NotSupportedError' }))
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  end() {
    this.paused = true
    this.dispatchEvent(new Event('ended'))
  }
}

class FakeUtterance {
  text: string
  lang = ''
  rate = 1
  volume = 1
  voice: unknown = null
  onend: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

const voice = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice

function fakeSpeech(voices: SpeechSynthesisVoice[]) {
  const spoken: FakeUtterance[] = []
  const synth = {
    speaking: false,
    pending: false,
    getVoices: () => voices,
    speak: (u: FakeUtterance) => {
      spoken.push(u)
      setTimeout(() => u.onend?.(), 0)
    },
    cancel: vi.fn(),
  }
  return { synth: synth as unknown as SpeechSynthesis, spoken }
}

const manifest = createManifest(FIXTURE_MANIFEST)
const textFor = (id: string, kind: 'word' | 'example') => (kind === 'word' ? `字:${id}` : `例:${id}`)
const lastAudio = () => FakeAudio.instances[0]

describe('pickZhVoice', () => {
  it('prefers known Taiwan voices, then zh-TW, then zh-*', () => {
    const cn = voice('Tingting', 'zh-CN')
    const twGeneric = voice('Google 國語（臺灣）', 'zh-TW')
    const meijia = voice('Meijia', 'zh-TW')
    const hk = voice('Sinji', 'zh-HK')
    expect(pickZhVoice([cn, twGeneric, meijia, hk])).toBe(meijia)
    expect(pickZhVoice([cn, twGeneric])).toBe(twGeneric)
    expect(pickZhVoice([voice('Samantha', 'en-US'), cn])).toBe(cn)
    expect(pickZhVoice([voice('Microsoft HsiaoChen Online', 'zh_TW'), twGeneric])?.name).toContain('HsiaoChen')
    expect(pickZhVoice([voice('Samantha', 'en-US')])).toBeNull()
  })
})

describe('AudioPlayer', () => {
  beforeEach(() => {
    FakeAudio.instances = []
    FakeAudio.behavior = 'ok'
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  })
  afterEach(() => vi.unstubAllGlobals())

  const make = (speech = fakeSpeech([voice('Meijia', 'zh-TW')]), target: EventTarget | null = null) =>
    new AudioPlayer({ manifest, textFor, baseUrl: '/qian/', createAudio: () => new FakeAudio() as unknown as HTMLAudioElement, speech: speech.synth, gestureTarget: target })

  it('plays a clip from the manifest resolved against the base URL and resolves on end', async () => {
    const p = make()
    const done = p.play('w4f60', 'word')
    await Promise.resolve()
    const a = lastAudio()
    expect(a.src).toBe('/qian/audio/w/w4f60.mp3')
    expect(a.playbackRate).toBe(1)
    a.end()
    expect(await done).toBe('clip')
    expect(p.unlocked).toBe(true)
  })

  it('slow playback uses playbackRate with pitch preserved', async () => {
    const p = make()
    p.slowRate = 0.7
    const done = p.play('w4f60', 'example', { slow: true })
    const a = lastAudio()
    expect(a.src).toBe('/qian/audio/s/w4f60.mp3')
    expect(a.playbackRate).toBe(0.7)
    expect(a.preservesPitch).toBe(true)
    a.end()
    expect(await done).toBe('clip')
  })

  it('stop() before playing another: the first play resolves as stopped', async () => {
    const p = make()
    const first = p.play('w4f60', 'word')
    const second = p.play('w4f60', 'example')
    expect(await first).toBe('stopped')
    lastAudio().end()
    expect(await second).toBe('clip')
  })

  it('falls back to speechSynthesis (zh-TW voice) when the clip is missing', async () => {
    const speech = fakeSpeech([voice('Tingting', 'zh-CN'), voice('Meijia', 'zh-TW')])
    const p = make(speech)
    expect(await p.play('w6211', 'example')).toBe('tts')
    expect(speech.spoken[0]).toMatchObject({ text: '例:w6211', lang: 'zh-TW', rate: 0.9 })
    expect((speech.spoken[0].voice as SpeechSynthesisVoice).name).toBe('Meijia')
    expect(await p.play('w6211', 'example', { slow: true })).toBe('tts')
    expect(speech.spoken[1].rate).toBeCloseTo(0.63)
  })

  it('falls back to speechSynthesis when the clip fails to load', async () => {
    FakeAudio.behavior = 'fail'
    const speech = fakeSpeech([voice('Meijia', 'zh-TW')])
    const p = make(speech)
    expect(await p.play('w4f60', 'word')).toBe('tts')
    expect(speech.spoken[0].text).toBe('字:w4f60')
  })

  it('reports blocked autoplay and becomes unlocked on the first gesture', async () => {
    FakeAudio.behavior = 'notAllowed'
    const target = new EventTarget()
    const p = make(undefined, target)
    const seen: boolean[] = []
    p.subscribe(() => seen.push(p.getUnlocked()))
    expect(await p.play('w4f60', 'word')).toBe('blocked')
    expect(p.unlocked).toBe(false)
    FakeAudio.behavior = 'ok'
    target.dispatchEvent(new Event('pointerdown'))
    expect(p.unlocked).toBe(true)
    expect(seen).toEqual([true])
  })

  it('returns failed when there is neither a clip nor speech synthesis', async () => {
    const p = new AudioPlayer({ manifest, textFor, createAudio: () => new FakeAudio() as unknown as HTMLAudioElement, speech: null, gestureTarget: null })
    expect(await p.play('missing', 'word')).toBe('failed')
  })

  it('preloads upcoming clips (bounded)', () => {
    const p = make()
    p.preload(['w4f60', 'w6211', 'missing'])
    const srcs = FakeAudio.instances.map((a) => a.src)
    expect(srcs).toEqual(['/qian/audio/w/w4f60.mp3', '/qian/audio/s/w4f60.mp3', '/qian/audio/w/w6211.mp3'])
    p.preload(['w4f60'])
    expect(FakeAudio.instances.length).toBe(3)
  })
})
