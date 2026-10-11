import { describe, expect, it } from 'vitest'
import { FIXTURE_WORDS } from '../../lib/__fixtures__/words'
import { createWordIndex } from '../../lib/words'
import { makeTestStore } from '../../components/test-utils'
import { predictNextWordIds } from './predictNext'
import { formatWhen } from './time'

describe('formatWhen', () => {
  const now = new Date(2026, 9, 11, 10, 0, 0).getTime()
  it('uses minutes, hours, tomorrow, weekday and days', () => {
    expect(formatWhen(now + 20_000, now)).toBe('in under a minute')
    expect(formatWhen(now + 8 * 60_000, now)).toBe('in 8 min')
    expect(formatWhen(now + 3 * 3600_000, now)).toMatch(/^in 3 h \(at .+\)$/)
    expect(formatWhen(new Date(2026, 9, 12, 9, 0).getTime(), now)).toMatch(/^tomorrow at /)
    expect(formatWhen(new Date(2026, 9, 14, 9, 0).getTime(), now)).toMatch(/^on \w+/)
    expect(formatWhen(new Date(2026, 9, 25, 9, 0).getTime(), now)).toBe('in 14 days')
  })
})

describe('predictNextWordIds', () => {
  it('predicts the next new word without touching the store', async () => {
    const store = makeTestStore()
    await store.init()
    const before = store.getSnapshot()
    expect(before.current?.wordId).toBe('w4f60')
    const ids = predictNextWordIds(before, createWordIndex(FIXTURE_WORDS))
    expect(ids).toContain('w6211')
    expect(ids).not.toContain('w4f60')
    expect(store.getSnapshot()).toBe(before)
    expect(before.events).toHaveLength(0)
  })

  it('returns nothing when caught up', () => {
    const store = makeTestStore()
    expect(predictNextWordIds(store.getSnapshot(), createWordIndex(FIXTURE_WORDS))).toEqual([])
  })
})
