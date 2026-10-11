// Word search: English (gloss/hint), characters (traditional or simplified), pinyin and rank.
//
// Pinyin matching is tone-insensitive unless the query gives tones: "nihao", "ni hao", "ni3hao3",
// "ni3 hao" and "nǐ hǎo" all find 你好, while "ni4" does not. Tones may be typed as numbers
// (0 or 5 = neutral) or as tone marks. A neutral tone on either side matches any tone, because many
// Taiwanese say the full tone ("xie4xie4" finds 謝謝 xiè xie, "peng2you5" finds 朋友 péng yǒu); such
// matches rank one tier below exact-tone ones. "v", "u:" or plain "u" all match ü. Matches must start
// at a syllable boundary ("hao" finds 你好, "ao" does not), so short queries stay useful.
import type { Tone, Word } from '../../data/types'
import { segmentPinyin, splitSyllables } from '../../components/pinyinText'

/**
 * 0 = exact, 1 = prefix / word start (for pinyin: ending on a whole syllable), 2 = pinyin prefix that
 * stops inside a syllable ("xian" vs 想 xiǎng), 3 = somewhere inside. Lower is better.
 */
export type MatchTier = 0 | 1 | 2 | 3

interface PinyinKey {
  /** Toneless letters with each syllable's tone digit after it, ü as "v": "ni3hao3". */
  key: string
  /** Offsets in `key` where a syllable starts. */
  starts: number[]
}

export interface SearchEntry {
  word: Word
  pinyin: PinyinKey[]
  english: string[]
  /** Gloss/hint split on ; and , with a leading "to " removed, for exact matches ("know"). */
  englishParts: string[]
  hanzi: string[]
}

// ---------- normalisation ----------

const MARKED: Record<string, [string, number]> = {}
for (const [base, marks] of [
  ['a', 'āáǎà'],
  ['e', 'ēéěè'],
  ['i', 'īíǐì'],
  ['o', 'ōóǒò'],
  ['u', 'ūúǔù'],
  ['v', 'ǖǘǚǜ'],
] as const) {
  Array.from(marks).forEach((ch, i) => (MARKED[ch] = [base, i + 1]))
}

/** Lowercase toneless pinyin letters; ü (any tone) becomes "v"; other characters are dropped. */
function baseLetters(s: string): string {
  let out = ''
  for (const ch of Array.from(s.normalize('NFC').toLowerCase())) {
    if (MARKED[ch]) out += MARKED[ch][0]
    else if (ch === 'ü') out += 'v'
    else if (ch === 'ê') out += 'e'
    else if (ch >= 'a' && ch <= 'z') out += ch
  }
  return out
}

function hasToneMark(s: string): boolean {
  for (const ch of Array.from(s.normalize('NFC').toLowerCase())) if (MARKED[ch]) return true
  return false
}

function toneFromMark(s: string): number | null {
  for (const ch of Array.from(s.normalize('NFC').toLowerCase())) if (MARKED[ch]) return MARKED[ch][1]
  return null
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2ffff}]/u

export function hasCjk(s: string): boolean {
  return CJK.test(s)
}

/** Build the pinyin key of tone-marked text (a word's pinyin or spokenAs). */
export function pinyinKey(text: string, tones?: readonly Tone[]): PinyinKey {
  const segs = segmentPinyin(text, tones)
  let key = ''
  const starts: number[] = []
  for (const s of segs) {
    if (s.tone === null) continue
    const letters = baseLetters(s.text)
    if (!letters) continue
    starts.push(key.length)
    key += letters + String(s.tone)
  }
  return { key, starts }
}

/**
 * Normalise a pinyin query to letters + optional tone digits, e.g. "Nǐ hǎo" -> "ni3hao3",
 * "ni3 hao" -> "ni3hao", "lu:4" -> "lv4", "de0" -> "de5". Returns null when the query is not
 * pinyin-like (contains characters other than latin letters, tone marks, digits and separators).
 */
export function normalizePinyinQuery(query: string): string | null {
  const q = query.normalize('NFC').toLowerCase().replace(/u:/g, 'v').trim()
  if (!q) return null
  if (hasCjk(q)) return null
  let out = ''
  // Runs of letters (incl. marked vowels) and digits, separated by anything else.
  const runs = q.split(/[\s'’\-_.,;/]+/)
  for (const run of runs) {
    if (!run) continue
    // Split the run into letter chunks and digits.
    const parts = run.match(/[0-9]+|[^0-9]+/g) ?? []
    for (const part of parts) {
      if (/^[0-9]+$/.test(part)) {
        for (const d of part) {
          if (d === '0' || d === '5') out += '5'
          else if (d >= '1' && d <= '4') out += d
          else return null
        }
        continue
      }
      if (!/^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüêv]+$/.test(part)) return null
      if (hasToneMark(part)) {
        // Move each syllable's tone mark to a digit after the syllable.
        for (const syl of splitSyllables(part)) {
          const t = toneFromMark(syl)
          out += baseLetters(syl) + (t ? String(t) : '')
        }
      } else {
        out += baseLetters(part)
      }
    }
  }
  return out || null
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'

/**
 * Match a normalised pinyin query against a key. Query letters must match consecutive key letters
 * (key tone digits that the query leaves out are skipped); a query digit must equal the key's tone
 * digit at that point, except that a neutral tone (5) on either side matches any tone (one tier
 * lower). Tones 1-4 never match each other. "u" in the query also matches ü ("v").
 */
export function matchPinyinKey(q: string, pk: PinyinKey): MatchTier | null {
  let best: MatchTier | null = null
  for (const start of pk.starts) {
    let j = start
    let ok = true
    let lenient = false
    for (let i = 0; i < q.length && ok; i++) {
      const c = q[i]
      if (isDigit(c)) {
        const k = pk.key[j]
        if (k === c) j++
        else if (isDigit(k) && (k === '5' || c === '5')) {
          lenient = true
          j++
        } else ok = false
      } else {
        while (isDigit(pk.key[j])) j++
        const k = pk.key[j]
        if (k === c || (c === 'u' && k === 'v')) j++
        else ok = false
      }
    }
    if (!ok) continue
    const restHasLetters = /[a-z]/.test(pk.key.slice(j))
    // Whole syllable: the query stopped at the end, before a tone digit, or right after one.
    const atBoundary = j >= pk.key.length || isDigit(pk.key[j]) || isDigit(pk.key[j - 1])
    const base: MatchTier = start === 0 ? (!restHasLetters ? 0 : atBoundary ? 1 : 2) : 3
    const tier = (lenient ? Math.min(3, base + 1) : base) as MatchTier
    if (best === null || tier < best) best = tier
    if (best === 0) break
  }
  return best
}

// ---------- index ----------

function englishParts(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[;,/]/)
    .map((p) =>
      p
        .replace(/\(.*?\)/g, '')
        .trim()
        .replace(/^to\s+/, '')
        .trim(),
    )
    .filter(Boolean)
}

export function buildEntry(word: Word): SearchEntry {
  const pinyin = [pinyinKey(word.pinyin, word.tones)]
  if (word.spokenAs) pinyin.push(pinyinKey(word.spokenAs))
  const english = [word.gloss, word.hint].filter((s): s is string => !!s).map((s) => s.toLowerCase())
  return {
    word,
    pinyin,
    english,
    englishParts: english.flatMap(englishParts),
    hanzi: [...new Set([word.trad, word.simp].filter(Boolean))],
  }
}

const cache = new WeakMap<readonly Word[], SearchEntry[]>()

/** Search entries for a word list (cached per list instance). */
export function buildSearchIndex(words: readonly Word[]): SearchEntry[] {
  let idx = cache.get(words)
  if (!idx) {
    idx = words.map(buildEntry)
    cache.set(words, idx)
  }
  return idx
}

// ---------- matching ----------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface PreparedQuery {
  raw: string
  lower: string
  pinyin: string | null
  hanzi: string | null
  english: string | null
  englishWordStart: RegExp | null
  rank: number | null
}

export function prepareQuery(query: string): PreparedQuery | null {
  const raw = query.normalize('NFC').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  const cjk = hasCjk(raw)
  const english = !cjk && /[a-z]/.test(lower) ? lower.replace(/\s+/g, ' ') : null
  const rankMatch = /^#?\s*(\d{1,5})$/.exec(raw)
  return {
    raw,
    lower,
    pinyin: cjk ? null : normalizePinyinQuery(raw),
    hanzi: cjk ? raw.replace(/\s+/g, '') : null,
    english,
    englishWordStart: english ? new RegExp(`(^|[^a-z])${escapeRe(english)}`) : null,
    rank: rankMatch ? Number(rankMatch[1]) : null,
  }
}

/** Best match tier of one entry, or null when it does not match. */
export function matchEntry(e: SearchEntry, q: PreparedQuery): MatchTier | null {
  let best: MatchTier | null = null
  const take = (t: MatchTier | null) => {
    if (t !== null && (best === null || t < best)) best = t
  }
  if (q.rank !== null && e.word.rank === q.rank) return 0
  if (q.hanzi) {
    for (const h of e.hanzi) {
      if (h === q.hanzi) take(0)
      else if (h.startsWith(q.hanzi)) take(1)
      else if (h.includes(q.hanzi)) take(3)
    }
  }
  if (q.pinyin) {
    for (const pk of e.pinyin) take(matchPinyinKey(q.pinyin, pk))
  }
  if (q.english && best !== 0) {
    if (e.englishParts.includes(q.english)) take(0)
    else if (q.englishWordStart && e.english.some((s) => q.englishWordStart!.test(s))) take(1)
    // Plain substring only for 3+ letters; "a" or "to" would otherwise match nearly everything.
    else if (q.english.length >= 3 && e.english.some((s) => s.includes(q.english!))) take(3)
  }
  return best
}

/**
 * Words matching `query`, best matches first (exact, then prefix/word-start, then partial-syllable
 * prefix, then inside), ties in frequency-rank order. An empty query returns every entry in rank order.
 */
export function searchWords(index: readonly SearchEntry[], query: string): Word[] {
  const q = prepareQuery(query)
  if (!q) return index.map((e) => e.word)
  const hits: { word: Word; tier: MatchTier }[] = []
  for (const e of index) {
    const tier = matchEntry(e, q)
    if (tier !== null) hits.push({ word: e.word, tier })
  }
  hits.sort((a, b) => a.tier - b.tier || a.word.rank - b.word.rank)
  return hits.map((h) => h.word)
}
