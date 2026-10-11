// Pinyin for the Chinese in word notes. The notes in words.json often quote characters without pinyin
// ("Negated with 沒 (沒有 'don't have'), never 不有"), which a learner who doesn't read cannot use. This
// annotates each run of characters with pinyin looked up in the word list, at render time.
import type { Word } from '../data/types'

export type NoteSegment =
  | { kind: 'text'; text: string }
  /**
   * A run of characters. `pinyin` is set when it was annotated here; null when it already has pinyin next to it or
   * could not be looked up. `followedByPinyin` is true when the note itself already gives its pinyin right after it.
   */
  | { kind: 'han'; text: string; pinyin: string | null; followedByPinyin: boolean }

export interface NoteDictionary {
  /** Traditional characters -> tone-marked pinyin (syllables separated by spaces). */
  readonly pinyin: ReadonlyMap<string, string>
  /** Longest headword, in characters. */
  readonly maxLen: number
}

/** Build the lookup from the word list. The first (most frequent) reading wins for words listed twice. */
export function buildNoteDictionary(words: readonly Pick<Word, 'trad' | 'pinyin' | 'rank'>[]): NoteDictionary {
  const pinyin = new Map<string, string>()
  let maxLen = 1
  for (const w of [...words].sort((a, b) => a.rank - b.rank)) {
    if (!pinyin.has(w.trad)) pinyin.set(w.trad, w.pinyin)
    maxLen = Math.max(maxLen, [...w.trad].length)
  }
  return { pinyin, maxLen }
}

const HAN_RUN = /\p{Script=Han}+/gu
const TONE_MARK = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i
const LATIN = 'A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜ'
/** First Latin word after a run, allowing a space and/or an opening parenthesis: "沒有 méi yǒu", "沒 (méi)". */
const WORD_AFTER = new RegExp(`^\\s*\\(?\\s*([${LATIN}]+)`)
/** A tone-marked word, then "(" right before the run: "hè (附和)". */
const PINYIN_BEFORE_PAREN = new RegExp(`([${LATIN}]+)\\s*\\(\\s*$`)

const toneless = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Greedy longest match against the word list. Null when any character is not covered (no partial guesses). */
export function lookupPinyin(run: string, dict: NoteDictionary): string | null {
  const chars = [...run]
  const out: string[] = []
  let i = 0
  while (i < chars.length) {
    let found: string | undefined
    for (let len = Math.min(dict.maxLen, chars.length - i); len >= 1 && !found; len--) {
      found = dict.pinyin.get(chars.slice(i, i + len).join(''))
      if (found) i += len
    }
    if (!found) return null
    out.push(found)
  }
  return out.join(' ')
}

/**
 * Split a note into text and character runs, adding pinyin to runs that have none. A run is left as written
 * when pinyin already follows it ("會計 kuài jì", also a neutral-tone "了 le"), or when it is the whole content of
 * parentheses right after a reading ("hè (附和)"), because the word list's reading could be the wrong one there.
 */
export function annotateNote(note: string, dict: NoteDictionary): NoteSegment[] {
  const out: NoteSegment[] = []
  let last = 0
  for (const m of note.matchAll(HAN_RUN)) {
    const start = m.index ?? 0
    const run = m[0]
    if (start > last) out.push({ kind: 'text', text: note.slice(last, start) })
    last = start + run.length
    const before = note.slice(0, start)
    const after = note.slice(last)
    const pinyin = lookupPinyin(run, dict)
    const next = WORD_AFTER.exec(after)?.[1]
    const hasPinyinAfter =
      !!next && (TONE_MARK.test(next) || (pinyin !== null && toneless(next) === toneless(pinyin.split(' ')[0])))
    const prev = PINYIN_BEFORE_PAREN.exec(before)?.[1]
    const readingBefore = !!prev && TONE_MARK.test(prev) && /^\s*\)/.test(after)
    out.push({
      kind: 'han',
      text: run,
      pinyin: hasPinyinAfter || readingBefore ? null : pinyin,
      followedByPinyin: hasPinyinAfter,
    })
  }
  if (last < note.length) out.push({ kind: 'text', text: note.slice(last) })
  return out
}
