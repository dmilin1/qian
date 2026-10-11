// Shared data contract between the build-time data pipeline (scripts/) and the app (src/).
// src/data/words.json is an array of Word, sorted by rank ascending.
// src/data/audio-manifest.json is an AudioManifest.

export type Tone = 1 | 2 | 3 | 4 | 5 // 5 = neutral tone

export interface ExampleSentence {
  trad: string // Traditional characters, Taiwan usage
  simp: string
  pinyin: string // tone-marked, words separated by spaces, punctuation kept
  english: string
}

export interface Word {
  // Stable identifier. Never changes once published, even if rank/pinyin/gloss are edited.
  // Format: "w" + lowercase hex code points of `trad` joined by "-", e.g. 你好 -> "w4f60-597d".
  // Only if two entries share the same `trad` (different readings), the later one gets "~" + pinyinNumbered without spaces.
  id: string
  rank: number // 1..N, frequency order (1 = most common)
  trad: string // Traditional characters, Taiwan usage (primary display)
  simp: string // Simplified characters
  pinyin: string // tone marks, syllables separated by spaces: "nǐ hǎo"
  pinyinNumbered: string // "ni3 hao3"; neutral tone = 5
  tones: Tone[] // one per syllable, citation tones
  spokenAs?: string // tone-marked pinyin as actually spoken when sandhi applies, e.g. "ní hǎo"
  gloss: string // short English meaning shown on cards, e.g. "hello"
  hint?: string // disambiguator for the English->Chinese card, e.g. "a person" for 認識 "to know"
  pos: string // part of speech: noun, verb, adj, adv, pron, measure, particle, conj, prep, num, interj, phrase...
  note?: string // usage note; required for grammar/function words
  example: ExampleSentence
}

export interface AudioManifestEntry {
  word?: string // path relative to the site base, e.g. "audio/w/w4f60-597d.mp3"
  example?: string // e.g. "audio/s/w4f60-597d.mp3"
}

export interface AudioManifest {
  voiceId: string
  model: string
  generatedAt: string
  entries: Record<string, AudioManifestEntry> // keyed by Word.id
}
