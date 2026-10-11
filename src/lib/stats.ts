// Pure statistics over the event log and derived card states. Days are LOCAL calendar days.
import { isLearningState, State } from './fsrs'
import { getCard, isSuspended, type CardState, type Derived } from './derive'
import { DIRS, type AppEvent, type Dir, type GradingEvent } from './events'

export type CardStatus = 'unseen' | 'learning' | 'young' | 'mature'
export const MATURE_DAYS = 21
/** Per-review cap when summing time studied (someone walked away from the screen). */
export const MAX_REVIEW_MS = 60_000

export function cardStatus(c: CardState | undefined): CardStatus {
  if (!c || c.card.state === State.New) return 'unseen'
  if (isLearningState(c.card.state)) return 'learning'
  return c.card.stability >= MATURE_DAYS ? 'mature' : 'young'
}

/**
 * Word status: unseen if no card introduced; learning if any card is (re)learning;
 * mature if both cards are mature; otherwise young.
 */
export function wordStatus(d: Derived, wordId: string): CardStatus {
  const l = cardStatus(getCard(d, wordId, 'listen'))
  const s = cardStatus(getCard(d, wordId, 'say'))
  if (l === 'unseen' && s === 'unseen') return 'unseen'
  if (l === 'learning' || s === 'learning') return 'learning'
  if (l === 'mature' && s === 'mature') return 'mature'
  return 'young'
}

export type StatusCounts = Record<CardStatus, number> & { suspended: number }

const zeroCounts = (): StatusCounts => ({ unseen: 0, learning: 0, young: 0, mature: 0, suspended: 0 })

export interface ProgressCounts {
  listen: StatusCounts
  say: StatusCounts
  words: StatusCounts
}

/** Status counts over the given word list. Suspended words are counted only under `suspended`. */
export function progressCounts(d: Derived, wordIds: readonly string[]): ProgressCounts {
  const out: ProgressCounts = { listen: zeroCounts(), say: zeroCounts(), words: zeroCounts() }
  for (const id of wordIds) {
    if (isSuspended(d, id)) {
      out.listen.suspended++
      out.say.suspended++
      out.words.suspended++
      continue
    }
    for (const dir of DIRS) out[dir][cardStatus(getCard(d, id, dir))]++
    out.words[wordStatus(d, id)]++
  }
  return out
}

// ---------- days ----------

/** Local calendar day key "YYYY-MM-DD". */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function addDays(ts: number, n: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

const isGrading = (e: AppEvent): e is GradingEvent => e.kind === 'review' || e.kind === 'known'

/** Grading events (reviews + "I already know this") per local day, for a heatmap. */
export function dailyReviewCounts(events: readonly AppEvent[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of events) if (isGrading(e)) m.set(dayKey(e.ts), (m.get(dayKey(e.ts)) ?? 0) + 1)
  return m
}

/** Consecutive days with >= 1 review, ending today if studied today, else ending yesterday. */
export function streak(daily: ReadonlyMap<string, number>, now: number): { days: number; studiedToday: boolean } {
  const studiedToday = (daily.get(dayKey(now)) ?? 0) > 0
  let day = studiedToday ? startOfDay(now) : addDays(startOfDay(now), -1)
  let days = 0
  while ((daily.get(dayKey(day)) ?? 0) > 0) {
    days++
    day = addDays(day, -1)
  }
  return { days, studiedToday }
}

// ---------- accuracy ----------

export interface AccuracyBucket {
  weekStart: string // local day key of the Monday starting the week
  listen: { total: number; correct: number }
  say: { total: number; correct: number }
}

export function weekStartKey(ts: number): string {
  const d = new Date(startOfDay(ts))
  const dow = (d.getDay() + 6) % 7 // Monday = 0
  return dayKey(addDays(d.getTime(), -dow))
}

/** Weekly accuracy per direction: correct = good/easy, wrong = again. "known" events are not reviews. */
export function accuracyByWeek(events: readonly AppEvent[]): AccuracyBucket[] {
  const m = new Map<string, AccuracyBucket>()
  for (const e of events) {
    if (e.kind !== 'review') continue
    const k = weekStartKey(e.ts)
    let b = m.get(k)
    if (!b) m.set(k, (b = { weekStart: k, listen: { total: 0, correct: 0 }, say: { total: 0, correct: 0 } }))
    b[e.dir].total++
    if (e.grade !== 'again') b[e.dir].correct++
  }
  return [...m.values()].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
}

// ---------- time ----------

/** Total study time in ms (elapsedMs per review, each capped at 60 s). */
export function timeStudiedMs(events: readonly AppEvent[], since = -Infinity): number {
  let t = 0
  for (const e of events) {
    if (e.kind === 'review' && e.ts >= since && e.elapsedMs) t += Math.min(e.elapsedMs, MAX_REVIEW_MS)
  }
  return t
}

export function dailyTimeStudiedMs(events: readonly AppEvent[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of events) {
    if (e.kind !== 'review' || !e.elapsedMs) continue
    const k = dayKey(e.ts)
    m.set(k, (m.get(k) ?? 0) + Math.min(e.elapsedMs, MAX_REVIEW_MS))
  }
  return m
}

// ---------- forecast ----------

export interface ForecastDay {
  day: string
  /** Review cards (and learning cards) whose due time falls on this day. Day 0 includes overdue. */
  due: number
}

export function forecast(d: Derived, now: number, days = 14): ForecastDay[] {
  const start = startOfDay(now)
  const bounds: number[] = []
  const out: ForecastDay[] = []
  for (let i = 0; i < days; i++) {
    out.push({ day: dayKey(addDays(start, i)), due: 0 })
    bounds.push(addDays(start, i + 1))
  }
  for (const c of d.cards.values()) {
    if (c.card.state === State.New || isSuspended(d, c.wordId)) continue
    const due = c.card.due.getTime()
    if (due >= bounds[days - 1]) continue
    let i = 0
    while (due >= bounds[i]) i++
    out[i].due++
  }
  return out
}

// ---------- per-word ----------

export interface WordHistoryEntry {
  ts: number
  kind: AppEvent['kind']
  dir?: Dir
  grade?: string
  event: AppEvent
}

/** All events of one word in (ts, id) order. */
export function wordHistory(d: Derived, wordId: string): WordHistoryEntry[] {
  return (d.eventsByWord.get(wordId) ?? []).map((e) => ({
    ts: e.ts,
    kind: e.kind,
    dir: e.kind === 'review' ? e.dir : undefined,
    grade: e.kind === 'review' ? e.grade : e.kind === 'known' ? 'known' : undefined,
    event: e,
  }))
}

export interface WordSummary {
  wordId: string
  status: CardStatus
  suspended: boolean
  reviews: number
  lapses: number
  lastReviewTs: number | null
  listen?: CardState
  say?: CardState
}

export function wordSummary(d: Derived, wordId: string): WordSummary {
  const listen = getCard(d, wordId, 'listen')
  const say = getCard(d, wordId, 'say')
  const evs = d.eventsByWord.get(wordId) ?? []
  let reviews = 0
  let last: number | null = null
  for (const e of evs) {
    if (e.kind === 'review' || e.kind === 'known') {
      reviews++
      last = e.ts
    }
  }
  return {
    wordId,
    status: wordStatus(d, wordId),
    suspended: isSuspended(d, wordId),
    reviews,
    lapses: (listen?.card.lapses ?? 0) + (say?.card.lapses ?? 0),
    lastReviewTs: last,
    listen,
    say,
  }
}


