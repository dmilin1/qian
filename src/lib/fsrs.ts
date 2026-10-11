// Thin wrapper around ts-fsrs (FSRS-6). All scheduling math goes through here.
import { createEmptyCard, fsrs, Rating, State, type Card, type FSRS, type Grade } from 'ts-fsrs'
import type { GradeName } from './events'

export { State }
export type { Card }

export const DAY_MS = 86_400_000

const cache = new Map<number, FSRS>()

/**
 * FSRS instance for a target retention. Default FSRS-6 weights, short-term learning steps
 * (1m, 10m; relearning 10m) and interval fuzz. Fuzz in ts-fsrs is seeded from
 * (review time, reps, difficulty * stability), so replay stays deterministic.
 */
export function getFsrs(requestRetention: number): FSRS {
  let f = cache.get(requestRetention)
  if (!f) {
    f = fsrs({ request_retention: requestRetention, enable_fuzz: true, enable_short_term: true })
    cache.set(requestRetention, f)
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

/** Apply a grade at time `ts`. Pure: returns a new card. */
export function applyGrade(f: FSRS, card: Card, grade: GradeName, ts: number): Card {
  return f.next(card, new Date(ts), GRADE_TO_RATING[grade]).card
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
