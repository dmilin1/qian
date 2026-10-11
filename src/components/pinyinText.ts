// Pure pinyin helpers: split tone-marked pinyin into syllables and detect each syllable's tone.
// Works on words written without spaces ("péngyǒu", "Zhōngguó", "yìdiǎnr") as used in example
// sentences, using the standard pinyin spelling rules instead of a syllable inventory.
import type { Tone } from '../data/types'

/** Marked vowel -> [base vowel, tone]. Uppercase handled by lowercasing first. */
const MARKS: Record<string, [string, Tone]> = {}
const TABLE: [string, string][] = [
  ['a', 'āáǎà'],
  ['e', 'ēéěè'],
  ['i', 'īíǐì'],
  ['o', 'ōóǒò'],
  ['u', 'ūúǔù'],
  ['ü', 'ǖǘǚǜ'],
]
for (const [base, marked] of TABLE) {
  Array.from(marked).forEach((ch, i) => (MARKS[ch] = [base, (i + 1) as Tone]))
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'ü', 'v', 'ê'])

function analyse(ch: string): { base: string; tone: Tone | null } {
  const lower = ch.toLowerCase()
  const m = MARKS[lower]
  if (m) return { base: m[0], tone: m[1] }
  return { base: lower, tone: null }
}

/** A pinyin "letter" (including tone-marked vowels and ü). */
export function isPinyinLetter(ch: string): boolean {
  return /[a-zü]/i.test(ch) || MARKS[ch.toLowerCase()] !== undefined || ch === 'ê' || ch === 'Ê'
}

/** Tone of a single syllable from its tone mark; 5 (neutral) when it has none. */
export function toneOf(syllable: string): Tone {
  for (const ch of Array.from(syllable.normalize('NFC'))) {
    const t = analyse(ch).tone
    if (t) return t
  }
  return 5
}

/**
 * Split one run of pinyin letters (no spaces/punctuation) into syllables.
 * Rules: initial = zh/ch/sh or one consonant; nucleus = the vowel cluster (split before a second
 * tone-marked vowel, e.g. "xiǎoài"); coda = n / ng / r, where n (or the g of ng) starts the next
 * syllable when a vowel follows (standard spelling uses an apostrophe otherwise). A trailing r
 * after n/ng is erhua ("yìdiǎnr").
 */
export function splitSyllables(run: string): string[] {
  const chars = Array.from(run.normalize('NFC'))
  const info = chars.map(analyse)
  const n = chars.length
  const base = (i: number) => (i < n ? info[i].base : '')
  const vowel = (i: number) => i < n && VOWELS.has(info[i].base)
  const out: string[] = []
  let i = 0
  while (i < n) {
    const start = i
    // initial
    const two = base(i) + base(i + 1)
    if (two === 'zh' || two === 'ch' || two === 'sh') i += 2
    else if (!vowel(i)) i += 1
    if (!vowel(i)) {
      // No vowel follows (e.g. "hm", "ng", stray consonants): emit the consonants as one chunk.
      while (i < n && !vowel(i)) i++
      out.push(chars.slice(start, i).join(''))
      continue
    }
    // nucleus
    let marked = false
    while (vowel(i)) {
      if (info[i].tone) {
        if (marked) break
        marked = true
      }
      i++
    }
    // coda
    if (base(i) === 'n') {
      if (base(i + 1) === 'g') {
        i += vowel(i + 2) ? 1 : 2
      } else if (!vowel(i + 1)) {
        i += 1
      }
    }
    if (base(i) === 'r' && !vowel(i + 1)) i += 1
    out.push(chars.slice(start, i).join(''))
  }
  return out
}

export interface PinyinSegment {
  text: string
  /** Tone of a syllable, or null for separators (spaces, punctuation, apostrophes). */
  tone: Tone | null
}

/**
 * Split pinyin text (a word or a whole sentence) into syllable and separator segments.
 * If `tones` is given and matches the number of syllables, those tones are used (citation tones
 * from the word data); otherwise each syllable's tone comes from its tone mark.
 */
export function segmentPinyin(text: string, tones?: readonly Tone[]): PinyinSegment[] {
  const chars = Array.from(text.normalize('NFC'))
  const segs: PinyinSegment[] = []
  let run = ''
  let sep = ''
  const flushRun = () => {
    if (!run) return
    for (const s of splitSyllables(run)) segs.push({ text: s, tone: toneOf(s) })
    run = ''
  }
  const flushSep = () => {
    if (!sep) return
    segs.push({ text: sep, tone: null })
    sep = ''
  }
  for (const ch of chars) {
    if (isPinyinLetter(ch)) {
      flushSep()
      run += ch
    } else {
      flushRun()
      sep += ch
    }
  }
  flushRun()
  flushSep()
  if (tones && tones.length > 0) {
    const syllables = segs.filter((s) => s.tone !== null)
    if (syllables.length === tones.length) syllables.forEach((s, k) => (s.tone = tones[k]))
  }
  return segs
}
