// Next-card selection and new-word introduction. Pure functions over Derived state.
import { DAY_MS, getFsrs, GRADE_TO_RATING, isLearningState, newCard, retrievability, State, type Card } from './fsrs'
import { getCard, isSuspended, type CardState, type Derived } from './derive'
import { cardKey, parseCardKey, siblingKey, type CardKey, type Dir, type GradeName } from './events'

export type Rng = () => number

/** Small deterministic PRNG for tests and simulations. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SchedulerSettings {
  requestRetention: number // 0.9
  workingSetCap: number // 15 unstable words
  stableDays: number // 7
  backlogLimit: number // 10 due reviews
}

export const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
  requestRetention: 0.9,
  workingSetCap: 30,
  stableDays: 5,
  backlogLimit: 10,
}

export type PickSource =
  | 'learning' // learning/relearning card whose step is due
  | 'review' // due review card
  | 'new' // newly introduced card
  | 'learningEarly' // learning card shown before its step is due (nothing else available)
  | 'practice' // practice-ahead (caught up)

export interface Pick {
  key: CardKey
  wordId: string
  dir: Dir
  source: PickSource
  isNew: boolean
  /** True when this is the word's first appearance (listen card never seen): offer "I already know this". */
  canMarkKnown: boolean
  retrievability: number
}

export type GateBlock = 'workingSet' | 'backlog' | 'exhausted' | null

export interface QueueInfo {
  unstableWords: number
  dueReviews: number
  learningDue: number
  learningPending: number // learning cards not yet due
  introducedWords: number
  /** Whether a new card could be introduced right now. */
  gateOpen: boolean
  /** Why no new card is available (null when one is). */
  gateBlockedBy: GateBlock
  /** Earliest future due time among learning cards (ms), for a "next card in…" timer. */
  nextLearningDueAt: number | null
  /** Earliest future due time among review cards (ms). */
  nextReviewDueAt: number | null
}

export interface Selection {
  pick: Pick | null
  info: QueueInfo
}

export interface SelectInput {
  derived: Derived
  /** Word ids in rank order (most frequent first). */
  wordOrder: readonly string[]
  settings: SchedulerSettings
  now: number
  /** Recently shown card keys, oldest first (most recent last). */
  recent?: readonly CardKey[]
  rng: Rng
  /** When caught up, keep going with practice-ahead reviews. */
  practiceAhead?: boolean
  /** Probability of picking a new card when both due reviews and new cards are available. */
  newRatio?: number
  /** Ignore cards of words for which this returns false (e.g. ids no longer in the word list). */
  includeWord?: (wordId: string) => boolean
}

// ---------- stability / gate ----------

export function isUnstableCard(c: CardState, stableDays: number): boolean {
  return isLearningState(c.card.state) || c.card.stability < stableDays
}

/** Words with any introduced, non-suspended card in (re)learning or with stability < stableDays. */
export function unstableWordCount(d: Derived, stableDays: number): number {
  const words = new Set<string>()
  for (const c of d.cards.values()) {
    if (words.has(c.wordId) || isSuspended(d, c.wordId)) continue
    if (isUnstableCard(c, stableDays)) words.add(c.wordId)
  }
  return words.size
}

export function isDueReview(c: CardState, now: number, requestRetention: number): boolean {
  if (c.card.state !== State.Review) return false
  if (c.card.due.getTime() <= now) return true
  return retrievability(getFsrs(requestRetention), c.card, now) <= requestRetention
}

export function dueReviewCount(d: Derived, now: number, requestRetention: number): number {
  let n = 0
  for (const c of d.cards.values()) if (!isSuspended(d, c.wordId) && isDueReview(c, now, requestRetention)) n++
  return n
}

/** Candidate new cards in priority order: eligible say cards (by rank), then the next unseen word's listen card. */
export function newCandidates(d: Derived, wordOrder: readonly string[]): CardKey[] {
  const out: CardKey[] = []
  let nextListen: CardKey | null = null
  for (const id of wordOrder) {
    if (isSuspended(d, id)) continue
    const listen = getCard(d, id, 'listen')
    if (!listen) {
      // Strict rank order: only the first unseen word is a candidate.
      if (!nextListen) nextListen = cardKey(id, 'listen')
      continue
    }
    if (!getCard(d, id, 'say') && (listen.card.state === State.Review || listen.card.state === State.Relearning)) {
      out.push(cardKey(id, 'say'))
    }
  }
  if (nextListen) out.push(nextListen)
  return out
}

// ---------- selection ----------

interface Cand {
  key: CardKey
  wordId: string
  dir: Dir
  r: number
  due: number
  isNew: boolean
}

type Filter = (key: CardKey) => boolean

function weightedSample(cands: Cand[], rng: Rng, weight: (c: Cand) => number): Cand | null {
  if (!cands.length) return null
  let total = 0
  const ws = cands.map((c) => {
    const w = Math.max(weight(c), 1e-12)
    total += w
    return w
  })
  let x = rng() * total
  for (let i = 0; i < cands.length; i++) {
    x -= ws[i]
    if (x < 0) return cands[i]
  }
  return cands[cands.length - 1]
}

const atRisk = (c: Cand) => (1 - c.r) ** 2

export function selectNext(input: SelectInput): Selection {
  const { derived: d, wordOrder, settings, now, rng } = input
  const recent = input.recent ?? []
  const newRatio = input.newRatio ?? 0.25
  const f = getFsrs(d.requestRetention)

  const learningDue: Cand[] = []
  const learningPending: Cand[] = []
  const reviews: Cand[] = []
  const practice: Cand[] = []
  const unstable = new Set<string>()
  const introduced = new Set<string>()
  let nextReviewDueAt: number | null = null

  for (const c of d.cards.values()) {
    if (isSuspended(d, c.wordId) || (input.includeWord && !input.includeWord(c.wordId))) continue
    introduced.add(c.wordId)
    const due = c.card.due.getTime()
    const r = retrievability(f, c.card, now)
    const cand: Cand = { key: c.key, wordId: c.wordId, dir: c.dir, r, due, isNew: false }
    if (isUnstableCard(c, settings.stableDays)) unstable.add(c.wordId)
    if (isLearningState(c.card.state)) {
      ;(due <= now ? learningDue : learningPending).push(cand)
    } else if (c.card.state === State.Review) {
      if (due <= now || r <= settings.requestRetention) reviews.push(cand)
      else if (nextReviewDueAt === null || due < nextReviewDueAt) nextReviewDueAt = due
      practice.push(cand)
    }
  }
  learningDue.sort((a, b) => a.due - b.due || (a.key < b.key ? -1 : 1))
  learningPending.sort((a, b) => a.due - b.due || (a.key < b.key ? -1 : 1))
  // Stable iteration order for reproducible sampling with a seeded RNG.
  reviews.sort((a, b) => (a.key < b.key ? -1 : 1))
  practice.sort((a, b) => (a.key < b.key ? -1 : 1))

  let gateBlockedBy: GateBlock = null
  let news: Cand[] = []
  if (unstable.size >= settings.workingSetCap) gateBlockedBy = 'workingSet'
  else if (reviews.length > settings.backlogLimit) gateBlockedBy = 'backlog'
  else {
    news = newCandidates(d, wordOrder).map((key) => ({ key, ...parseCardKey(key), r: 0, due: now, isNew: true }))
    if (!news.length) gateBlockedBy = 'exhausted'
  }

  const info: QueueInfo = {
    unstableWords: unstable.size,
    dueReviews: reviews.length,
    learningDue: learningDue.length,
    learningPending: learningPending.length,
    introducedWords: introduced.size,
    gateOpen: news.length > 0,
    gateBlockedBy,
    nextLearningDueAt: learningPending.length ? learningPending[0].due : null,
    nextReviewDueAt,
  }

  const last = recent[recent.length - 1]
  const last3 = new Set(recent.slice(-3))
  const notLast: Filter = (k) => k !== last
  const noSibling: Filter = (k) => k !== last && !last3.has(siblingKey(k))
  const any: Filter = () => true

  const choose = (ok: Filter, dueOnly: boolean): [Cand, PickSource] | null => {
    const ld = learningDue.find((c) => ok(c.key))
    if (ld) return [ld, 'learning']
    const rv = reviews.filter((c) => ok(c.key))
    if (dueOnly) {
      const s = weightedSample(rv, rng, atRisk)
      return s ? [s, 'review'] : null
    }
    const nw = news.find((c) => ok(c.key))
    if (rv.length && nw) {
      if (rng() < newRatio) return [nw, 'new']
      return [weightedSample(rv, rng, atRisk)!, 'review']
    }
    if (rv.length) return [weightedSample(rv, rng, atRisk)!, 'review']
    if (nw) return [nw, 'new']
    const lp = learningPending.find((c) => ok(c.key))
    if (lp) return [lp, 'learningEarly']
    if (input.practiceAhead) {
      const s = weightedSample(practice.filter((c) => ok(c.key)), rng, atRisk)
      if (s) return [s, 'practice']
    }
    return null
  }

  // Prefer: no repeat and no sibling in last 3 -> no repeat -> (only if it is actually due) anything.
  const chosen = choose(noSibling, false) ?? choose(notLast, false) ?? choose(any, true)
  if (!chosen) return { pick: null, info }
  const [c, source] = chosen
  return {
    pick: {
      key: c.key,
      wordId: c.wordId,
      dir: c.dir,
      source,
      isNew: c.isNew,
      canMarkKnown: c.isNew && c.dir === 'listen',
      retrievability: c.r,
    },
    info,
  }
}

// ---------- interval previews ----------

export interface IntervalPreview {
  due: number
  ms: number
  label: string
}

/** What each button would schedule if the card were graded at `now`. */
export function previewIntervals(
  d: Derived,
  key: CardKey,
  now: number,
): Record<GradeName, IntervalPreview> {
  const f = getFsrs(d.requestRetention)
  const card: Card = d.cards.get(key)?.card ?? newCard(now)
  const preview = f.repeat(card, new Date(now))
  const out = {} as Record<GradeName, IntervalPreview>
  for (const g of ['again', 'good', 'easy'] as const) {
    const due = preview[GRADE_TO_RATING[g]].card.due.getTime()
    out[g] = { due, ms: due - now, label: formatInterval(due - now) }
  }
  return out
}

/** "<1m", "10m", "3h", "4d", "2mo", "1.5y" */
export function formatInterval(ms: number): string {
  const min = ms / 60_000
  if (min < 1) return '<1m'
  if (min < 60) return `${Math.round(min)}m`
  const h = min / 60
  if (h < 23.5) return `${Math.round(h)}h`
  const days = ms / DAY_MS
  if (days < 30.5) return `${Math.max(1, Math.round(days))}d`
  if (days < 365) return `${Math.round(days / 30.4)}mo`
  const y = days / 365
  return `${y < 10 ? Math.round(y * 10) / 10 : Math.round(y)}y`
}
