// Simulated learner for scheduler tests: recalls a card with probability = its FSRS retrievability.
import { buildDerived, withEvent, type Derived } from '../derive'
import { cardKey, makeKnown, makeReview, type AppEvent, type CardKey } from '../events'
import { DAY_MS, getFsrs, retrievability } from '../fsrs'
import { DEFAULT_SCHEDULER_SETTINGS, mulberry32, RECENT_WINDOW, selectNext, unstableWordCount, type SchedulerSettings } from '../scheduler'

export interface DayStats {
  day: number
  reviews: number
  newWords: number // listen cards introduced
  newSay: number
  caughtUp: number // picks that returned null (before practice-ahead)
  maxUnstable: number
  dueAtStart: number
  accuracy: number
}

export interface SimOptions {
  days: number
  reviewsPerDay: number
  offDays?: ReadonlySet<number>
  seed: number
  settings?: SchedulerSettings
  /** Keep going with practice-ahead when caught up (endless session); otherwise stop for the day. */
  practiceAhead: boolean
  newRecallP?: number
  knownP?: number
  /** Word ids in rank order (default: 1000 synthetic ids `wt1`…). */
  wordOrder?: readonly string[]
  /** Midnight of day 0; sessions start at 08:00 after it (default: 2026-01-05 UTC). */
  start?: number
}

const T0 = Date.UTC(2026, 0, 5, 0, 0, 0)
const ORDER = Array.from({ length: 1000 }, (_, i) => `wt${i + 1}`)

export function simulate(o: SimOptions) {
  const order = o.wordOrder ?? ORDER
  const start = o.start ?? T0
  const events: AppEvent[] = []
  const settings = o.settings ?? DEFAULT_SCHEDULER_SETTINGS
  const rng = mulberry32(o.seed)
  const learner = mulberry32(o.seed * 7919 + 1)
  const f = getFsrs(settings.requestRetention)
  let d: Derived = buildDerived([], settings.requestRetention)
  const recent: CardKey[] = []
  const days: DayStats[] = []
  const violations: string[] = []
  let maxUnstableEver = 0
  let n = 0

  for (let day = 0; day < o.days; day++) {
    const st: DayStats = { day, reviews: 0, newWords: 0, newSay: 0, caughtUp: 0, maxUnstable: 0, dueAtStart: 0, accuracy: 0 }
    days.push(st)
    if (o.offDays?.has(day)) continue
    let now = start + day * DAY_MS + 8 * 3600_000 // 08:00
    let correct = 0
    let first = true
    while (st.reviews < o.reviewsPerDay) {
      let s = selectNext({ derived: d, wordOrder: order, settings, now, recent, rng })
      if (first) {
        st.dueAtStart = s.info.dueReviews
        first = false
      }
      if (!s.pick) {
        st.caughtUp++
        if (!o.practiceAhead) {
          // The caught-up screen counts down to a pending learning step; a learner waits for a short one.
          const next = s.info.nextLearningDueAt
          if (next !== null && next - now <= 20 * 60_000) {
            now = Math.max(now + 1, next)
            continue
          }
          break
        }
        s = selectNext({ derived: d, wordOrder: order, settings, now, recent, rng, practiceAhead: true })
        if (!s.pick) {
          now += 60_000
          continue
        }
      }
      const p = s.pick!
      if (p.isNew && p.dir === 'listen') {
        if (s.info.unstableWords >= settings.workingSetCap) violations.push(`day ${day}: introduced with ${s.info.unstableWords} unstable`)
        if (s.info.dueReviews > settings.backlogLimit) violations.push(`day ${day}: introduced with ${s.info.dueReviews} due`)
      }
      let e: AppEvent
      if (p.canMarkKnown && learner() < (o.knownP ?? 0.05)) {
        e = makeKnown({ wordId: p.wordId, ts: now, deviceId: 'sim', id: `e${n++}` })
        correct++
      } else {
        const card = d.cards.get(p.key)?.card
        const pRecall = card ? retrievability(f, card, now) : (o.newRecallP ?? 0.6)
        const ok = learner() < pRecall
        if (ok) correct++
        const grade = ok ? (learner() < 0.1 ? 'easy' : 'good') : 'again'
        e = makeReview({ wordId: p.wordId, dir: p.dir, grade, ts: now, deviceId: 'sim', id: `e${n++}`, elapsedMs: 8000 })
      }
      if (p.isNew) {
        if (p.dir === 'listen') st.newWords++
        else st.newSay++
      }
      d = withEvent(d, e)
      events.push(e)
      // Same rule as the store's recentKeys: a known event counts as both cards.
      if (e.kind === 'known') recent.push(cardKey(p.wordId, 'listen'), cardKey(p.wordId, 'say'))
      else recent.push(p.key)
      while (recent.length > RECENT_WINDOW) recent.shift()
      st.reviews++
      const u = unstableWordCount(d, settings.stableDays)
      st.maxUnstable = Math.max(st.maxUnstable, u)
      maxUnstableEver = Math.max(maxUnstableEver, u)
      now += 8_000 + Math.floor(rng() * 8_000) // 8–16 s per card
    }
    st.accuracy = st.reviews ? correct / st.reviews : 0
  }
  const introduced = new Set([...d.cards.values()].map((c) => c.wordId)).size
  return { days, violations, maxUnstableEver, introduced, derived: d, events }
}

export function summarize(label: string, r: ReturnType<typeof simulate>) {
  const rows = r.days.map(
    (s) =>
      `${String(s.day).padStart(2)} rev=${String(s.reviews).padStart(3)} new=${String(s.newWords).padStart(2)} say=${String(s.newSay).padStart(2)} dueAtStart=${String(s.dueAtStart).padStart(3)} maxUnstable=${String(s.maxUnstable).padStart(2)} caughtUp=${s.caughtUp} acc=${(s.accuracy * 100).toFixed(0)}%`,
  )
  console.info(`[sim] ${label}: introduced ${r.introduced} words, max unstable ${r.maxUnstableEver}\n` + rows.join('\n'))
}

