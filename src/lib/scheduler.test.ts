import { describe, expect, it } from 'vitest'
import { buildDerived, getCard, withEvent, type Derived } from './derive'
import { cardKey, makeKnown, makeReview, makeSuspend, type AppEvent, type CardKey } from './events'
import { DAY_MS, getFsrs, retrievability, State } from './fsrs'
import {
  DEFAULT_SCHEDULER_SETTINGS,
  dueReviewCount,
  EARLY_LEARNING_MS,
  formatInterval,
  isDueReview,
  mulberry32,
  newCandidates,
  previewIntervals,
  selectNext,
  unstableWordCount,
  type SchedulerSettings,
} from './scheduler'

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0)
const dev = 'd'
const MIN = 60_000
const order = Array.from({ length: 50 }, (_, i) => `wt${i + 1}`)
const S = DEFAULT_SCHEDULER_SETTINGS

const rev = (wordId: string, dir: 'listen' | 'say', grade: 'again' | 'good' | 'easy', ts: number) =>
  makeReview({ wordId, dir, grade, ts, deviceId: dev })

/** Graduate a listen card: good, good (10 min later). */
function graduate(wordId: string, ts: number, dir: 'listen' | 'say' = 'listen'): AppEvent[] {
  return [rev(wordId, dir, 'good', ts), rev(wordId, dir, 'good', ts + 10 * MIN)]
}

function sel(d: Derived, now: number, opts: Partial<{ recent: CardKey[]; settings: SchedulerSettings; seed: number; practiceAhead: boolean; newRatio: number }> = {}) {
  return selectNext({
    derived: d,
    wordOrder: order,
    settings: opts.settings ?? S,
    now,
    recent: opts.recent ?? [],
    rng: mulberry32(opts.seed ?? 1),
    practiceAhead: opts.practiceAhead,
    newRatio: opts.newRatio,
  })
}

describe('introduction', () => {
  it('starts with the first word listen card', () => {
    const s = sel(buildDerived([]), T0)
    expect(s.pick).toMatchObject({ key: 'wt1:listen', source: 'new', isNew: true, canMarkKnown: true })
    expect(s.info.gateOpen).toBe(true)
  })

  it('introduces strictly in rank order, skipping suspended words', () => {
    const d = buildDerived([makeSuspend({ wordId: 'wt1', suspended: true, ts: T0, deviceId: dev })])
    expect(newCandidates(d, order, T0)).toEqual(['wt2:listen'])
  })

  it('say card becomes eligible only after listen leaves learning, on a later study day', () => {
    let d = buildDerived([rev('wt1', 'listen', 'good', T0)])
    expect(newCandidates(d, order, T0 + DAY_MS)).toEqual(['wt2:listen'])
    d = withEvent(d, rev('wt1', 'listen', 'good', T0 + 10 * MIN))
    expect(getCard(d, 'wt1', 'listen')!.card.state).toBe(State.Review)
    // Graduated, but the Say card waits for the next study day so it is not answered from short-term memory.
    expect(newCandidates(d, order, T0 + 11 * MIN)).toEqual(['wt2:listen'])
    expect(newCandidates(d, order, T0 + DAY_MS)).toEqual(['wt1:say', 'wt2:listen'])
  })

  it('the study day for Say cards starts at the day offset (local 4am)', () => {
    const off = 4 * 3600_000 // 4am in UTC
    const day1 = Date.UTC(2026, 0, 6)
    // Easy on a new listen card graduates it straight to Review.
    const d = buildDerived([rev('wt1', 'listen', 'easy', T0)], 0.9, off)
    expect(getCard(d, 'wt1', 'listen')!.card.state).toBe(State.Review)
    expect(newCandidates(d, order, T0 + 10_000)).toEqual(['wt2:listen'])
    expect(newCandidates(d, order, day1 + 3 * 3600_000)).toEqual(['wt2:listen']) // 03:00 next morning: same study day
    expect(newCandidates(d, order, day1 + off)).toEqual(['wt1:say', 'wt2:listen'])
  })

  it('say card of a new pick does not offer "I already know this"', () => {
    const d = buildDerived(graduate('wt1', T0))
    const s = sel(d, T0 + DAY_MS, { recent: ['wt1:listen'], settings: { ...S, workingSetCap: 100 } })
    // wt1:say is the sibling of the last shown card, so wt2:listen is preferred.
    expect(s.pick?.key).toBe('wt2:listen')
    const s2 = sel(d, T0 + DAY_MS, { recent: ['wt9:listen'] })
    expect(s2.pick).toMatchObject({ key: 'wt1:say', isNew: true, canMarkKnown: false })
  })

  it('gate closes when the working set is full', () => {
    const evs: AppEvent[] = []
    for (let i = 1; i <= 3; i++) evs.push(rev(`wt${i}`, 'listen', 'good', T0 + i))
    const d = buildDerived(evs)
    expect(unstableWordCount(d, 7)).toBe(3)
    const s = sel(d, T0 + 1, { settings: { ...S, workingSetCap: 3 } })
    expect(s.info.gateBlockedBy).toBe('workingSet')
    expect(s.info.gateOpen).toBe(false)
    // Nothing due and the 10-minute steps are far off: caught up (not shown early), waiting for the first step.
    expect(s.pick).toBeNull()
    expect(s.info.nextLearningDueAt).toBe(T0 + 1 + 10 * MIN)
    // Within EARLY_LEARNING_MS of its step a learning card is shown a little early.
    expect(sel(d, T0 + 1 + 10 * MIN - EARLY_LEARNING_MS, { settings: { ...S, workingSetCap: 3 } }).pick).toMatchObject({ key: 'wt1:listen', source: 'learningEarly' })
    expect(sel(d, T0 + 1, { settings: { ...S, workingSetCap: 4 } }).pick?.key).toBe('wt4:listen')
  })

  it('a full working set still lets in Say cards of words already in it (not past the backlog)', () => {
    const evs = ['wt1', 'wt2', 'wt3'].flatMap((w, i) => graduate(w, T0 + i))
    const d = buildDerived(evs)
    const cap3 = { ...S, workingSetCap: 3 }
    const now = T0 + DAY_MS
    expect(unstableWordCount(d, S.stableDays)).toBe(3)
    const s = sel(d, now, { settings: cap3, recent: ['wt9:listen'] })
    expect(s.pick).toMatchObject({ key: 'wt1:say', source: 'new', isNew: true, canMarkKnown: false })
    expect(s.info.gateOpen).toBe(true)
    expect(s.info.gateBlockedBy).toBeNull()
    // Introducing it does not grow the working set, and the next word (wt4) stays locked out.
    const d2 = withEvent(d, rev('wt1', 'say', 'good', now))
    expect(unstableWordCount(d2, S.stableDays)).toBe(3)
    for (let seed = 1; seed < 30; seed++) expect(sel(d2, now + 1000, { settings: cap3, seed }).pick?.key).not.toBe('wt4:listen')
    // A review backlog still blocks it.
    const b = sel(d, now, { settings: { ...cap3, backlogLimit: -1 }, recent: ['wt9:listen'] })
    expect(b.info.gateBlockedBy).toBe('workingSet')
    expect(b.pick?.isNew).not.toBe(true)
  })

  it('shows learning cards early in a weighted random order, not the introduction order', () => {
    // 30 words introduced 8 s apart, all graded Good: every 10-minute step is still pending. Just before
    // wt1's step is due, wt1..wt8 are within EARLY_LEARNING_MS of their step.
    const ids = order.slice(0, 30)
    const d = buildDerived(ids.map((w, i) => rev(w, 'listen', 'good', T0 + i * 8000)))
    const now = T0 + 10 * MIN - 1000
    const early = ids.slice(0, 8).map((w) => cardKey(w, 'listen'))
    const pickAll = (recent: CardKey[]) => {
      const counts = new Map<string, number>()
      for (let seed = 1; seed <= 300; seed++) {
        const s = sel(d, now, { seed, recent })
        expect(s.pick?.source).toBe('learningEarly')
        counts.set(s.pick!.key, (counts.get(s.pick!.key) ?? 0) + 1)
      }
      return counts
    }
    const spread = pickAll(ids.slice(-5).map((w) => cardKey(w, 'listen')))
    expect(spread.size).toBeGreaterThan(4) // not always the earliest card
    for (const k of spread.keys()) expect(early).toContain(k)
    // Never one of the last few cards while another one is available.
    const avoid = pickAll(early.slice(0, 5))
    expect([...avoid.keys()].sort()).toEqual(early.slice(5).sort())
  })

  it('stable words (known) do not count toward the working set', () => {
    const d = buildDerived([makeKnown({ wordId: 'wt1', ts: T0, deviceId: dev })])
    expect(unstableWordCount(d, 7)).toBe(0)
    expect(unstableWordCount(d, 30)).toBe(1)
  })

  it('suspended words do not count as unstable', () => {
    const d = buildDerived([rev('wt1', 'listen', 'good', T0), makeSuspend({ wordId: 'wt1', suspended: true, ts: T0 + 1, deviceId: dev })])
    expect(unstableWordCount(d, 7)).toBe(0)
    expect(sel(d, T0 + DAY_MS).pick?.key).toBe('wt2:listen')
  })

  it('suspended words that were graded still count as introduced (like the Words and Stats pages)', () => {
    const d = buildDerived([
      rev('wt1', 'listen', 'good', T0),
      rev('wt2', 'listen', 'good', T0 + 1),
      makeSuspend({ wordId: 'wt1', suspended: true, ts: T0 + 2, deviceId: dev }),
    ])
    const s = sel(d, T0 + DAY_MS)
    expect(s.info.introducedWords).toBe(2)
    expect(s.info.unstableWords).toBe(1)
  })

  it('gate closes when the review backlog exceeds the limit', () => {
    const evs: AppEvent[] = []
    for (let i = 1; i <= 6; i++) evs.push(makeKnown({ wordId: `wt${i}`, ts: T0 + i, deviceId: dev }))
    const d = buildDerived(evs)
    const later = T0 + 60 * DAY_MS
    expect(dueReviewCount(d, later)).toBe(12)
    const s = sel(d, later, { settings: { ...S, backlogLimit: 11 } })
    expect(s.info.gateBlockedBy).toBe('backlog')
    expect(s.pick?.source).toBe('review')
    expect(sel(d, later, { settings: { ...S, backlogLimit: 12 } }).info.gateOpen).toBe(true)
  })

  it('reports exhausted when every word is introduced', () => {
    const d = buildDerived(order.map((w, i) => makeKnown({ wordId: w, ts: T0 + i, deviceId: dev })))
    const s = sel(d, T0 + 100)
    expect(s.info.gateBlockedBy).toBe('exhausted')
    expect(s.pick).toBeNull()
  })
})

describe('selection order', () => {
  it('due learning cards come first, earliest due first', () => {
    const d = buildDerived([
      rev('wt1', 'listen', 'again', T0), // due T0+1m
      rev('wt2', 'listen', 'good', T0 + 1), // due T0+10m
      rev('wt3', 'listen', 'again', T0 + 2 * MIN), // due T0+3m
    ])
    expect(sel(d, T0 + 20 * MIN).pick).toMatchObject({ key: 'wt1:listen', source: 'learning' })
    expect(sel(d, T0 + 20 * MIN, { recent: ['wt1:listen'] }).pick?.key).toBe('wt3:listen')
  })

  it('never repeats the last card; avoids the sibling within the last 3', () => {
    const d = buildDerived([...graduate('wt1', T0), ...graduate('wt1', T0, 'say'), ...graduate('wt2', T0)])
    const later = T0 + 30 * DAY_MS // all three due
    for (let seed = 1; seed < 50; seed++) {
      // newRatio 0: wt2:say (a Say card of a word still in the working set) is not in the way.
      const s = sel(d, later, { seed, recent: ['wt1:say'], settings: { ...S, workingSetCap: 0 }, newRatio: 0 })
      expect(s.pick?.key).toBe('wt2:listen')
    }
    // Only the last card and its sibling are available -> sibling allowed, last card not.
    const d2 = buildDerived([...graduate('wt1', T0), ...graduate('wt1', T0, 'say')])
    const s2 = sel(d2, later, { recent: ['wt1:say'], settings: { ...S, workingSetCap: 0 } })
    expect(s2.pick?.key).toBe('wt1:listen')
  })

  it('shows the last card again only when it is due and nothing else exists', () => {
    const d = buildDerived([rev('wt1', 'listen', 'again', T0)])
    const cap0 = { ...S, workingSetCap: 0 }
    expect(sel(d, T0 + 10, { recent: ['wt1:listen'], settings: cap0 }).pick).toBeNull()
    expect(sel(d, T0 + 10, { recent: ['wt1:listen'], settings: cap0 }).info.nextLearningDueAt).toBe(T0 + MIN)
    expect(sel(d, T0 + 2 * MIN, { recent: ['wt1:listen'], settings: cap0 }).pick?.key).toBe('wt1:listen')
  })

  it('interleaves new cards about 1 in 4 when reviews are due', () => {
    const evs: AppEvent[] = []
    for (let i = 1; i <= 8; i++) evs.push(makeKnown({ wordId: `wt${i}`, ts: T0 + i, deviceId: dev }))
    const d = buildDerived(evs)
    const later = T0 + 30 * DAY_MS
    const rng = mulberry32(3)
    let news = 0
    const N = 2000
    for (let i = 0; i < N; i++) {
      const s = selectNext({ derived: d, wordOrder: order, settings: { ...S, backlogLimit: 100 }, now: later, rng })
      if (s.pick?.isNew) news++
    }
    expect(news / N).toBeGreaterThan(0.2)
    expect(news / N).toBeLessThan(0.3)
  })

  it('samples due reviews weighted toward the lowest retrievability', () => {
    // wt1 reviewed long ago (low R), wt2 just barely due.
    const d = buildDerived([...graduate('wt1', T0), ...graduate('wt2', T0 + 25 * DAY_MS)])
    const now = T0 + 60 * DAY_MS
    const rng = mulberry32(11)
    const counts: Record<string, number> = {}
    for (let i = 0; i < 1000; i++) {
      const s = selectNext({ derived: d, wordOrder: order, settings: { ...S, workingSetCap: 0 }, now, rng, newRatio: 0 })
      counts[s.pick!.key] = (counts[s.pick!.key] ?? 0) + 1
    }
    expect(counts['wt1:listen']).toBeGreaterThan(counts['wt2:listen'] ?? 0)
    expect(counts['wt2:listen'] ?? 0).toBeGreaterThan(0)
  })

  it('is reproducible with the same seed', () => {
    const d = buildDerived(order.slice(0, 20).flatMap((w, i) => graduate(w, T0 + i * DAY_MS)))
    const a = Array.from({ length: 30 }, (_, i) => sel(d, T0 + 90 * DAY_MS, { seed: i }).pick?.key)
    const b = Array.from({ length: 30 }, (_, i) => sel(d, T0 + 90 * DAY_MS, { seed: i }).pick?.key)
    expect(a).toEqual(b)
  })

  it('caught up returns null with info; practice-ahead picks introduced cards', () => {
    const d = buildDerived([makeKnown({ wordId: 'wt1', ts: T0, deviceId: dev }), makeKnown({ wordId: 'wt2', ts: T0, deviceId: dev })])
    const cap = { ...S, workingSetCap: 0 }
    const s = sel(d, T0 + DAY_MS, { settings: cap })
    expect(s.pick).toBeNull()
    expect(s.info.gateBlockedBy).toBe('workingSet')
    expect(s.info.nextReviewDueAt).toBeGreaterThan(T0 + DAY_MS)
    const p = sel(d, T0 + DAY_MS, { settings: cap, practiceAhead: true, recent: ['wt1:listen'] })
    expect(p.pick?.source).toBe('practice')
    expect(p.pick?.key).not.toBe('wt1:listen')
    expect(p.pick?.key).not.toBe('wt1:say')
  })

  it('a practice-ahead review is just a review (FSRS handles early reviews)', () => {
    const d = buildDerived([makeKnown({ wordId: 'wt1', ts: T0, deviceId: dev })])
    const d2 = withEvent(d, rev('wt1', 'listen', 'good', T0 + DAY_MS))
    const c = getCard(d2, 'wt1', 'listen')!
    expect(c.card.state).toBe(State.Review)
    expect(c.card.reps).toBe(2)
  })

  it('handles an overdue backlog after days off: reviews first, no new cards', () => {
    const evs = order.slice(0, 30).map((w, i) => makeKnown({ wordId: w, ts: T0 + i, deviceId: dev }))
    const d = buildDerived(evs)
    const s = sel(d, T0 + 40 * DAY_MS)
    expect(s.info.dueReviews).toBe(60)
    expect(s.info.gateOpen).toBe(false)
    expect(s.pick?.source).toBe('review')
  })
})

describe('interval previews', () => {
  it('new card: again <1m-ish, good 10m, easy days', () => {
    const p = previewIntervals(buildDerived([]), cardKey('wt1', 'listen'), T0)
    expect(p.again.label).toBe('1m')
    expect(p.good.label).toBe('10m')
    expect(p.easy.ms).toBeGreaterThan(DAY_MS)
    expect(p.easy.label).toMatch(/^\d+d$/)
  })
  it('review card intervals are ordered', () => {
    const d = buildDerived(graduate('wt1', T0))
    const p = previewIntervals(d, 'wt1:listen', T0 + 3 * DAY_MS)
    expect(p.again.ms).toBeLessThan(p.good.ms)
    expect(p.good.ms).toBeLessThan(p.easy.ms)
    expect(p.again.label).toBe('10m')
  })
  it('formatInterval', () => {
    expect(formatInterval(10_000)).toBe('<1m')
    expect(formatInterval(MIN)).toBe('1m')
    expect(formatInterval(10 * MIN)).toBe('10m')
    expect(formatInterval(3 * 60 * MIN)).toBe('3h')
    expect(formatInterval(3 * DAY_MS)).toBe('3d')
    expect(formatInterval(65 * DAY_MS)).toBe('2mo')
    expect(formatInterval(400 * DAY_MS)).toBe('1.1y')
  })
})

describe('review fixes (core)', () => {
  it('a just-failed card is not graduated early: answering Good every 5 s with the gate closed takes ~10 min', () => {
    // wt1 and wt2 are in Review, then both lapse; with cap 2 the working set is full, so nothing else is shown.
    const lapse = T0 + 3 * DAY_MS
    let d = buildDerived([...graduate('wt1', T0), ...graduate('wt2', T0 + 1), rev('wt1', 'listen', 'again', lapse), rev('wt2', 'listen', 'again', lapse + 1)])
    expect(getCard(d, 'wt1', 'listen')!.card.state).toBe(State.Relearning)
    const cap2 = { ...S, workingSetCap: 2 }
    const recent: CardKey[] = ['wt2:listen']
    const graduatedAt: Record<string, number> = {}
    for (let now = lapse + 5000; now < lapse + 30 * MIN && Object.keys(graduatedAt).length < 2; now += 5000) {
      const s = sel(d, now, { settings: cap2, recent })
      if (!s.pick) continue
      const target = s.pick.dir === 'listen' // a Say card of a word in the working set may still be introduced
      d = withEvent(d, rev(s.pick.wordId, s.pick.dir, target ? 'good' : 'easy', now))
      recent.push(s.pick.key)
      if (target && getCard(d, s.pick.wordId, 'listen')!.card.state === State.Review) graduatedAt[s.pick.wordId] ??= now
    }
    // Relearning step is 10 min; showing at most EARLY_LEARNING_MS early.
    expect(graduatedAt.wt1 - lapse).toBeGreaterThanOrEqual(10 * MIN - EARLY_LEARNING_MS)
    expect(graduatedAt.wt2 - lapse).toBeGreaterThanOrEqual(10 * MIN - EARLY_LEARNING_MS)
  })

  it('a Review card is due exactly at card.due, and nextReviewDueAt agrees with the queue', () => {
    // Many cards with the same history: fuzz pushes some due dates past the point where R hits 0.9.
    const ids = order.slice(0, 40)
    const d = buildDerived(ids.flatMap((w, i) => [...graduate(w, T0 + i * 1000), rev(w, 'listen', 'good', T0 + i * 1000 + 3 * DAY_MS)]))
    const f = getFsrs(0.9)
    const cards = ids.map((w) => getCard(d, w, 'listen')!)
    const lateFuzz = cards.filter((c) => retrievability(f, c.card, c.card.due.getTime() - 1) <= 0.9)
    expect(lateFuzz.length).toBeGreaterThan(0) // the case that used to come due early
    for (const c of cards) {
      expect(isDueReview(c, c.card.due.getTime() - 1)).toBe(false)
      expect(isDueReview(c, c.card.due.getTime())).toBe(true)
    }
    const firstDue = Math.min(...cards.map((c) => c.card.due.getTime()))
    const before = sel(d, firstDue - 1, { settings: { ...S, workingSetCap: 0 } })
    expect(before.pick).toBeNull()
    expect(before.info.dueReviews).toBe(0)
    expect(before.info.nextReviewDueAt).toBe(firstDue)
    expect(sel(d, firstDue, { settings: { ...S, workingSetCap: 0 } }).pick?.source).toBe('review')
  })

  it('button previews match the interval actually scheduled when graded seconds later', () => {
    const ids = order.slice(0, 40)
    let d = buildDerived(ids.flatMap((w, i) => graduate(w, T0 + i * 1000)))
    for (const [i, w] of ids.entries()) {
      const shownAt = getCard(d, w, 'listen')!.card.due.getTime() + i * 3600_000
      const p = previewIntervals(d, cardKey(w, 'listen'), shownAt)
      const gradedAt = shownAt + 6000
      for (const g of ['again', 'good', 'easy'] as const) {
        const after = withEvent(d, rev(w, 'listen', g, gradedAt))
        expect(getCard(after, w, 'listen')!.card.due.getTime() - gradedAt, `${w} ${g}`).toBe(p[g].ms)
      }
      d = withEvent(d, rev(w, 'listen', 'good', gradedAt))
    }
  })
})
