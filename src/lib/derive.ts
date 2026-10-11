// Derived state = deterministic replay of the event log through FSRS.
//
// Every card's state depends only on the events of its own word, so the log is indexed by word.
// Appending an event that sorts after the word's last event is applied incrementally (O(1));
// anything else (out-of-order event, undo) replays just that one word. Import/settings changes
// rebuild everything with buildDerived().
import type { FSRS } from 'ts-fsrs'
import { applyGrade, getFsrs, newCard, State, type Card } from './fsrs'
import {
  cardKey,
  compareEvents,
  type AppEvent,
  type CardKey,
  type Dir,
  type FlagReason,
  type GradeName,
} from './events'

export interface CardState {
  readonly key: CardKey
  readonly wordId: string
  readonly dir: Dir
  readonly card: Card // ts-fsrs card (due, stability, difficulty, state, reps, lapses, last_review, ...)
  readonly introducedAt: number // ts of the first grading event
  readonly lastGrade: GradeName
}

export interface FlagRecord {
  readonly id: string
  readonly wordId: string
  readonly reason: FlagReason
  readonly note?: string
  readonly ts: number
  readonly resolved: boolean
  readonly resolvedAt?: number
}

export interface WordMeta {
  readonly suspended: boolean
  readonly flags: readonly FlagRecord[]
}

export interface Derived {
  readonly requestRetention: number
  /** Day-boundary shift passed to FSRS (see fsrs.defaultDayOffsetMs); 0 = UTC midnight. */
  readonly dayOffsetMs: number
  /** Only cards that have been graded at least once (introduced). Missing = New. */
  readonly cards: ReadonlyMap<CardKey, CardState>
  /** Only words that have suspend/flag events. */
  readonly words: ReadonlyMap<string, WordMeta>
  /** Events per word, sorted by (ts, id). */
  readonly eventsByWord: ReadonlyMap<string, readonly AppEvent[]>
  /** Total number of events. */
  readonly eventCount: number
}

const EMPTY_META: WordMeta = { suspended: false, flags: [] }

interface WordReplay {
  listen?: CardState
  say?: CardState
  meta: WordMeta
}

/** FSRS instance + day-boundary offset: everything a replay needs besides the events. */
interface Sched {
  f: FSRS
  off: number
}

const schedOf = (d: Pick<Derived, 'requestRetention' | 'dayOffsetMs'>): Sched => ({ f: getFsrs(d.requestRetention, d.dayOffsetMs), off: d.dayOffsetMs })

function gradeCard(s: Sched, prev: CardState | undefined, wordId: string, dir: Dir, grade: GradeName, ts: number): CardState {
  const card = applyGrade(s.f, prev ? prev.card : newCard(ts), grade, ts, s.off)
  return { key: cardKey(wordId, dir), wordId, dir, card, introducedAt: prev ? prev.introducedAt : ts, lastGrade: grade }
}

/** Pure single-step reducer for one word. */
function step(f: Sched, w: WordReplay, e: AppEvent): WordReplay {
  switch (e.kind) {
    case 'review':
      return { ...w, [e.dir]: gradeCard(f, w[e.dir], e.wordId, e.dir, e.grade, e.ts) }
    case 'known':
      return {
        ...w,
        listen: gradeCard(f, w.listen, e.wordId, 'listen', 'easy', e.ts),
        say: gradeCard(f, w.say, e.wordId, 'say', 'easy', e.ts),
      }
    case 'suspend':
      return { ...w, meta: { ...w.meta, suspended: e.suspended } }
    case 'flag': {
      if (e.resolved) {
        const flags = w.meta.flags.map((fl) =>
          !fl.resolved && fl.reason === e.reason ? { ...fl, resolved: true, resolvedAt: e.ts } : fl,
        )
        return { ...w, meta: { ...w.meta, flags } }
      }
      const rec: FlagRecord = { id: e.id, wordId: e.wordId, reason: e.reason, ts: e.ts, resolved: false, ...(e.note ? { note: e.note } : {}) }
      return { ...w, meta: { ...w.meta, flags: [...w.meta.flags, rec] } }
    }
  }
}

function replayWord(f: Sched, sorted: readonly AppEvent[]): WordReplay {
  let w: WordReplay = { meta: EMPTY_META }
  for (const e of sorted) w = step(f, w, e)
  return w
}

function currentWord(d: Derived, wordId: string): WordReplay {
  return {
    listen: d.cards.get(cardKey(wordId, 'listen')),
    say: d.cards.get(cardKey(wordId, 'say')),
    meta: d.words.get(wordId) ?? EMPTY_META,
  }
}

function writeWord(cards: Map<CardKey, CardState>, words: Map<string, WordMeta>, wordId: string, w: WordReplay) {
  for (const dir of ['listen', 'say'] as const) {
    const k = cardKey(wordId, dir)
    const c = w[dir]
    if (c) cards.set(k, c)
    else cards.delete(k)
  }
  if (w.meta.suspended || w.meta.flags.length) words.set(wordId, w.meta)
  else words.delete(wordId)
}

export function emptyDerived(requestRetention = 0.9, dayOffsetMs = 0): Derived {
  return { requestRetention, dayOffsetMs, cards: new Map(), words: new Map(), eventsByWord: new Map(), eventCount: 0 }
}

/** Full rebuild. Deterministic: the result depends only on the set of events (not their input order). */
export function buildDerived(events: readonly AppEvent[], requestRetention = 0.9, dayOffsetMs = 0): Derived {
  const f = schedOf({ requestRetention, dayOffsetMs })
  const byWord = new Map<string, AppEvent[]>()
  const seen = new Set<string>()
  for (const e of events) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    let list = byWord.get(e.wordId)
    if (!list) byWord.set(e.wordId, (list = []))
    list.push(e)
  }
  const cards = new Map<CardKey, CardState>()
  const words = new Map<string, WordMeta>()
  for (const [wordId, list] of byWord) {
    list.sort(compareEvents)
    writeWord(cards, words, wordId, replayWord(f, list))
  }
  return { requestRetention, dayOffsetMs, cards, words, eventsByWord: byWord, eventCount: seen.size }
}

/** Returns a new Derived with `e` applied (no-op if an event with the same id exists). */
export function withEvent(d: Derived, e: AppEvent): Derived {
  const f = schedOf(d)
  const prev = d.eventsByWord.get(e.wordId) ?? []
  if (prev.some((x) => x.id === e.id)) return d
  const last = prev[prev.length - 1]
  let list: AppEvent[]
  let w: WordReplay
  if (!last || compareEvents(last, e) < 0) {
    list = [...prev, e]
    w = step(f, currentWord(d, e.wordId), e)
  } else {
    list = [...prev, e].sort(compareEvents)
    w = replayWord(f, list)
  }
  return commit(d, e.wordId, list, w, d.eventCount + 1)
}

/** Returns a new Derived without the event with this id (replays its word). */
export function withoutEvent(d: Derived, e: Pick<AppEvent, 'id' | 'wordId'>): Derived {
  const prev = d.eventsByWord.get(e.wordId)
  if (!prev || !prev.some((x) => x.id === e.id)) return d
  const list = prev.filter((x) => x.id !== e.id)
  return commit(d, e.wordId, list, replayWord(schedOf(d), list), d.eventCount - 1)
}

function commit(d: Derived, wordId: string, list: AppEvent[], w: WordReplay, eventCount: number): Derived {
  const cards = new Map(d.cards)
  const words = new Map(d.words)
  const eventsByWord = new Map(d.eventsByWord)
  if (list.length) eventsByWord.set(wordId, list)
  else eventsByWord.delete(wordId)
  writeWord(cards, words, wordId, w)
  return { requestRetention: d.requestRetention, dayOffsetMs: d.dayOffsetMs, cards, words, eventsByWord, eventCount }
}

// ---------- queries ----------

export function getCard(d: Derived, wordId: string, dir: Dir): CardState | undefined {
  return d.cards.get(cardKey(wordId, dir))
}

export function isSuspended(d: Derived, wordId: string): boolean {
  return d.words.get(wordId)?.suspended ?? false
}

export function cardStateName(c: CardState | undefined): 'new' | 'learning' | 'review' | 'relearning' {
  if (!c) return 'new'
  switch (c.card.state) {
    case State.New:
      return 'new'
    case State.Learning:
      return 'learning'
    case State.Review:
      return 'review'
    case State.Relearning:
      return 'relearning'
  }
  return 'new'
}

export function openFlags(d: Derived): FlagRecord[] {
  const out: FlagRecord[] = []
  for (const m of d.words.values()) for (const fl of m.flags) if (!fl.resolved) out.push(fl)
  return out.sort((a, b) => a.ts - b.ts)
}

export function allFlags(d: Derived): FlagRecord[] {
  const out: FlagRecord[] = []
  for (const m of d.words.values()) out.push(...m.flags)
  return out.sort((a, b) => a.ts - b.ts)
}

/** All events, sorted by (ts, id). */
export function allEventsSorted(d: Derived): AppEvent[] {
  const out: AppEvent[] = []
  for (const list of d.eventsByWord.values()) out.push(...list)
  return out.sort(compareEvents)
}
