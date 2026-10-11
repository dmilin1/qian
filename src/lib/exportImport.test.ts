import { describe, expect, it } from 'vitest'
import { buildDerived } from './derive'
import { DATA_SCHEMA_VERSION } from './db'
import { makeFlag, makeKnown, makeReview, makeSuspend, type AppEvent } from './events'
import { buildExport, exportFileName, flagsToCsv, ImportError, mergeEvents, parseImport, serializeExport } from './exportImport'
import { DEFAULT_SETTINGS } from './settings'

const T0 = Date.UTC(2026, 2, 1, 10)
const MIN = 60_000

function deviceLog(deviceId: string, start: number, words: string[]): AppEvent[] {
  return words.flatMap((w, i) => [
    makeReview({ wordId: w, dir: 'listen', grade: 'good', ts: start + i * MIN, deviceId, elapsedMs: 4000 }),
    makeReview({ wordId: w, dir: 'listen', grade: 'good', ts: start + i * MIN + 11 * MIN, deviceId }),
  ])
}

const stateOf = (events: AppEvent[]) => {
  const d = buildDerived(events)
  return JSON.stringify([...d.cards.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
}

describe('export / import', () => {
  it('round trips', () => {
    const events = [
      ...deviceLog('A', T0, ['w1', 'w2']),
      makeKnown({ wordId: 'w3', ts: T0, deviceId: 'A' }),
      makeSuspend({ wordId: 'w4', suspended: true, ts: T0, deviceId: 'A' }),
      makeFlag({ wordId: 'w1', reason: 'audio', note: 'clipped', ts: T0, deviceId: 'A' }),
    ]
    const settings = { ...DEFAULT_SETTINGS, listenFront: 'audioOnly' as const }
    const file = buildExport(events, settings, 'A', T0)
    expect(file).toMatchObject({ app: 'qian', schemaVersion: DATA_SCHEMA_VERSION, deviceId: 'A', exportedAt: new Date(T0).toISOString() })
    const parsed = parseImport(serializeExport(file))
    expect(parsed.skipped).toBe(0)
    expect(parsed.file.settings).toEqual(settings)
    const byId = (xs: AppEvent[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1))
    expect(byId(parsed.file.events)).toEqual(byId(events))
    expect(stateOf(parsed.file.events)).toBe(stateOf(events))
    expect(exportFileName(T0)).toMatch(/^qian-backup-\d{4}-\d\d-\d\d\.json$/)
  })

  it('merges two devices with overlap; result is order independent and equals the union', () => {
    const shared = deviceLog('A', T0, ['w1', 'w2'])
    const a = [...shared, ...deviceLog('A', T0 + 60 * MIN, ['w3'])]
    const b = [...shared, ...deviceLog('B', T0 + 30 * MIN, ['w4', 'w1'])]
    const ab = mergeEvents(a, b)
    const ba = mergeEvents(b, a)
    expect(ab.events.length).toBe(shared.length + 2 + 4)
    expect(ab.duplicates).toBe(shared.length)
    expect(ab.added.length).toBe(4)
    expect(ab.events.map((e) => e.id)).toEqual(ba.events.map((e) => e.id))
    expect(stateOf(ab.events)).toBe(stateOf([...a, ...b]))
    // Merging again is a no-op.
    const again = mergeEvents(ab.events, b)
    expect(again.added).toEqual([])
    expect(again.events.length).toBe(ab.events.length)
  })

  it('never loses local events and keeps the local copy on id collision', () => {
    const local = deviceLog('A', T0, ['w1'])
    const tampered = { ...local[0], grade: 'again' as const }
    const r = mergeEvents(local, [tampered])
    expect(r.events.find((e) => e.id === local[0].id)).toEqual(local[0])
    expect(r.events.length).toBe(local.length)
    expect(mergeEvents(local, []).events.length).toBe(local.length)
  })

  it('handles duplicate events inside one file', () => {
    const evs = deviceLog('A', T0, ['w1'])
    const file = buildExport([...evs, ...evs, evs[0]], DEFAULT_SETTINGS, 'A', T0)
    const parsed = parseImport(serializeExport(file))
    const merged = mergeEvents([], parsed.file.events)
    expect(merged.events.length).toBe(evs.length)
    expect(stateOf(merged.events)).toBe(stateOf(evs))
  })

  it('handles out-of-order timestamps (replay sorts by ts, id)', () => {
    const evs = deviceLog('A', T0, ['w1', 'w2', 'w3'])
    const scrambled = [evs[5], evs[0], evs[3], evs[1], evs[4], evs[2]]
    const parsed = parseImport(JSON.stringify({ app: 'qian', schemaVersion: 1, exportedAt: '', deviceId: 'A', settings: {}, events: scrambled }))
    expect(stateOf(mergeEvents([], parsed.file.events).events)).toBe(stateOf(evs))
    expect(mergeEvents([], scrambled).events.map((e) => e.ts)).toEqual([...evs.map((e) => e.ts)].sort((x, y) => x - y))
  })

  it('rejects invalid files', () => {
    expect(() => parseImport('not json')).toThrow(ImportError)
    expect(() => parseImport('[]')).toThrow(/not a qian backup/)
    expect(() => parseImport({ app: 'anki', schemaVersion: 1, events: [] })).toThrow(/not a qian backup/)
    expect(() => parseImport({ app: 'qian', events: [] })).toThrow(/schema version/)
    expect(() => parseImport({ app: 'qian', schemaVersion: 1 })).toThrow(/event list/)
    expect(() => parseImport(null)).toThrow(ImportError)
  })

  it('rejects files from a future schema version', () => {
    expect(() => parseImport({ app: 'qian', schemaVersion: DATA_SCHEMA_VERSION + 1, events: [] })).toThrow(/newer version/)
  })

  it('skips individual malformed events and fills settings with defaults', () => {
    const good = makeKnown({ wordId: 'w1', ts: T0, deviceId: 'A' })
    const parsed = parseImport({
      app: 'qian',
      schemaVersion: 1,
      settings: { workingSetCap: 'lots', theme: 'dark' },
      events: [good, { id: 'x', kind: 'review', wordId: 'w1', ts: T0, deviceId: 'A', dir: 'up', grade: 'good' }, 42],
    })
    expect(parsed.skipped).toBe(2)
    expect(parsed.file.events).toEqual([good])
    expect(parsed.file.settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })
})

describe('flagsToCsv', () => {
  it('lists flags with word info and escapes fields', () => {
    const csv = flagsToCsv(
      [{ id: '1', wordId: 'w1', reason: 'audio', note: 'says "shi", not "si"', ts: T0, resolved: false }],
      () => ({ trad: '是', pinyin: 'shì', gloss: 'to be, yes' }),
    )
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('wordId,trad,pinyin,gloss,reason,note,flaggedAt,resolved')
    expect(lines[1]).toBe(`w1,是,shì,"to be, yes",audio,"says ""shi"", not ""si""",${new Date(T0).toISOString()},no`)
  })
})
