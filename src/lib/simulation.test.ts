// 60-day simulation of the no-quota introduction gate.
import { describe, expect, it } from 'vitest'
import { DEFAULT_SCHEDULER_SETTINGS } from './scheduler'
import { simulate, summarize } from './__fixtures__/simulate'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('60-day simulation (150 reviews/day, recall p = R)', () => {
  const off = new Set([35, 36, 37, 38, 39])
  const r = simulate({ days: 60, reviewsPerDay: 150, offDays: off, seed: 2026, practiceAhead: true })
  summarize('endless session, 5 days off (35-39)', r)

  it('respects the introduction gate (workingSetCap and backlogLimit) at every introduction', () => {
    expect(r.violations).toEqual([])
  })

  it('keeps new words flowing', () => {
    expect(r.introduced).toBeGreaterThan(100)
    for (const [a, b] of [[0, 10], [10, 20], [20, 30], [40, 50], [50, 60]]) {
      const n = sum(r.days.slice(a, b).map((s) => s.newWords))
      expect(n, `days ${a}-${b}`).toBeGreaterThan(10)
    }
  })

  it('does not burst new words after 5 days off', () => {
    const before = r.days.slice(25, 35).map((s) => s.newWords)
    const avgBefore = sum(before) / before.length
    const back = r.days[40]
    // The backlog built up while away, so the gate starts closed (checked per pick via `violations`).
    expect(back.dueAtStart).toBeGreaterThan(DEFAULT_SCHEDULER_SETTINGS.backlogLimit)
    // A calendar quota would try to catch up ~5 days of intake; here the day back is bounded by the
    // free working-set slots and stays in the normal range.
    expect(back.newWords).toBeLessThan(off.size * avgBefore)
    expect(back.newWords).toBeLessThanOrEqual(DEFAULT_SCHEDULER_SETTINGS.workingSetCap)
    expect(back.newWords).toBeLessThanOrEqual(2 * Math.max(...before))
    // Averaged over the first five days back, intake is no higher than before the break.
    const after = r.days.slice(40, 45).map((s) => s.newWords)
    expect(sum(after) / after.length).toBeLessThanOrEqual(avgBefore + 1)
  })

  it('unstable word count stays near the cap (only lapses can push it over)', () => {
    expect(r.maxUnstableEver).toBeLessThanOrEqual(DEFAULT_SCHEDULER_SETTINGS.workingSetCap + 10)
  })

  it('is deterministic', () => {
    const again = simulate({ days: 60, reviewsPerDay: 150, offDays: off, seed: 2026, practiceAhead: true })
    expect(again.days).toEqual(r.days)
  })

  it('a learner who stops when caught up still progresses', () => {
    const r2 = simulate({ days: 60, reviewsPerDay: 150, seed: 7, practiceAhead: false })
    summarize('stop when caught up, no days off', r2)
    expect(r2.violations).toEqual([])
    expect(r2.introduced).toBeGreaterThan(60)
    for (const [a, b] of [[0, 20], [20, 40], [40, 60]]) {
      expect(sum(r2.days.slice(a, b).map((s) => s.newWords)), `days ${a}-${b}`).toBeGreaterThan(10)
    }
  })
})
