import { afterEach, describe, expect, it } from 'vitest'
import { makeWords } from './__fixtures__/words'
import { buildDerived } from './derive'
import { mulberry32 } from './scheduler'
import { createAppStore, type AppStore, type StoreOptions } from './store'
import { DEFAULT_SETTINGS } from './settings'
import { createWordIndex } from './words'
import { ImportError } from './exportImport'

const T0 = Date.UTC(2026, 3, 1, 9)
const MIN = 60_000
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
})

function setup(over: Partial<StoreOptions> = {}) {
  const clock = { t: T0 }
  const persistCalls: number[] = []
  const storageManager = {
    persisted: async () => false,
    persist: async () => {
      persistCalls.push(1)
      return true
    },
  } as unknown as StorageManager
  const opts: StoreOptions = {
    dbName: `qian-store-${Date.now()}-${n++}`,
    words,
    now: () => clock.t,
    rng: mulberry32(1),
    storage: memoryStorage(),
    storageManager,
    ...over,
  }
  const store = createAppStore(opts)
  stores.push(store)
  return { store, clock, opts, persistCalls }
}

describe('app store', () => {
  it('initializes and offers the first word with "I already know this"', async () => {
    const { store } = setup()
    expect(store.getSnapshot().ready).toBe(false)
    await store.init()
    const s = store.getSnapshot()
    expect(s.ready).toBe(true)
    expect(s.error).toBeNull()
    expect(s.deviceId).toMatch(/[0-9a-f-]{36}/)
    expect(s.current).toMatchObject({ key: 'wt1:listen', isNew: true, canMarkKnown: true })
    expect(s.current!.word.gloss).toBe('word 1')
    expect(s.current!.previews.good.label).toBe('10m')
    expect(store.getSnapshot()).toBe(s) // stable snapshot between changes
  })

  it('grade persists, advances, and notifies subscribers; state survives reload', async () => {
    const { store, clock, opts, persistCalls } = setup()
    await store.init()
    let calls = 0
    const unsub = store.subscribe(() => calls++)
    await store.grade('wt1:listen', 'good', 4200)
    expect(calls).toBeGreaterThan(0)
    unsub()
    const s = store.getSnapshot()
    expect(s.events.length).toBe(1)
    expect(s.events[0]).toMatchObject({ kind: 'review', wordId: 'wt1', dir: 'listen', grade: 'good', elapsedMs: 4200, deviceId: s.deviceId })
    expect(s.current?.key).toBe('wt2:listen')
    expect(s.canUndo).toBe(true)
    expect(persistCalls.length).toBe(1)
    expect(s.persistence).toBe('granted')
    clock.t += 30_000
    await store.grade(s.current!.key, 'again')
    store.dispose()

    const reloaded = createAppStore({ ...opts, rng: mulberry32(2) })
    stores.push(reloaded)
    await reloaded.init()
    const r = reloaded.getSnapshot()
    expect(r.events.length).toBe(2)
    expect(r.deviceId).toBe(s.deviceId)
    expect(JSON.stringify([...r.derived.cards])).toBe(JSON.stringify([...buildDerived(r.events).cards]))
  })

  it('markKnown schedules both cards; undo removes it and shows the card again', async () => {
    const { store, opts } = setup()
    await store.init()
    await store.markKnown('wt1')
    let s = store.getSnapshot()
    expect(s.derived.cards.get('wt1:listen')?.lastGrade).toBe('easy')
    expect(s.derived.cards.get('wt1:say')?.lastGrade).toBe('easy')
    expect(s.current?.key).toBe('wt2:listen')
    const undone = await store.undo()
    expect(undone?.kind).toBe('known')
    s = store.getSnapshot()
    expect(s.events.length).toBe(0)
    expect(s.derived.cards.size).toBe(0)
    expect(s.current).toMatchObject({ key: 'wt1:listen', canMarkKnown: true })
    expect(s.canUndo).toBe(false)
    expect(await store.undo()).toBeNull()
    store.dispose()
    const reloaded = createAppStore(opts)
    stores.push(reloaded)
    await reloaded.init()
    expect(reloaded.getSnapshot().events.length).toBe(0)
  })

  it('undo only removes this device\'s events', async () => {
    const { store, clock } = setup()
    await store.init()
    await store.grade('wt1:listen', 'good')
    clock.t += MIN
    const other = { app: 'qian', schemaVersion: 1, events: [{ id: 'other-1', kind: 'review', wordId: 'wt5', dir: 'listen', grade: 'good', ts: clock.t, deviceId: 'other' }] }
    await store.importData(JSON.stringify(other))
    const undone = await store.undo()
    expect(undone?.wordId).toBe('wt1')
    expect(store.getSnapshot().events.map((e) => e.id)).toEqual(['other-1'])
  })

  it('suspend, flag and resolve', async () => {
    const { store } = setup()
    await store.init()
    await store.setSuspended('wt1', true)
    expect(store.getSnapshot().current?.key).toBe('wt2:listen')
    await store.flag('wt2', 'audio', 'robotic')
    let meta = store.getSnapshot().derived.words.get('wt2')
    expect(meta?.flags[0]).toMatchObject({ reason: 'audio', note: 'robotic', resolved: false })
    expect(store.getSnapshot().current?.key).toBe('wt2:listen') // flagging keeps the card
    await store.resolveFlag('wt2', 'audio')
    meta = store.getSnapshot().derived.words.get('wt2')
    expect(meta?.flags[0].resolved).toBe(true)
    await store.setSuspended('wt1', false)
    expect(store.getSnapshot().derived.words.get('wt1')?.suspended).toBeFalsy()
  })

  it('updateSettings validates, persists and rebuilds on retention change', async () => {
    const { store, opts } = setup()
    await store.init()
    await store.markKnown('wt1')
    const dueBefore = store.getSnapshot().derived.cards.get('wt1:listen')!.card.due.getTime()
    store.updateSettings({ requestRetention: 0.8, workingSetCap: 999 as number })
    const s = store.getSnapshot()
    expect(s.settings.requestRetention).toBe(0.8)
    expect(s.settings.workingSetCap).toBe(100)
    expect(s.derived.requestRetention).toBe(0.8)
    expect(s.derived.cards.get('wt1:listen')!.card.due.getTime()).toBeGreaterThan(dueBefore)
    expect(JSON.parse(opts.storage!.getItem('qian.settings')!).settings.requestRetention).toBe(0.8)
  })

  it('export -> import merge between devices, and replace mode', async () => {
    const a = setup()
    await a.store.init()
    await a.store.grade('wt1:listen', 'good')
    a.clock.t += 11 * MIN
    await a.store.grade('wt1:listen', 'good')
    const exported = await a.store.exportData()
    expect(exported.filename).toMatch(/^qian-backup-.*\.json$/)
    expect(a.store.getSnapshot().lastExportAt).toBe(a.clock.t)

    const b = setup()
    await b.store.init()
    await b.store.markKnown('wt1')
    await b.store.grade('wt2:listen', 'again')
    const sum1 = await b.store.importData(new Blob([exported.text]))
    expect(sum1).toMatchObject({ mode: 'merge', added: 2, duplicates: 0, skipped: 0, total: 4 })
    const sum2 = await b.store.importData(exported.text)
    expect(sum2).toMatchObject({ added: 0, duplicates: 2, total: 4 })
    const merged = b.store.getSnapshot()
    expect(JSON.stringify([...merged.derived.cards])).toBe(JSON.stringify([...buildDerived(merged.events).cards]))

    // Merge keeps local settings; replace adopts the file's settings and log.
    a.store.updateSettings({ theme: 'dark' })
    const exported2 = await a.store.exportData()
    await b.store.importData(exported2.text, 'merge')
    expect(b.store.getSnapshot().settings.theme).toBe('system')
    const rep = await b.store.importData(exported2.text, 'replace')
    expect(rep).toMatchObject({ mode: 'replace', total: 2 })
    expect(b.store.getSnapshot().settings.theme).toBe('dark')
    expect(b.store.getSnapshot().events.length).toBe(2)

    await expect(b.store.importData('{"app":"other"}')).rejects.toBeInstanceOf(ImportError)
    expect(b.store.getSnapshot().events.length).toBe(2)
  })

  it('caught up: null current with queue info, practice-ahead continues', async () => {
    const { store, clock } = setup()
    await store.init()
    store.updateSettings({ workingSetCap: 1 })
    await store.grade('wt1:listen', 'good')
    clock.t += 1000
    // Only one card exists and it was just shown: nothing to show until its 10 min step.
    store.next()
    let s = store.getSnapshot()
    expect(s.current).toBeNull()
    expect(s.queue.gateBlockedBy).toBe('workingSet')
    expect(s.queue.nextLearningDueAt).toBe(T0 + 10 * MIN)
    clock.t = T0 + 10 * MIN + 1
    store.next()
    expect(store.getSnapshot().current?.key).toBe('wt1:listen')
    await store.grade('wt1:listen', 'good') // graduates
    s = store.getSnapshot()
    // The say card is now eligible, but the working set (cap 1) is full.
    expect(s.current).toBeNull()
    store.setPracticeAhead(true)
    s = store.getSnapshot()
    expect(s.practiceAhead).toBe(true)
    expect(s.current).toBeNull() // the only card was just shown
  })

  it('resetAll wipes progress', async () => {
    const { store, opts } = setup()
    await store.init()
    await store.grade('wt1:listen', 'good')
    store.updateSettings({ theme: 'dark' })
    await store.resetAll(true)
    expect(store.getSnapshot().events.length).toBe(0)
    expect(store.getSnapshot().settings.theme).toBe('dark')
    await store.resetAll()
    expect(store.getSnapshot().settings).toEqual(DEFAULT_SETTINGS)
    store.dispose()
    const reloaded = createAppStore(opts)
    stores.push(reloaded)
    await reloaded.init()
    expect(reloaded.getSnapshot().events.length).toBe(0)
  })

  it('works in memory when IndexedDB is unavailable', async () => {
    const { store } = setup({ inMemory: true })
    await store.init()
    await store.grade('wt1:listen', 'good')
    expect(store.getSnapshot().events.length).toBe(1)
  })
})
