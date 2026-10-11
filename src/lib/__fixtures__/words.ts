// Small synthetic fixtures for unit tests (never the real words.json).
import type { AudioManifest, Word } from '../../data/types'

export function makeWord(i: number, over: Partial<Word> = {}): Word {
  return {
    id: `wt${i}`,
    rank: i,
    trad: `字${i}`,
    simp: `字${i}`,
    pinyin: 'zì',
    pinyinNumbered: 'zi4',
    tones: [4],
    gloss: `word ${i}`,
    pos: 'noun',
    example: { trad: `例${i}。`, simp: `例${i}。`, pinyin: 'lì.', english: `example ${i}` },
    ...over,
  }
}

export function makeWords(n: number): Word[] {
  return Array.from({ length: n }, (_, i) => makeWord(i + 1))
}

export const FIXTURE_WORDS: Word[] = [
  makeWord(1, { id: 'w4f60', trad: '你', simp: '你', pinyin: 'nǐ', pinyinNumbered: 'ni3', tones: [3], gloss: 'you' }),
  makeWord(2, { id: 'w6211', trad: '我', simp: '我', pinyin: 'wǒ', pinyinNumbered: 'wo3', tones: [3], gloss: 'I; me' }),
  makeWord(3, { id: 'w662f', trad: '是', simp: '是', pinyin: 'shì', pinyinNumbered: 'shi4', tones: [4], gloss: 'to be' }),
]

export const FIXTURE_MANIFEST: AudioManifest = {
  voiceId: 'test-voice',
  model: 'test-model',
  generatedAt: '2026-01-01T00:00:00Z',
  entries: {
    w4f60: { word: 'audio/w/w4f60.mp3', example: 'audio/s/w4f60.mp3' },
    w6211: { word: 'audio/w/w6211.mp3' },
  },
}
