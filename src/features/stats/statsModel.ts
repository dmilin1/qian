// Pure view-model for the Stats page: everything the page shows, computed from the event log and
// derived card states. Built on top of src/lib/stats.ts (local calendar days, Monday weeks).
import type { Word } from '../../data/types'
import { getCard, isSuspended, openFlags, type Derived } from '../../lib/derive'
import { DIRS, type AppEvent, type Dir } from '../../lib/events'
import {
  accuracyByWeek,
  cardStatus,
  dailyReviewCounts,
  dayKey,
  forecast as forecastDays,
  progressCounts,
  startOfDay,
  streak as streakOf,
  timeStudiedMs,
  wordStatus,
  type ProgressCounts,
} from '../../lib/stats'
import type { WordIndex } from '../../lib/words'

export interface Ratio {
  correct: number
  total: number
}

export interface HeatCell {
  key: string // YYYY-MM-DD
  ts: number // local midnight
  count: number
  level: 0 | 1 | 2 | 3 | 4
  future: boolean
  today: boolean
}

export interface Heatmap {
  /** Columns = weeks (Monday first), each with 7 cells Mon..Sun. */
  weeks: HeatCell[][]
  /** Month labels: column index + short month name, at the first column containing the 1st. */
  months: { col: number; label: string }[]
  /** Upper bound of each level (inclusive), for the legend / tests. */
  thresholds: [number, number, number, number]
  total: number
  activeDays: number
  best: { key: string; ts: number; count: number } | null
}

export interface AccuracyPoint {
  key: string
  label: string
  /** Percent 0..100, or null when that direction had no reviews in the bucket. */
  listen: number | null
  say: number | null
  listenN: number
  sayN: number
  /** Correct (good/easy) counts behind the percentages. */
  listenC: number
  sayC: number
}

export interface AccuracySeries {
  granularity: 'day' | 'week'
  points: AccuracyPoint[]
}

export interface ForecastPoint {
  key: string
  label: string
  /** Long label for tooltips/tables, e.g. "Today" or "Tue, Mar 3". */
  long: string
  due: number
}

export interface HardWord {
  word: Word
  lapses: number
  misses: number
  reviews: number
}

export interface StatsModel {
  empty: boolean
  /** Reviews + "I already know this" events, all time. */
  totalGradings: number
  totalWords: number
  introduced: number
  /** Words whose cards have all left (re)learning: young + mature. */
  known: number
  mature: number
  suspended: number
  streak: { days: number; studiedToday: boolean }
  reviewsToday: number
  timeTodayMs: number
  timeTotalMs: number
  accuracy: Ratio
  accuracyByDir: Record<Dir, Ratio>
  progress: ProgressCounts
  /** Grading events per local day (all time). */
  daily: ReadonlyMap<string, number>
  accuracySeries: AccuracySeries
  forecast: ForecastPoint[]
  hardest: HardWord[]
  flags: { open: number; words: number }
}

export const HEATMAP_WEEKS = 26
export const FORECAST_DAYS = 14
export const HARDEST_LIMIT = 8
/** Below this many days of history the accuracy chart uses daily points instead of weeks. */
export const DAILY_ACCURACY_DAYS = 21

const DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const LONG_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'short' })
const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short' })

export function addDays(ts: number, n: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

/** Local midnight of the Monday of ts's week. */
export function mondayOf(ts: number): number {
  const d = startOfDay(ts)
  return addDays(d, -((new Date(d).getDay() + 6) % 7))
}

/** "YYYY-MM-DD" (local) -> local midnight ms. */
export function parseDayKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

export const formatShortDate = (ts: number) => DAY_FMT.format(ts)
export const formatLongDate = (ts: number) => LONG_FMT.format(ts)

export function percent(r: Ratio): number | null {
  return r.total > 0 ? Math.round((100 * r.correct) / r.total) : null
}

/** "0 min", "<1 min", "12 min", "1 h 5 min". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 min'
  if (ms < 60_000) return '<1 min'
  const totalMin = Math.round(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

// ---------- heatmap ----------

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[i]
}

/**
 * Color levels scale to this learner's own history: level 4 starts at the 90th percentile of
 * active days, so one marathon day doesn't wash every other day out to level 1.
 */
export function heatThresholds(counts: Iterable<number>): [number, number, number, number] {
  const nz = [...counts].filter((n) => n > 0).sort((a, b) => a - b)
  const top = Math.max(4, quantile(nz, 0.9))
  const t1 = Math.max(1, Math.round(top / 4))
  const t2 = Math.max(t1 + 1, Math.round(top / 2))
  const t3 = Math.max(t2 + 1, Math.round((3 * top) / 4))
  return [t1, t2, t3, Math.max(t3 + 1, top)]
}

export function heatLevel(n: number, t: readonly number[]): HeatCell['level'] {
  if (n <= 0) return 0
  if (n <= t[0]) return 1
  if (n <= t[1]) return 2
  if (n <= t[2]) return 3
  return 4
}

export function buildHeatmap(daily: ReadonlyMap<string, number>, now: number, weeks = HEATMAP_WEEKS): Heatmap {
  const todayTs = startOfDay(now)
  const todayKey = dayKey(now)
  const first = addDays(mondayOf(now), -7 * (weeks - 1))
  const inRange: number[] = []
  const cols: HeatCell[][] = []
  const months: Heatmap['months'] = []
  let total = 0
  let activeDays = 0
  let best: Heatmap['best'] = null
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const ts = addDays(first, w * 7 + d)
      const key = dayKey(ts)
      const future = ts > todayTs
      const count = future ? 0 : (daily.get(key) ?? 0)
      if (count > 0) {
        inRange.push(count)
        total += count
        activeDays++
        if (!best || count > best.count) best = { key, ts, count }
      }
      col.push({ key, ts, count, level: 0, future, today: key === todayKey })
      if (new Date(ts).getDate() === 1) months.push({ col: w, label: MONTH_FMT.format(ts) })
    }
    cols.push(col)
  }
  const thresholds = heatThresholds(inRange)
  for (const col of cols) for (const c of col) c.level = heatLevel(c.count, thresholds)
  // The first column gets a label too when no month starts within its first 3 columns.
  if (!months.length || months[0].col > 2) months.unshift({ col: 0, label: MONTH_FMT.format(cols[0][0].ts) })
  return { weeks: cols, months, thresholds, total, activeDays, best }
}

// ---------- accuracy ----------

const pct = (c: number, t: number) => (t > 0 ? Math.round((1000 * c) / t) / 10 : null)

export function buildAccuracySeries(events: readonly AppEvent[], now: number): AccuracySeries {
  let firstTs = Infinity
  for (const e of events) if (e.kind === 'review') firstTs = Math.min(firstTs, e.ts)
  if (firstTs === Infinity) return { granularity: 'day', points: [] }
  const today = startOfDay(now)

  if (startOfDay(firstTs) > addDays(today, -DAILY_ACCURACY_DAYS)) {
    const m = new Map<string, Record<Dir, Ratio>>()
    for (const e of events) {
      if (e.kind !== 'review') continue
      const k = dayKey(e.ts)
      let b = m.get(k)
      if (!b) m.set(k, (b = { listen: { correct: 0, total: 0 }, say: { correct: 0, total: 0 } }))
      b[e.dir].total++
      if (e.grade !== 'again') b[e.dir].correct++
    }
    const points: AccuracyPoint[] = []
    for (let ts = startOfDay(firstTs); ts <= today; ts = addDays(ts, 1)) {
      const k = dayKey(ts)
      const b = m.get(k)
      points.push({
        key: k,
        label: formatShortDate(ts),
        listen: b ? pct(b.listen.correct, b.listen.total) : null,
        say: b ? pct(b.say.correct, b.say.total) : null,
        listenN: b?.listen.total ?? 0,
        sayN: b?.say.total ?? 0,
        listenC: b?.listen.correct ?? 0,
        sayC: b?.say.correct ?? 0,
      })
    }
    return { granularity: 'day', points }
  }

  const buckets = new Map(accuracyByWeek(events).map((b) => [b.weekStart, b]))
  const start = Math.max(mondayOf(firstTs), addDays(mondayOf(now), -7 * (HEATMAP_WEEKS - 1)))
  const points: AccuracyPoint[] = []
  for (let ts = start; ts <= today; ts = addDays(ts, 7)) {
    const k = dayKey(ts)
    const b = buckets.get(k)
    points.push({
      key: k,
      label: formatShortDate(ts),
      listen: b ? pct(b.listen.correct, b.listen.total) : null,
      say: b ? pct(b.say.correct, b.say.total) : null,
      listenN: b?.listen.total ?? 0,
      sayN: b?.say.total ?? 0,
      listenC: b?.listen.correct ?? 0,
      sayC: b?.say.correct ?? 0,
    })
  }
  return { granularity: 'week', points }
}

// ---------- forecast ----------

export function buildForecast(d: Derived, now: number, days = FORECAST_DAYS): ForecastPoint[] {
  return forecastDays(d, now, days).map((f, i) => {
    const ts = parseDayKey(f.day)
    return {
      key: f.day,
      label: i === 0 ? 'Today' : WEEKDAY_FMT.format(ts),
      long: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatLongDate(ts),
      due: f.due,
    }
  })
}

// ---------- hardest words ----------

export function buildHardest(d: Derived, words: WordIndex, limit = HARDEST_LIMIT): HardWord[] {
  const out: HardWord[] = []
  for (const [wordId, evs] of d.eventsByWord) {
    const word = words.get(wordId)
    if (!word || isSuspended(d, wordId)) continue
    let misses = 0
    let reviews = 0
    for (const e of evs) {
      if (e.kind !== 'review') continue
      reviews++
      if (e.grade === 'again') misses++
    }
    const lapses = DIRS.reduce((n, dir) => n + (getCard(d, wordId, dir)?.card.lapses ?? 0), 0)
    if (lapses > 0 || misses > 0) out.push({ word, lapses, misses, reviews })
  }
  // Most lapses first (forgotten after being learned), then most "Again" presses overall, then the
  // higher share of misses, then frequency rank for a stable order.
  const missRate = (h: HardWord) => h.misses / Math.max(1, h.reviews)
  out.sort((a, b) => b.lapses - a.lapses || b.misses - a.misses || missRate(b) - missRate(a) || a.word.rank - b.word.rank)
  return out.slice(0, limit)
}

// ---------- everything ----------

export function buildStatsModel(input: { derived: Derived; events: readonly AppEvent[]; words: WordIndex; now: number }): StatsModel {
  const { derived: d, events, words, now } = input
  const order = words.order
  const progress = progressCounts(d, order)

  let introduced = 0
  let known = 0
  let mature = 0
  for (const id of order) {
    const seen = DIRS.some((dir) => cardStatus(getCard(d, id, dir)) !== 'unseen')
    if (!seen) continue
    introduced++
    if (isSuspended(d, id)) continue
    const s = wordStatus(d, id)
    if (s === 'young' || s === 'mature') known++
    if (s === 'mature') mature++
  }

  const daily = dailyReviewCounts(events)
  const accuracyByDir: Record<Dir, Ratio> = { listen: { correct: 0, total: 0 }, say: { correct: 0, total: 0 } }
  let gradings = 0
  for (const e of events) {
    if (e.kind === 'known') gradings++
    if (e.kind !== 'review') continue
    gradings++
    accuracyByDir[e.dir].total++
    if (e.grade !== 'again') accuracyByDir[e.dir].correct++
  }

  const open = openFlags(d).filter((f) => words.has(f.wordId))
  return {
    empty: gradings === 0,
    totalGradings: gradings,
    totalWords: order.length,
    introduced,
    known,
    mature,
    suspended: progress.words.suspended,
    streak: streakOf(daily, now),
    reviewsToday: daily.get(dayKey(now)) ?? 0,
    timeTodayMs: timeStudiedMs(events, startOfDay(now)),
    timeTotalMs: timeStudiedMs(events),
    accuracy: {
      correct: accuracyByDir.listen.correct + accuracyByDir.say.correct,
      total: accuracyByDir.listen.total + accuracyByDir.say.total,
    },
    accuracyByDir,
    progress,
    daily,
    accuracySeries: buildAccuracySeries(events, now),
    forecast: buildForecast(d, now),
    hardest: buildHardest(d, words),
    flags: { open: open.length, words: new Set(open.map((f) => f.wordId)).size },
  }
}
