import { describe, expect, it } from 'vitest'
import { buildDerived, getCard } from '../../lib/derive'
import { makeFlag, makeKnown, makeReview, makeSuspend, type AppEvent } from '../../lib/events'
import { makeWords } from '../../lib/__fixtures__/words'
import {
  filterCounts,
  isWordSort,
  listSummary,
  matchesFilter,
  sortWords,
  wordInfo,
  wordInfoMap,
  wordSortKeys,
  type WordFilter,
  type WordSort,
} from './filters'

const DAY = 86_400_000
const T0 = Date.UTC(2026, 0, 1, 9)
const dev = 'dev-1'
const words = makeWords(8) // ids wt1..wt8

/** Easy reviews on both cards, each at its due time, until both are mature (S >= 21 d). */
function matureEvents(wordId: string): AppEvent[] {
  const evs: AppEvent[] = [makeKnown({ wordId, ts: T0, deviceId: dev })]
  for (let i = 0; i < 10; i++) {
    const d = buildDerived(evs)
    const l = getCard(d, wordId, 'listen')!
    const s = getCard(d, wordId, 'say')!
    if (l.card.stability >= 21 && s.card.stability >= 21) break
    const ts = Math.max(l.card.due.getTime(), s.card.due.getTime())
    evs.push(makeReview({ wordId, dir: 'listen', grade: 'easy', ts, deviceId: dev }))
    evs.push(makeReview({ wordId, dir: 'say', grade: 'easy', ts: ts + 1000, deviceId: dev }))
  }
  return evs
}

const events: AppEvent[] = [
  // wt1: never seen
  // wt2: listen card in learning
  makeReview({ wordId: 'wt2', dir: 'listen', grade: 'good', ts: T0, deviceId: dev }),
  // wt3: "I already know this" -> both cards in review (young)
  makeKnown({ wordId: 'wt3', ts: T0, deviceId: dev }),
  // wt4: known, then suspended
  makeKnown({ wordId: 'wt4', ts: T0, deviceId: dev }),
  makeSuspend({ wordId: 'wt4', suspended: true, ts: T0 + 1, deviceId: dev }),
  // wt5: unseen with an open flag
  makeFlag({ wordId: 'wt5', reason: 'audio', ts: T0, deviceId: dev }),
  // wt6: unseen, flag resolved
  makeFlag({ wordId: 'wt6', reason: 'pinyin', ts: T0, deviceId: dev }),
  makeFlag({ wordId: 'wt6', reason: 'pinyin', resolved: true, ts: T0 + 1, deviceId: dev }),
  // wt7: mature
  ...matureEvents('wt7'),
  // wt8: suspended before it was introduced, and flagged
  makeSuspend({ wordId: 'wt8', suspended: true, ts: T0, deviceId: dev }),
  makeFlag({ wordId: 'wt8', reason: 'meaning', ts: T0 + 1, deviceId: dev }),
  makeFlag({ wordId: 'wt8', reason: 'other', note: 'x', ts: T0 + 2, deviceId: dev }),
]
const derived = buildDerived(events)
const infos = wordInfoMap(derived, words)

const pick = (f: WordFilter) => words.filter((w) => matchesFilter(infos.get(w.id)!, f)).map((w) => w.id)

describe('wordInfo', () => {
  it('derives per-direction status, suspension and open flags', () => {
    expect(wordInfo(derived, 'wt1')).toMatchObject({ listen: 'unseen', say: 'unseen', status: 'unseen', introduced: false, openFlags: 0 })
    expect(wordInfo(derived, 'wt2')).toMatchObject({ listen: 'learning', say: 'unseen', status: 'learning', introduced: true })
    expect(wordInfo(derived, 'wt3')).toMatchObject({ listen: 'young', say: 'young', status: 'young' })
    expect(wordInfo(derived, 'wt4')).toMatchObject({ status: 'young', suspended: true, introduced: true })
    expect(wordInfo(derived, 'wt5')).toMatchObject({ status: 'unseen', openFlags: 1 })
    expect(wordInfo(derived, 'wt6')).toMatchObject({ status: 'unseen', openFlags: 0 })
    expect(wordInfo(derived, 'wt7')).toMatchObject({ listen: 'mature', say: 'mature', status: 'mature' })
    expect(wordInfo(derived, 'wt8')).toMatchObject({ suspended: true, openFlags: 2, introduced: false })
  })

  it('treats unknown words as unseen', () => {
    expect(wordInfo(derived, 'nope')).toMatchObject({ status: 'unseen', suspended: false, openFlags: 0 })
  })
})

describe('filters', () => {
  it('all', () => expect(pick('all')).toEqual(words.map((w) => w.id)))
  it('learning', () => expect(pick('learning')).toEqual(['wt2']))
  it('known = young or mature, not suspended', () => expect(pick('known')).toEqual(['wt3', 'wt7']))
  it('unseen excludes suspended words', () => expect(pick('unseen')).toEqual(['wt1', 'wt5', 'wt6']))
  it('flagged = open flags only, suspended or not', () => expect(pick('flagged')).toEqual(['wt5', 'wt8']))
  it('suspended', () => expect(pick('suspended')).toEqual(['wt4', 'wt8']))

  it('counts every filter', () => {
    expect(filterCounts(infos.values())).toEqual({ all: 8, learning: 1, known: 2, unseen: 3, flagged: 2, suspended: 2 })
  })

  it('summarises the list: introduced includes suspended words that were graded', () => {
    expect(listSummary(infos.values())).toEqual({ total: 8, introduced: 4, learning: 1, young: 1, mature: 1 })
  })

  it('sorts by due, weakest recall, lapses and recency; unseen words last, rank breaks ties', () => {
    const later = T0 + 30 * DAY
    const d = buildDerived([
      makeReview({ wordId: 'wt2', dir: 'listen', grade: 'good', ts: T0, deviceId: dev }), // learning, due in 10 min
      makeKnown({ wordId: 'wt3', ts: T0, deviceId: dev }),
      makeKnown({ wordId: 'wt4', ts: T0, deviceId: dev }),
      makeKnown({ wordId: 'wt5', ts: T0, deviceId: dev }),
      makeReview({ wordId: 'wt5', dir: 'listen', grade: 'again', ts: T0 + 20 * DAY, deviceId: dev }), // a lapse
    ])
    const keys = (id: string) => wordSortKeys(d, id, later)
    const ids = (s: WordSort) => sortWords(words, s, keys).map((w) => w.id)
    const unseen = ['wt1', 'wt6', 'wt7', 'wt8']
    expect(sortWords(words, 'rank', keys)).toBe(words)
    expect(keys('wt1')).toBeNull()
    for (const s of ['due', 'weakest', 'lapses', 'recent'] as const) {
      const out = ids(s)
      expect(out).toHaveLength(words.length)
      expect(out.slice(-4)).toEqual(unseen) // rank order among the unseen
    }
    expect(ids('due')[0]).toBe('wt2')
    const dues = ids('due').slice(0, 4).map((id) => keys(id)!.due!)
    expect(dues).toEqual([...dues].sort((a, b) => a - b))
    const recalls = ids('weakest').slice(0, 4).map((id) => keys(id)!.recall)
    expect(recalls).toEqual([...recalls].sort((a, b) => a - b))
    expect(ids('lapses').slice(0, 4)).toEqual(['wt5', 'wt2', 'wt3', 'wt4']) // ties keep rank order
    expect(ids('recent')[0]).toBe('wt5')
  })

  it('isWordSort guards the ?s= param', () => {
    expect(isWordSort('due')).toBe(true)
    expect(isWordSort('nope')).toBe(false)
    expect(isWordSort(null)).toBe(false)
  })

  it('updates when a suspended word is unsuspended', () => {
    const d2 = buildDerived([...events, makeSuspend({ wordId: 'wt4', suspended: false, ts: T0 + 10 * DAY, deviceId: dev })])
    const i2 = wordInfoMap(d2, words)
    expect(words.filter((w) => matchesFilter(i2.get(w.id)!, 'known')).map((w) => w.id)).toEqual(['wt3', 'wt4', 'wt7'])
  })
})
