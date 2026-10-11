import { describe, expect, it } from 'vitest'
import { buildDerived, getCard } from './derive'
import { makeReview } from './events'
import { applyGrade, DAY_MS, defaultDayOffsetMs, getFsrs, newCard } from './fsrs'

const MIN = 60_000
const HOUR = 60 * MIN
const tz = (minutesEastOfUtc: number) => ({ getTimezoneOffset: () => -minutesEastOfUtc }) as Date
const TAIWAN = defaultDayOffsetMs(tz(8 * 60))

/** Stability after Good, Good `gap` apart, starting at `start` (UTC ms), with the given day offset. */
function twoGoods(start: number, gap: number, off: number) {
  const evs = [0, gap].map((dt, i) => makeReview({ wordId: 'w1', dir: 'listen', grade: 'good', ts: start + dt, deviceId: 'd', id: `e${i}` }))
  return getCard(buildDerived(evs, 0.9, off), 'w1', 'listen')!.card
}

describe('day boundary (ts-fsrs counts whole UTC days)', () => {
  it('defaultDayOffsetMs puts the boundary at 4am local', () => {
    expect(TAIWAN).toBe(-4 * HOUR) // UTC+8: local 04:00 = 20:00 UTC
    expect(defaultDayOffsetMs(tz(0))).toBe(4 * HOUR)
    expect(defaultDayOffsetMs(tz(-7 * 60))).toBe(11 * HOUR) // PDT: local 04:00 = 11:00 UTC
  })

  it('a 10-minute learning step across UTC midnight (08:00 in Taiwan) is the same day with the local offset', () => {
    const midday = twoGoods(Date.UTC(2026, 0, 5, 4, 0), 10 * MIN, TAIWAN) // 12:00 local
    const acrossUtcMidnight = Date.UTC(2026, 0, 5, 23, 55) // 07:55 -> 08:05 local
    const utc = twoGoods(acrossUtcMidnight, 10 * MIN, 0)
    const local = twoGoods(acrossUtcMidnight, 10 * MIN, TAIWAN)
    expect(local.stability).toBeCloseTo(midday.stability, 10)
    expect(utc.stability).toBeGreaterThan(2 * local.stability) // the distortion this fixes
    // Across local 4am (20:00 UTC) the step does count as a new day.
    const across4am = twoGoods(Date.UTC(2026, 0, 5, 19, 55), 10 * MIN, TAIWAN)
    expect(across4am.stability).toBeCloseTo(utc.stability, 10)
  })

  it('the shift is undone on the way out: due and last_review are real times', () => {
    const ts = Date.UTC(2026, 0, 5, 23, 55)
    const c = applyGrade(getFsrs(0.9, TAIWAN), newCard(ts), 'good', ts, TAIWAN)
    expect(c.last_review!.getTime()).toBe(ts)
    expect(c.due.getTime()).toBe(ts + 10 * MIN)
  })
})

describe('fuzz seed', () => {
  it('does not depend on the review millisecond, but differs between cards', () => {
    const f = getFsrs(0.9)
    const ivls = new Set<number>()
    for (let i = 0; i < 20; i++) {
      const t0 = Date.UTC(2026, 0, 5, 9) + i * 7919
      let c = applyGrade(f, newCard(t0), 'good', t0)
      c = applyGrade(f, c, 'good', t0 + 10 * MIN)
      const at = c.due.getTime() + 5 * DAY_MS
      const a = applyGrade(f, c, 'good', at)
      const b = applyGrade(f, c, 'good', at + 6000)
      expect(b.due.getTime() - (at + 6000)).toBe(a.due.getTime() - at)
      ivls.add(a.scheduled_days)
    }
    expect(ivls.size).toBeGreaterThan(1) // fuzz still spreads cards with identical histories
  })
})
