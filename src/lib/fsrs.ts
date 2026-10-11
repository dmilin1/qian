// Thin wrapper around ts-fsrs (FSRS-6). All scheduling math goes through here.
import { createEmptyCard, fsrs, Rating, State, StrategyMode, type Card, type FSRS, type Grade } from 'ts-fsrs'
import type { GradeName } from './events'

export { State }
export type { Card }

export const DAY_MS = 86_400_000
/** Local hour at which a new FSRS "day" starts (Anki-style: nobody studies at 4am). */
export const DAY_ROLLOVER_HOUR = 4

const cache = new Map<string, FSRS>()

/**
 * FSRS instance for a target retention. Default FSRS-6 weights, short-term learning steps
 * (1m, 10m; relearning 10m) and interval fuzz.
 *
 * Fuzz seed: ts-fsrs's default seeds from the review millisecond, so the interval shown on a button
 * (previewed when the card appears) and the one scheduled seconds later at grading differ at random.
 * We seed from (previous review time, reps, difficulty * stability) instead: identical at preview and
 * grading, still different between cards (their previous reviews happened at different moments), and
 * deterministic under replay.
 *
 * `dayOffsetMs` must be the offset later passed to applyGrade with this instance: the seed adds it back, so
 * fuzz depends only on real times and the offset only moves the day boundary.
 */
export function getFsrs(requestRetention: number, dayOffsetMs = 0): FSRS {
  const key = `${requestRetention}:${dayOffsetMs}`
  let f = cache.get(key)
  if (!f) {
    f = fsrs({ request_retention: requestRetention, enable_fuzz: true, enable_short_term: true }).useStrategy(
      StrategyMode.SEED,
      function () {
        // `last` = the card as passed in, `current` = after init (reps already incremented); both protected.
        const { last, current } = this as unknown as { last: Card; current: Card }
        const prev = last.last_review ? new Date(last.last_review).getTime() + dayOffsetMs : 0
        return `${prev}_${current.reps}_${current.difficulty * current.stability}`
      },
    )
    cache.set(key, f)
  }
  return f
}

export const GRADE_TO_RATING: Record<GradeName, Grade> = {
  again: Rating.Again,
  good: Rating.Good,
  easy: Rating.Easy,
}

export function newCard(ts = 0): Card {
  return createEmptyCard(new Date(ts))
}

/**
 * Constant shift that moves ts-fsrs's day boundary to DAY_ROLLOVER_HOUR local time.
 *
 * ts-fsrs counts elapsed days by UTC calendar date, so its day starts at 08:00 in Taiwan and 16:00/17:00
 * on the US west coast; a 10-minute learning step across that moment counts as a whole day and inflates
 * stability ~3x. Shifting every time by `-offset` before calling ts-fsrs (and back afterwards) puts the
 * boundary at local 4am. Capture this once per device and keep it, so replay stays deterministic.
 */
export function defaultDayOffsetMs(date = new Date()): number {
  // getTimezoneOffset() is (UTC - local) in minutes; local 4am is UTC (4h - tz).
  return (DAY_ROLLOVER_HOUR * 60 + date.getTimezoneOffset()) * 60_000
}

const shiftDate = (d: Date | undefined, ms: number) => (d ? new Date(d.getTime() + ms) : d)
const shiftCard = (c: Card, ms: number): Card =>
  ms ? { ...c, due: shiftDate(c.due, ms)!, last_review: shiftDate(c.last_review, ms) } : c

/**
 * Apply a grade at time `ts`. Pure: returns a new card. `dayOffsetMs` moves the day boundary (see defaultDayOffsetMs);
 * `f` should come from getFsrs(retention, dayOffsetMs).
 */
export function applyGrade(f: FSRS, card: Card, grade: GradeName, ts: number, dayOffsetMs = 0): Card {
  const next = f.next(shiftCard(card, -dayOffsetMs), new Date(ts - dayOffsetMs), GRADE_TO_RATING[grade]).card
  return shiftCard(next, dayOffsetMs)
}

/**
 * Retrievability at `now`, using fractional elapsed days (smoother than ts-fsrs's
 * whole-day get_retrievability, which matters for weighting cards reviewed today).
 * New cards return 0.
 */
export function retrievability(f: FSRS, card: Card, now: number): number {
  if (card.state === State.New || !card.last_review) return 0
  const t = Math.max(0, (now - card.last_review.getTime()) / DAY_MS)
  return f.forgetting_curve(t, card.stability)
}

export function isLearningState(s: State): boolean {
  return s === State.Learning || s === State.Relearning
}
