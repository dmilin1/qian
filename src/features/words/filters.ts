// Per-word status for the word list, list filters and the header summary. Pure functions over
// the derived state (src/lib/derive.ts) so they are easy to test.
import type { Word } from '../../data/types'
import { getCard, isSuspended, type Derived } from '../../lib/derive'
import { cardStatus, wordStatus, type CardStatus } from '../../lib/stats'

export interface WordInfo {
  listen: CardStatus
  say: CardStatus
  /** Combined status (see wordStatus in src/lib/stats.ts). */
  status: CardStatus
  suspended: boolean
  /** Number of open (unresolved) flags. */
  openFlags: number
  /** At least one card has been graded (or marked known). */
  introduced: boolean
}

export const UNSEEN_INFO: WordInfo = Object.freeze({
  listen: 'unseen',
  say: 'unseen',
  status: 'unseen',
  suspended: false,
  openFlags: 0,
  introduced: false,
}) as WordInfo

export function wordInfo(d: Derived, wordId: string): WordInfo {
  const meta = d.words.get(wordId)
  const listen = cardStatus(getCard(d, wordId, 'listen'))
  const say = cardStatus(getCard(d, wordId, 'say'))
  if (!meta && listen === 'unseen' && say === 'unseen') return UNSEEN_INFO
  return {
    listen,
    say,
    status: wordStatus(d, wordId),
    suspended: isSuspended(d, wordId),
    openFlags: meta ? meta.flags.filter((f) => !f.resolved).length : 0,
    introduced: listen !== 'unseen' || say !== 'unseen',
  }
}

/** Status of every word, keyed by id. */
export function wordInfoMap(d: Derived, words: readonly Word[]): Map<string, WordInfo> {
  const m = new Map<string, WordInfo>()
  for (const w of words) m.set(w.id, wordInfo(d, w.id))
  return m
}

export type WordFilter = 'all' | 'learning' | 'known' | 'unseen' | 'flagged' | 'suspended'

export const WORD_FILTERS: readonly { value: WordFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'learning', label: 'Learning' },
  { value: 'known', label: 'Known' },
  { value: 'unseen', label: 'Unseen' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'suspended', label: 'Suspended' },
]

export function isWordFilter(v: unknown): v is WordFilter {
  return WORD_FILTERS.some((f) => f.value === v)
}

/**
 * Filter predicate. Learning / known / unseen leave out suspended words (they have their own
 * filter, like in the progress stats). Known = introduced and not currently in (re)learning,
 * i.e. the word status young or mature. Flagged = at least one open flag (suspended or not).
 */
export function matchesFilter(info: WordInfo, f: WordFilter): boolean {
  switch (f) {
    case 'all':
      return true
    case 'learning':
      return !info.suspended && info.status === 'learning'
    case 'known':
      return !info.suspended && (info.status === 'young' || info.status === 'mature')
    case 'unseen':
      return !info.suspended && info.status === 'unseen'
    case 'flagged':
      return info.openFlags > 0
    case 'suspended':
      return info.suspended
  }
}

export function filterCounts(infos: Iterable<WordInfo>): Record<WordFilter, number> {
  const c: Record<WordFilter, number> = { all: 0, learning: 0, known: 0, unseen: 0, flagged: 0, suspended: 0 }
  for (const info of infos) for (const f of WORD_FILTERS) if (matchesFilter(info, f.value)) c[f.value]++
  return c
}

export interface ListSummary {
  total: number
  introduced: number
  learning: number
  young: number
  mature: number
}

/** Header numbers: introduced counts suspended words too if they were ever graded. */
export function listSummary(infos: Iterable<WordInfo>): ListSummary {
  const s: ListSummary = { total: 0, introduced: 0, learning: 0, young: 0, mature: 0 }
  for (const i of infos) {
    s.total++
    if (i.introduced) s.introduced++
    if (i.suspended) continue
    if (i.status === 'learning') s.learning++
    else if (i.status === 'young') s.young++
    else if (i.status === 'mature') s.mature++
  }
  return s
}
