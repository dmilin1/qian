import { describe, expect, it } from 'vitest'
import { buildDerived, getCard, isSuspended, openFlags, allFlags, withEvent, withoutEvent, type Derived } from './derive'
import { cardKey, makeFlag, makeKnown, makeReview, makeSuspend, parseCardKey, sanitizeEvent, siblingKey, type AppEvent, type GradeName } from './events'
import { DAY_MS, State } from './fsrs'
import { mulberry32 } from './scheduler'

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0)
const dev = 'dev-a'

function serialize(d: Derived) {
  const cards = [...d.cards.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, c]) => [k, JSON.stringify(c)])
  const words = [...d.words.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, w]) => [k, JSON.stringify(w)])
  return JSON.stringify({ cards, words, n: d.eventCount })
}

/** A messy realistic log: many words, both directions, all grades, long gaps (so fuzz kicks in). */
function randomLog(seed: number, n: number): AppEvent[] {
  const rng = mulberry32(seed)
  const grades: GradeName[] = ['again', 'good', 'good', 'good', 'easy']
  const out: AppEvent[] = []
  let ts = T0
  for (let i = 0; i < n; i++) {
    ts += Math.floor(rng() * 3 * DAY_MS)
    const wordId = `wt${1 + Math.floor(rng() * 20)}`
    const r = rng()
    if (r < 0.05) out.push(makeKnown({ wordId, ts, deviceId: dev }))
    else if (r < 0.07) out.push(makeSuspend({ wordId, suspended: rng() < 0.5, ts, deviceId: dev }))
    else if (r < 0.09) out.push(makeFlag({ wordId, reason: 'audio', resolved: rng() < 0.3, ts, deviceId: dev }))
    else
      out.push(
        makeReview({ wordId, dir: rng() < 0.5 ? 'listen' : 'say', grade: grades[Math.floor(rng() * grades.length)], ts, deviceId: dev }),
      )
  }
  return out
}

function shuffle<T>(xs: T[], seed: number): T[] {
  const rng = mulberry32(seed)
  const a = xs.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

describe('events helpers', () => {
  it('card keys round-trip and siblings', () => {
    expect(cardKey('w4f60-597d', 'listen')).toBe('w4f60-597d:listen')
    expect(parseCardKey('w4f60-597d:say')).toEqual({ wordId: 'w4f60-597d', dir: 'say' })
    expect(siblingKey('w1:listen')).toBe('w1:say')
    expect(() => parseCardKey('nope')).toThrow()
  })
  it('sanitizeEvent rejects malformed events and strips unknown fields', () => {
    expect(sanitizeEvent({ id: 'a', kind: 'review', wordId: 'w', dir: 'listen', grade: 'hard', ts: 1, deviceId: 'd' })).toBeNull()
    expect(sanitizeEvent({ id: 'a', kind: 'bogus', wordId: 'w', ts: 1, deviceId: 'd' })).toBeNull()
    expect(sanitizeEvent({ id: 'a', kind: 'known', wordId: 'w', ts: 'x', deviceId: 'd' })).toBeNull()
    expect(sanitizeEvent({ id: 'a', kind: 'known', wordId: 'w', ts: 1, deviceId: 'd', extra: 1 })).toEqual({
      id: 'a', kind: 'known', wordId: 'w', ts: 1, deviceId: 'd',
    })
  })
})

describe('replay', () => {
  it('derives FSRS state through learning steps into review', () => {
    const evs = [
      makeReview({ wordId: 'w1', dir: 'listen', grade: 'good', ts: T0, deviceId: dev }),
      makeReview({ wordId: 'w1', dir: 'listen', grade: 'good', ts: T0 + 10 * 60_000, deviceId: dev }),
    ]
    const d = buildDerived(evs)
    const c = getCard(d, 'w1', 'listen')!
    expect(c.card.state).toBe(State.Review)
    expect(c.card.reps).toBe(2)
    expect(c.introducedAt).toBe(T0)
    expect(getCard(d, 'w1', 'say')).toBeUndefined()
  })

  it('first Good on a new card enters learning with a 10 minute step', () => {
    const d = buildDerived([makeReview({ wordId: 'w1', dir: 'listen', grade: 'good', ts: T0, deviceId: dev })])
    const c = getCard(d, 'w1', 'listen')!
    expect(c.card.state).toBe(State.Learning)
    expect(c.card.due.getTime() - T0).toBe(10 * 60_000)
  })

  it('"known" applies Easy to both cards', () => {
    const d = buildDerived([makeKnown({ wordId: 'w1', ts: T0, deviceId: dev })])
    for (const dir of ['listen', 'say'] as const) {
      const c = getCard(d, 'w1', dir)!
      expect(c.card.state).toBe(State.Review)
      expect(c.lastGrade).toBe('easy')
      expect(c.card.due.getTime()).toBeGreaterThan(T0 + 5 * DAY_MS)
    }
  })

  it('suspend and flags', () => {
    const f1 = makeFlag({ wordId: 'w1', reason: 'audio', note: 'muffled', ts: T0, deviceId: dev })
    const f2 = makeFlag({ wordId: 'w1', reason: 'pinyin', ts: T0 + 1, deviceId: dev })
    const res = makeFlag({ wordId: 'w1', reason: 'audio', resolved: true, ts: T0 + 2, deviceId: dev })
    let d = buildDerived([f1, f2, makeSuspend({ wordId: 'w1', suspended: true, ts: T0, deviceId: dev })])
    expect(isSuspended(d, 'w1')).toBe(true)
    expect(openFlags(d).map((f) => f.reason)).toEqual(['audio', 'pinyin'])
    expect(openFlags(d)[0].note).toBe('muffled')
    d = withEvent(d, res)
    expect(openFlags(d).map((f) => f.reason)).toEqual(['pinyin'])
    expect(allFlags(d).find((f) => f.reason === 'audio')).toMatchObject({ resolved: true, resolvedAt: T0 + 2 })
    d = withEvent(d, makeSuspend({ wordId: 'w1', suspended: false, ts: T0 + 3, deviceId: dev }))
    expect(isSuspended(d, 'w1')).toBe(false)
  })

  it('is deterministic: same log twice, shuffled log, and fuzz all give identical states', () => {
    const log = randomLog(42, 3000)
    const a = serialize(buildDerived(log))
    const b = serialize(buildDerived(log))
    const c = serialize(buildDerived(shuffle(log, 7)))
    const d = serialize(buildDerived(shuffle(log, 8).reverse()))
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(d).toBe(a)
    // Fuzz is actually in play: intervals are not all equal to the unfuzzed ones (sanity check that the
    // log produced long intervals at all).
    const maxIvl = Math.max(...[...buildDerived(log).cards.values()].map((x) => x.card.scheduled_days))
    expect(maxIvl).toBeGreaterThan(3)
  })

  it('incremental withEvent equals a full rebuild, including out-of-order arrivals', () => {
    const log = randomLog(1, 1500)
    const full = serialize(buildDerived(log))
    let inc = buildDerived([])
    for (const e of log) inc = withEvent(inc, e)
    expect(serialize(inc)).toBe(full)
    let shuffled = buildDerived([])
    for (const e of shuffle(log, 3)) shuffled = withEvent(shuffled, e)
    expect(serialize(shuffled)).toBe(full)
  })

  it('duplicate ids are ignored', () => {
    const e = makeReview({ wordId: 'w1', dir: 'listen', grade: 'good', ts: T0, deviceId: dev })
    const d1 = buildDerived([e, { ...e }, e])
    expect(d1.eventCount).toBe(1)
    expect(withEvent(d1, { ...e })).toBe(d1)
  })

  it('withoutEvent equals rebuilding without that event', () => {
    const log = randomLog(5, 400)
    const victim = log[200]
    const expected = serialize(buildDerived(log.filter((e) => e.id !== victim.id)))
    expect(serialize(withoutEvent(buildDerived(log), victim))).toBe(expected)
  })

  it('withEvent does not mutate the previous state', () => {
    const d0 = buildDerived([makeReview({ wordId: 'w1', dir: 'listen', grade: 'good', ts: T0, deviceId: dev })])
    const before = serialize(d0)
    withEvent(d0, makeReview({ wordId: 'w1', dir: 'listen', grade: 'good', ts: T0 + 600_000, deviceId: dev }))
    expect(serialize(d0)).toBe(before)
  })

  it('replays 100k events quickly', () => {
    const rng = mulberry32(9)
    const log: AppEvent[] = []
    let ts = T0
    for (let i = 0; i < 100_000; i++) {
      ts += 5_000 + Math.floor(rng() * 60_000)
      log.push(
        makeReview({
          wordId: `wt${1 + Math.floor(rng() * 1000)}`,
          dir: rng() < 0.5 ? 'listen' : 'say',
          grade: rng() < 0.15 ? 'again' : 'good',
          ts,
          deviceId: dev,
        }),
      )
    }
    const t = performance.now()
    const d = buildDerived(log)
    const ms = performance.now() - t
    expect(d.eventCount).toBe(100_000)
    expect(d.cards.size).toBe(2000)
    console.info(`[perf] full replay of 100k events: ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(5000)
    const t2 = performance.now()
    withEvent(d, makeReview({ wordId: 'wt1', dir: 'listen', grade: 'good', ts: ts + 1000, deviceId: dev }))
    const ms2 = performance.now() - t2
    console.info(`[perf] incremental append with 100k events: ${ms2.toFixed(2)} ms`)
    expect(ms2).toBeLessThan(50)
  })
})
