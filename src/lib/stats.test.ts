import { describe, expect, it } from 'vitest'
import { buildDerived } from './derive'
import { makeKnown, makeReview, makeSuspend, type AppEvent } from './events'
import {
  accuracyByWeek,
  cardStatus,
  dailyReviewCounts,
  dailyTimeStudiedMs,
  dayKey,
  forecast,
  progressCounts,
  streak,
  timeStudiedMs,
  weekStartKey,
  wordHistory,
  wordStatus,
  wordSummary,
} from './stats'

// Local-time dates (stats use local calendar days).
const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const MIN = 60_000
const dev = 'd'
const rev = (wordId: string, dir: 'listen' | 'say', grade: 'again' | 'good' | 'easy', ts: number, elapsedMs?: number) =>
  makeReview({ wordId, dir, grade, ts, deviceId: dev, elapsedMs })

describe('stats', () => {
  it('card and word status', () => {
    const d = buildDerived([
      rev('w1', 'listen', 'good', at(2026, 3, 2)), // learning
      makeKnown({ wordId: 'w2', ts: at(2026, 3, 2), deviceId: dev }), // young (S ~ 8d)
    ])
    expect(cardStatus(undefined)).toBe('unseen')
    expect(cardStatus(d.cards.get('w1:listen'))).toBe('learning')
    expect(cardStatus(d.cards.get('w2:listen'))).toBe('young')
    expect(wordStatus(d, 'w1')).toBe('learning')
    expect(wordStatus(d, 'w2')).toBe('young')
    expect(wordStatus(d, 'w3')).toBe('unseen')
  })

  it('mature after long successful intervals', () => {
    let ts = at(2026, 1, 1)
    const evs: AppEvent[] = [makeKnown({ wordId: 'w1', ts, deviceId: dev })]
    for (let i = 0; i < 3; i++) {
      ts += 40 * 86_400_000
      evs.push(rev('w1', 'listen', 'good', ts), rev('w1', 'say', 'good', ts + 1))
    }
    const d = buildDerived(evs)
    expect(cardStatus(d.cards.get('w1:listen'))).toBe('mature')
    expect(wordStatus(d, 'w1')).toBe('mature')
  })

  it('progress counts per direction and per word, with suspended separate', () => {
    const d = buildDerived([
      rev('w1', 'listen', 'good', at(2026, 3, 2)),
      makeKnown({ wordId: 'w2', ts: at(2026, 3, 2), deviceId: dev }),
      makeSuspend({ wordId: 'w3', suspended: true, ts: at(2026, 3, 2), deviceId: dev }),
    ])
    const c = progressCounts(d, ['w1', 'w2', 'w3', 'w4'])
    expect(c.listen).toEqual({ unseen: 1, learning: 1, young: 1, mature: 0, suspended: 1 })
    expect(c.say).toEqual({ unseen: 2, learning: 0, young: 1, mature: 0, suspended: 1 })
    expect(c.words).toEqual({ unseen: 1, learning: 1, young: 1, mature: 0, suspended: 1 })
  })

  it('daily counts and streak (today counts if studied, else from yesterday)', () => {
    const evs = [
      rev('w1', 'listen', 'good', at(2026, 3, 1, 23, 59)),
      rev('w1', 'listen', 'good', at(2026, 3, 2, 0, 1)),
      rev('w1', 'listen', 'good', at(2026, 3, 3)),
      makeKnown({ wordId: 'w2', ts: at(2026, 3, 3), deviceId: dev }),
      rev('w1', 'listen', 'good', at(2026, 3, 5)),
      makeSuspend({ wordId: 'w1', suspended: true, ts: at(2026, 3, 4), deviceId: dev }),
    ]
    const daily = dailyReviewCounts(evs)
    expect(daily.get('2026-03-01')).toBe(1)
    expect(daily.get('2026-03-02')).toBe(1)
    expect(daily.get('2026-03-03')).toBe(2)
    expect(daily.has('2026-03-04')).toBe(false)
    expect(streak(daily, at(2026, 3, 5, 20))).toEqual({ days: 1, studiedToday: true })
    expect(streak(daily, at(2026, 3, 4, 20))).toEqual({ days: 3, studiedToday: false })
    expect(streak(daily, at(2026, 3, 3, 8))).toEqual({ days: 3, studiedToday: true })
    expect(streak(daily, at(2026, 3, 7))).toEqual({ days: 0, studiedToday: false })
  })

  it('weekly accuracy per direction', () => {
    expect(weekStartKey(at(2026, 3, 4))).toBe('2026-03-02') // Wednesday -> Monday
    expect(weekStartKey(at(2026, 3, 8))).toBe('2026-03-02') // Sunday -> Monday
    const evs = [
      rev('w1', 'listen', 'good', at(2026, 3, 2)),
      rev('w1', 'listen', 'again', at(2026, 3, 3)),
      rev('w1', 'say', 'easy', at(2026, 3, 4)),
      rev('w1', 'say', 'again', at(2026, 3, 10)),
      makeKnown({ wordId: 'w2', ts: at(2026, 3, 3), deviceId: dev }),
    ]
    expect(accuracyByWeek(evs)).toEqual([
      { weekStart: '2026-03-02', listen: { total: 2, correct: 1 }, say: { total: 1, correct: 1 } },
      { weekStart: '2026-03-09', listen: { total: 0, correct: 0 }, say: { total: 1, correct: 0 } },
    ])
  })

  it('time studied caps each review at 60 s', () => {
    const evs = [
      rev('w1', 'listen', 'good', at(2026, 3, 2), 5000),
      rev('w1', 'listen', 'good', at(2026, 3, 2, 11), 600_000),
      rev('w1', 'listen', 'good', at(2026, 3, 3)),
    ]
    expect(timeStudiedMs(evs)).toBe(65_000)
    expect(timeStudiedMs(evs, at(2026, 3, 2, 10, 30))).toBe(60_000)
    expect(dailyTimeStudiedMs(evs).get('2026-03-02')).toBe(65_000)
  })

  it('forecast buckets due cards by day, overdue on day 0', () => {
    const t = at(2026, 3, 2, 9)
    const d = buildDerived([
      makeKnown({ wordId: 'w1', ts: t - 30 * 86_400_000, deviceId: dev }), // overdue x2
      rev('w2', 'listen', 'good', t), // learning, due in 10 min (today)
      makeKnown({ wordId: 'w3', ts: t, deviceId: dev }), // ~8 days out x2
    ])
    const f = forecast(d, t, 14)
    expect(f.length).toBe(14)
    expect(f[0]).toEqual({ day: dayKey(t), due: 3 })
    expect(f.reduce((a, x) => a + x.due, 0)).toBe(5)
    expect(f.slice(1).findIndex((x) => x.due === 2)).toBeGreaterThan(3)
  })

  it('per-word history and summary', () => {
    const t = at(2026, 3, 2)
    const d = buildDerived([
      rev('w1', 'listen', 'good', t + MIN),
      rev('w1', 'listen', 'again', t),
      rev('w2', 'listen', 'good', t),
    ])
    const h = wordHistory(d, 'w1')
    expect(h.map((x) => x.grade)).toEqual(['again', 'good'])
    expect(h[0].dir).toBe('listen')
    const s = wordSummary(d, 'w1')
    expect(s).toMatchObject({ wordId: 'w1', reviews: 2, lastReviewTs: t + MIN, suspended: false, status: 'learning' })
    expect(wordHistory(d, 'nope')).toEqual([])
  })
})
