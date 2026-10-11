import { describe, expect, it } from 'vitest'
import { FIXTURE_WORDS } from '../../lib/__fixtures__/words'
import { buildDerived } from '../../lib/derive'
import { makeReview } from '../../lib/events'
import { dayKey } from '../../lib/stats'
import { createWordIndex } from '../../lib/words'
import {
  addDays,
  buildAccuracySeries,
  buildHeatmap,
  buildStatsModel,
  formatDuration,
  heatLevel,
  heatThresholds,
  mondayOf,
} from './statsModel'
import { NOW, seededEvents } from './testData'

const words = createWordIndex(FIXTURE_WORDS)

describe('statsModel', () => {
  it('is empty for a brand-new user', () => {
    const m = buildStatsModel({ derived: buildDerived([]), events: [], words, now: NOW })
    expect(m.empty).toBe(true)
    expect(m.totalWords).toBe(3)
    expect(m.introduced).toBe(0)
    expect(m.streak).toEqual({ days: 0, studiedToday: false })
    expect(m.accuracy).toEqual({ correct: 0, total: 0 })
    expect(m.accuracySeries.points).toEqual([])
    expect(m.forecast).toHaveLength(14)
    expect(m.forecast.every((f) => f.due === 0)).toBe(true)
    expect(m.hardest).toEqual([])
    expect(m.daily.size).toBe(0)
    expect(buildHeatmap(m.daily, NOW).total).toBe(0)
  })

  it('summarises a seeded history', () => {
    const events = seededEvents()
    const m = buildStatsModel({ derived: buildDerived(events), events, words, now: NOW })
    const reviews = events.filter((e) => e.kind === 'review')
    expect(m.empty).toBe(false)
    expect(m.totalGradings).toBe(reviews.length + 1) // + one "known"
    expect(m.introduced).toBe(3)
    expect(m.known).toBeGreaterThanOrEqual(1) // 我 (known) has graduated
    expect(m.known).toBeLessThan(3) // 是 is still learning
    expect(m.reviewsToday).toBe(2)
    expect(m.streak).toEqual({ days: 3, studiedToday: true })
    expect(m.timeTodayMs).toBe(60_000 + 8_000) // per-review cap at 60 s
    expect(m.accuracy.total).toBe(reviews.length)
    expect(m.accuracy.correct).toBe(reviews.filter((e) => e.kind === 'review' && e.grade !== 'again').length)
    expect(m.accuracyByDir.listen.total + m.accuracyByDir.say.total).toBe(reviews.length)
    expect(m.flags).toEqual({ open: 1, words: 1 })
    expect(m.progress.listen.unseen).toBe(0)
    expect(m.progress.listen.learning).toBe(1) // 是
    expect(m.progress.say.unseen).toBe(1) // 是 has no say card yet

    // Hardest: 你 has lapses; 是 has misses only.
    expect(m.hardest.map((h) => h.word.id)).toEqual(['w4f60', 'w662f'])
    expect(m.hardest[0].lapses).toBeGreaterThanOrEqual(1)
    expect(m.hardest[1]).toMatchObject({ lapses: 0, misses: 3, reviews: 4 })

    // Forecast: overdue/learning cards land in day 0; everything introduced is somewhere or later.
    expect(m.forecast[0].label).toBe('Today')
    expect(m.forecast[1].long).toBe('Tomorrow')
    expect(m.forecast[0].key).toBe(dayKey(NOW))
  })

  it('uses weekly accuracy for long histories and daily points for short ones', () => {
    const events = seededEvents()
    const weekly = buildAccuracySeries(events, NOW)
    expect(weekly.granularity).toBe('week')
    expect(weekly.points[0].key).toBe(dayKey(mondayOf(NOW - 42 * 86_400_000)))
    expect(weekly.points.at(-1)!.key).toBe(dayKey(mondayOf(NOW)))
    // Pooled counts add up.
    const n = weekly.points.reduce((s, p) => s + p.listenN + p.sayN, 0)
    expect(n).toBe(events.filter((e) => e.kind === 'review').length)

    const recent = [
      makeReview({ wordId: 'w4f60', dir: 'listen', grade: 'again', ts: NOW - 2 * 86_400_000, deviceId: 'd' }),
      makeReview({ wordId: 'w4f60', dir: 'listen', grade: 'good', ts: NOW - 2 * 86_400_000 + 1, deviceId: 'd' }),
      makeReview({ wordId: 'w4f60', dir: 'say', grade: 'good', ts: NOW, deviceId: 'd' }),
    ]
    const daily = buildAccuracySeries(recent, NOW)
    expect(daily.granularity).toBe('day')
    expect(daily.points).toHaveLength(3)
    expect(daily.points[0]).toMatchObject({ listen: 50, say: null, listenN: 2, listenC: 1 })
    expect(daily.points[1]).toMatchObject({ listen: null, say: null })
    expect(daily.points[2]).toMatchObject({ listen: null, say: 100 })
  })

  it('builds a Monday-first heatmap ending this week, with levels relative to the history', () => {
    const daily = new Map([
      [dayKey(NOW), 5],
      [dayKey(addDays(NOW, -1)), 40],
      [dayKey(addDays(NOW, -400)), 999], // out of range: ignored
    ])
    const h = buildHeatmap(daily, NOW, 10)
    expect(h.weeks).toHaveLength(10)
    expect(h.weeks.every((w) => w.length === 7)).toBe(true)
    expect(new Date(h.weeks[0][0].ts).getDay()).toBe(1) // Monday
    const cells = h.weeks.flat()
    expect(cells.filter((c) => c.today)).toHaveLength(1)
    expect(cells.find((c) => c.today)!.count).toBe(5)
    expect(h.total).toBe(45)
    expect(h.activeDays).toBe(2)
    expect(h.best).toMatchObject({ count: 40 })
    expect(cells.find((c) => c.count === 40)!.level).toBe(4)
    expect(cells.every((c) => c.count > 0 || c.level === 0)).toBe(true)
    expect(cells.some((c) => c.ts > NOW)).toBe(false) // NOW is a Sunday
    expect(h.months.length).toBeGreaterThanOrEqual(2)

    // Mid-week: the rest of the week is marked as future.
    const wed = new Date(2026, 9, 7, 12).getTime()
    const hw = buildHeatmap(new Map(), wed, 4)
    expect(hw.weeks[3].filter((c) => c.future)).toHaveLength(4)
  })

  it('heat thresholds are monotone and robust to one outlier day', () => {
    expect(heatThresholds([])).toEqual([1, 2, 3, 4])
    const t = heatThresholds([10, 12, 15, 20, 20, 22, 25, 30, 30, 500])
    expect(t[0]).toBeLessThan(t[1])
    expect(t[1]).toBeLessThan(t[2])
    expect(t[2]).toBeLessThan(t[3])
    expect(t[3]).toBeLessThan(500)
    expect(heatLevel(0, t)).toBe(0)
    expect(heatLevel(1, t)).toBe(1)
    expect(heatLevel(500, t)).toBe(4)
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(20_000)).toBe('<1 min')
    expect(formatDuration(12 * 60_000)).toBe('12 min')
    expect(formatDuration(60 * 60_000)).toBe('1 h')
    expect(formatDuration(65 * 60_000)).toBe('1 h 5 min')
  })
})
