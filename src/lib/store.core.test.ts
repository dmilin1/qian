// Review fixes (core): undo scope, day offset, multi-tab sync, and failed writes during import/reset.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeWords } from './__fixtures__/words'
import * as db from './db'
import { makeReview, makeSuspend, type AppEvent } from './events'
import { buildExport, serializeExport } from './exportImport'
import { defaultDayOffsetMs } from './fsrs'
import { mulberry32 } from './scheduler'
import { DEFAULT_SETTINGS } from './settings'
import { createAppStore, type AppStore, type StoreOptions } from './store'
import { createWordIndex } from './words'

vi.mock('./db', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./db')>()
  return {
    ...orig,
    openQianDb: vi.fn(orig.openQianDb),
    putEvents: vi.fn(orig.putEvents),
    replaceEvents: vi.fn(orig.replaceEvents),
    clearAll: vi.fn(orig.clearAll),
  }
})

const T0 = Date.UTC(2026, 3, 1, 9)
const words = createWordIndex(makeWords(30))

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

let n = 0
const stores: AppStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose()
  vi.mocked(db.openQianDb).mockReset().mockImplementation(realDb.openQianDb)
  vi.mocked(db.putEvents).mockReset().mockImplementation(realDb.putEvents)
  vi.mocked(db.replaceEvents).mockReset().mockImplementation(realDb.replaceEvents)
  vi.mocked(db.clearAll).mockReset().mockImplementation(realDb.clearAll)
})
const realDb = await vi.importActual<typeof import('./db')>('./db')

function setup(over: Partial<StoreOptions> = {}) {
  const clock = { t: T0 }
  const opts: StoreOptions = {
    dbName: `qian-core-${Date.now()}-${n++}`,
    words,
    now: () => clock.t,
    rng: mulberry32(1),
    storage: memoryStorage(),
    storageManager: null,
    ...over,
  }
  const store = createAppStore(opts)
  stores.push(store)
  return { store, clock, opts }
}

function reopen(opts: StoreOptions) {
  const s = createAppStore({ ...opts, rng: mulberry32(9) })
  stores.push(s)
  return s
}

const backup = (events: AppEvent[], settings = DEFAULT_SETTINGS) => serializeExport(buildExport(events, { ...settings }, 'other', T0))

describe('undo', () => {
  it('only reaches answers from this session, and is off right after a suspend', async () => {
    const { store, clock, opts } = setup()
    await store.init()
    await store.grade('wt1:listen', 'good')
    clock.t += 5000
    await store.grade(store.getSnapshot().current!.key, 'good')
    expect(store.getSnapshot().canUndo).toBe(true)

    // Suspend the card on screen: Undo would otherwise rewind the previous card's answer.
    await store.setSuspended(store.getSnapshot().current!.wordId, true)
    expect(store.getSnapshot().canUndo).toBe(false)
    expect(await store.undo()).toBeNull()
    clock.t += 5000
    await store.grade(store.getSnapshot().current!.key, 'again')
    expect(store.getSnapshot().canUndo).toBe(true)
    store.dispose()

    // A new session never undoes yesterday's answers.
    const reloaded = reopen(opts)
    await reloaded.init()
    expect(reloaded.getSnapshot().events.length).toBe(4)
    expect(reloaded.getSnapshot().canUndo).toBe(false)
    expect(await reloaded.undo()).toBeNull()
    expect(reloaded.getSnapshot().events.length).toBe(4)
  })

  it('walks back through this session in order', async () => {
    const { store, clock } = setup()
    await store.init()
    await store.grade('wt1:listen', 'good')
    clock.t += 5000
    await store.grade('wt2:listen', 'again')
    expect((await store.undo())?.wordId).toBe('wt2')
    expect(store.getSnapshot().current?.key).toBe('wt2:listen')
    expect((await store.undo())?.wordId).toBe('wt1')
    expect(store.getSnapshot().canUndo).toBe(false)
    expect(await store.undo()).toBeNull()
  })

  it('does not put a suspended word back on screen', async () => {
    const { store, clock } = setup()
    await store.init()
    await store.grade('wt1:listen', 'good')
    clock.t += 5000
    // wt1 gets suspended elsewhere (another device's backup).
    await store.importData(backup([makeSuspend({ wordId: 'wt1', suspended: true, ts: clock.t, deviceId: 'other' })]))
    expect((await store.undo())?.wordId).toBe('wt1')
    expect(store.getSnapshot().current?.wordId).not.toBe('wt1')
  })
})

describe('day boundary offset', () => {
  it('is captured once per device and kept in IndexedDB', async () => {
    const a = setup()
    await a.store.init()
    expect(a.store.getSnapshot().derived.dayOffsetMs).toBe(defaultDayOffsetMs())
    const conn = await db.openQianDb(a.opts.dbName)
    expect(await db.getMeta(conn, 'dayOffsetMs')).toBe(defaultDayOffsetMs())
    // A stored value wins over the current timezone (DST, travel), so replay stays the same.
    await db.setMeta(conn, 'dayOffsetMs', 12_345)
    conn.close()
    a.store.dispose()
    const b = reopen(a.opts)
    await b.init()
    expect(b.getSnapshot().derived.dayOffsetMs).toBe(12_345)
    await b.grade('wt1:listen', 'good')
    await b.resetAll()
    expect(b.getSnapshot().derived.dayOffsetMs).toBe(12_345)
  })
})

describe('several tabs', () => {
  it('a stale tab exports the full log; a reset in one tab clears the others', async () => {
    const a = setup()
    await a.store.init()
    const b = reopen(a.opts)
    await b.init()
    await a.store.grade('wt1:listen', 'good')

    const exported = JSON.parse((await b.exportData({ record: false })).text) as { events: AppEvent[] }
    expect(exported.events.map((e) => e.wordId)).toEqual(['wt1'])
    await vi.waitFor(() => expect(b.getSnapshot().events.length).toBe(1))

    await a.store.resetAll(true)
    await vi.waitFor(() => expect(b.getSnapshot().events.length).toBe(0))
    expect(b.getSnapshot().derived.cards.size).toBe(0)
    expect(b.getSnapshot().current?.key).toBe('wt1:listen')
  })

  it('picks up other tabs\' changes when the page becomes visible again', async () => {
    const a = setup()
    await a.store.init()
    const b = reopen(a.opts)
    await b.init()
    b.updateSettings({ theme: 'dark' }) // same storage: localStorage is shared between tabs
    // Write directly, as a tab without BroadcastChannel would.
    const conn = await db.openQianDb(a.opts.dbName)
    await realDb.putEvents(conn, [makeReview({ wordId: 'wt3', dir: 'listen', grade: 'good', ts: T0, deviceId: 'x' })])
    conn.close()
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(a.store.getSnapshot().events.length).toBe(1))
    expect(a.store.getSnapshot().settings.theme).toBe('dark')
  })
})

describe('failed writes', () => {
  it('a merge import that cannot be saved throws and changes nothing', async () => {
    const { store, opts } = setup()
    await store.init()
    await store.grade('wt1:listen', 'good')
    vi.mocked(db.putEvents).mockRejectedValueOnce(new Error('QuotaExceededError'))
    const file = backup([makeReview({ wordId: 'wt5', dir: 'listen', grade: 'good', ts: T0, deviceId: 'other' })])
    await expect(store.importData(file)).rejects.toThrow(/could not be saved/)
    expect(store.getSnapshot().events.map((e) => e.wordId)).toEqual(['wt1'])
    expect(store.getSnapshot().error).toBeNull()
    store.dispose()
    const reloaded = reopen(opts)
    await reloaded.init()
    expect(reloaded.getSnapshot().events.length).toBe(1)
  })

  it('a replace import that cannot be saved keeps the old settings and log', async () => {
    const { store, opts } = setup()
    await store.init()
    await store.grade('wt1:listen', 'good')
    vi.mocked(db.replaceEvents).mockRejectedValueOnce(new Error('AbortError'))
    const file = backup([makeReview({ wordId: 'wt5', dir: 'listen', grade: 'good', ts: T0, deviceId: 'other' })], { ...DEFAULT_SETTINGS, theme: 'dark' })
    await expect(store.importData(file, 'replace')).rejects.toThrow(/could not be saved/)
    expect(store.getSnapshot().settings.theme).toBe('system')
    expect(opts.storage!.getItem('qian.settings')).toBeNull()
    expect(store.getSnapshot().events.map((e) => e.wordId)).toEqual(['wt1'])
  })

  it('a reset that cannot be saved throws and keeps the progress', async () => {
    const { store } = setup()
    await store.init()
    await store.grade('wt1:listen', 'good')
    vi.mocked(db.clearAll).mockRejectedValueOnce(new Error('AbortError'))
    await expect(store.resetAll()).rejects.toThrow(/nothing was changed/)
    expect(store.getSnapshot().events.length).toBe(1)
    // The caller (Settings) shows the thrown message; no misleading "could not save progress" banner.
    expect(store.getSnapshot().error).toBeNull()
  })

  it('in memory (no IndexedDB), import and reset still succeed', async () => {
    const { store } = setup({ inMemory: true })
    await store.init()
    const sum = await store.importData(backup([makeReview({ wordId: 'wt5', dir: 'listen', grade: 'good', ts: T0, deviceId: 'other' })]))
    expect(sum.added).toBe(1)
    await store.resetAll()
    expect(store.getSnapshot().events.length).toBe(0)
  })
})

describe('final review fixes', () => {
  it('concurrent init() calls (StrictMode) open one database', async () => {
    const { store } = setup()
    vi.mocked(db.openQianDb).mockClear()
    await Promise.all([store.init(), store.init()])
    expect(db.openQianDb).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().ready).toBe(true)
  })

  it('settings that could not be saved are not reverted when the page comes back', async () => {
    const storage = memoryStorage()
    const { store } = setup({ storage })
    await store.init()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    store.updateSettings({ listenFront: 'audioOnly' })
    expect(store.getSnapshot().error).toMatch(/Settings could not be saved/)
    window.dispatchEvent(new Event('focus'))
    await new Promise((r) => setTimeout(r, 50))
    expect(store.getSnapshot().settings.listenFront).toBe('audioOnly')
  })

  it('answers whose write failed are written on resume, and the error clears', async () => {
    const { store, clock, opts } = setup()
    await store.init()
    vi.mocked(db.putEvents).mockRejectedValue(new Error('UnknownError'))
    for (let i = 0; i < 3; i++) {
      await store.grade(store.getSnapshot().current!.key, 'good')
      clock.t += 5000
    }
    expect(store.getSnapshot().error).toMatch(/Could not save progress/)
    vi.mocked(db.putEvents).mockImplementation(realDb.putEvents)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(store.getSnapshot().error).toBeNull())
    store.dispose()
    const reloaded = reopen(opts)
    await reloaded.init()
    expect(reloaded.getSnapshot().events.length).toBe(3)
  })

  it('reopens a lost database connection and saves the answer', async () => {
    const { store, opts } = setup()
    await store.init()
    const conn = await vi.mocked(db.openQianDb).mock.results[0].value
    conn.close() // like iOS dropping the connection while the app was in the background
    await store.grade('wt1:listen', 'good')
    expect(db.openQianDb).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot().error).toBeNull()
    store.dispose()
    const reloaded = reopen(opts)
    await reloaded.init()
    expect(reloaded.getSnapshot().events.map((e) => e.wordId)).toEqual(['wt1'])
  })
})
