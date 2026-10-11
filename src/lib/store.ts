// App store: event log + derived state + settings + the current study card.
// Framework-free; React reads it via useSyncExternalStore (see useAppStore.ts).
import type { Word } from '../data/types'
import * as db from './db'
import { buildDerived, emptyDerived, withEvent, withoutEvent, type Derived } from './derive'
import {
  cardKey,
  compareEvents,
  makeFlag,
  makeKnown,
  makeReview,
  makeSuspend,
  parseCardKey,
  uuid,
  type AppEvent,
  type CardKey,
  type Dir,
  type FlagReason,
  type GradeName,
  type GradingEvent,
} from './events'
import {
  buildExport,
  exportFileName,
  mergeEvents,
  parseImport,
  readFileText,
  serializeExport,
  type ImportMode,
} from './exportImport'
import {
  previewIntervals,
  selectNext,
  type IntervalPreview,
  type PickSource,
  type QueueInfo,
  type Rng,
  type Selection,
} from './scheduler'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, validateSettings, type Settings } from './settings'
import { getWords, type WordIndex } from './words'

export type PersistStatus = 'unknown' | 'granted' | 'denied' | 'unsupported'

export interface StudyCard {
  key: CardKey
  wordId: string
  dir: Dir
  word: Word
  source: PickSource
  isNew: boolean
  /** Word's first appearance: show "I already know this". */
  canMarkKnown: boolean
  /** Button labels: previews.again.label etc. */
  previews: Record<GradeName, IntervalPreview>
  shownAt: number
}

export interface AppSnapshot {
  ready: boolean
  /** Non-fatal problem to show (e.g. storage unavailable, save failed). */
  error: string | null
  revision: number
  deviceId: string
  settings: Settings
  derived: Derived
  /** All events sorted by (ts, id). Treat as read-only. */
  events: readonly AppEvent[]
  /** Card being studied, or null when caught up (see `queue`). */
  current: StudyCard | null
  queue: QueueInfo
  practiceAhead: boolean
  canUndo: boolean
  persistence: PersistStatus
  lastExportAt: number | null
}

export interface ImportSummary {
  mode: ImportMode
  added: number
  duplicates: number
  skipped: number
  total: number
}

export interface StoreOptions {
  dbName?: string
  words?: WordIndex
  now?: () => number
  rng?: Rng
  storage?: Storage | null
  /** navigator.storage (injectable for tests); null disables persistence requests. */
  storageManager?: StorageManager | null
  /** Use only memory (no IndexedDB). */
  inMemory?: boolean
}

const EMPTY_QUEUE: QueueInfo = {
  unstableWords: 0,
  dueReviews: 0,
  learningDue: 0,
  learningPending: 0,
  introducedWords: 0,
  gateOpen: false,
  gateBlockedBy: null,
  nextLearningDueAt: null,
  nextReviewDueAt: null,
}

const MAX_TIMER_MS = 60 * 60 * 1000

function insertSorted(events: readonly AppEvent[], e: AppEvent): AppEvent[] {
  const out = events.slice()
  const last = out[out.length - 1]
  if (!last || compareEvents(last, e) < 0) {
    out.push(e)
    return out
  }
  let lo = 0
  let hi = out.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (compareEvents(out[mid], e) < 0) lo = mid + 1
    else hi = mid
  }
  out.splice(lo, 0, e)
  return out
}

export type AppStore = ReturnType<typeof createAppStore>

export function createAppStore(opts: StoreOptions = {}) {
  const words = opts.words ?? getWords()
  const now = opts.now ?? (() => Date.now())
  const rng = opts.rng ?? Math.random
  const storage = opts.storage !== undefined ? opts.storage : undefined
  const storageManager =
    opts.storageManager !== undefined ? opts.storageManager : (globalThis.navigator?.storage ?? null)

  let database: db.Db | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let persistRequested = false
  let lastStamp = 0
  /** Strictly increasing event timestamps, so same-millisecond actions keep their order on replay. */
  const stamp = () => (lastStamp = Math.max(now(), lastStamp + 1))
  const listeners = new Set<() => void>()
  const initialSettings = storage === undefined ? loadSettings() : loadSettings(storage)

  let snap: AppSnapshot = {
    ready: false,
    error: null,
    revision: 0,
    deviceId: '',
    settings: initialSettings,
    derived: emptyDerived(initialSettings.requestRetention),
    events: [],
    current: null,
    queue: EMPTY_QUEUE,
    practiceAhead: false,
    canUndo: false,
    persistence: 'unknown',
    lastExportAt: null,
  }

  function set(patch: Partial<AppSnapshot>) {
    snap = { ...snap, ...patch, revision: snap.revision + 1 }
    for (const l of listeners) l()
  }

  const persistSettings = (s: Settings) => (storage === undefined ? saveSettings(s) : saveSettings(s, storage))

  // ----- selection -----

  function recentKeys(events: readonly AppEvent[]): CardKey[] {
    const out: CardKey[] = []
    for (let i = events.length - 1; i >= 0 && out.length < 3; i--) {
      const e = events[i]
      if (e.kind === 'review') out.unshift(cardKey(e.wordId, e.dir))
      else if (e.kind === 'known') out.unshift(cardKey(e.wordId, 'listen'), cardKey(e.wordId, 'say'))
    }
    return out
  }

  function select(derived: Derived, events: readonly AppEvent[], settings: Settings, practiceAhead: boolean): Selection {
    return selectNext({
      derived,
      wordOrder: words.order,
      settings,
      now: now(),
      recent: recentKeys(events),
      rng,
      practiceAhead,
      includeWord: words.has,
    })
  }

  function toStudyCard(derived: Derived, sel: Selection): StudyCard | null {
    const p = sel.pick
    if (!p) return null
    const word = words.get(p.wordId)
    if (!word) return null
    const t = now()
    return {
      key: p.key,
      wordId: p.wordId,
      dir: p.dir,
      word,
      source: p.source,
      isNew: p.isNew,
      canMarkKnown: p.canMarkKnown,
      previews: previewIntervals(derived, p.key, t),
      shownAt: t,
    }
  }

  /** A specific card as the current one (used by undo). */
  function studyCardFor(derived: Derived, key: CardKey): StudyCard | null {
    const { wordId, dir } = parseCardKey(key)
    const word = words.get(wordId)
    if (!word) return null
    const t = now()
    const isNew = !derived.cards.has(key)
    return {
      key,
      wordId,
      dir,
      word,
      source: isNew ? 'new' : 'review',
      isNew,
      canMarkKnown: isNew && dir === 'listen',
      previews: previewIntervals(derived, key, t),
      shownAt: t,
    }
  }

  function canUndoIn(events: readonly AppEvent[]) {
    return lastUndoable(events) !== null
  }

  function lastUndoable(events: readonly AppEvent[]): GradingEvent | null {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if ((e.kind === 'review' || e.kind === 'known') && e.deviceId === snap.deviceId) return e
    }
    return null
  }

  /** Recompute queue + current card for the given state and publish it. */
  function publish(state: { derived: Derived; events: readonly AppEvent[]; settings?: Settings; practiceAhead?: boolean }, extra: Partial<AppSnapshot> = {}, forcedCurrent?: StudyCard | null) {
    const settings = state.settings ?? snap.settings
    const practiceAhead = state.practiceAhead ?? snap.practiceAhead
    const sel = select(state.derived, state.events, settings, practiceAhead)
    const current = forcedCurrent !== undefined ? forcedCurrent : toStudyCard(state.derived, sel)
    set({ ...extra, derived: state.derived, events: state.events, settings, practiceAhead, queue: sel.info, current, canUndo: canUndoIn(state.events) })
    scheduleRefresh()
  }

  function scheduleRefresh() {
    if (timer) clearTimeout(timer)
    timer = null
    if (snap.current || !snap.ready) return
    const q = snap.queue
    const next = Math.min(q.nextLearningDueAt ?? Infinity, q.nextReviewDueAt ?? Infinity)
    if (!Number.isFinite(next)) return
    const wait = Math.max(0, next - now()) + 250
    if (wait > MAX_TIMER_MS) return
    timer = setTimeout(() => {
      timer = null
      if (!snap.current) refresh()
    }, wait)
  }

  function refresh() {
    publish({ derived: snap.derived, events: snap.events })
  }

  async function save(fn: () => Promise<void>) {
    if (!database) return
    try {
      await fn()
    } catch (err) {
      set({ error: `Could not save progress: ${(err as Error)?.message ?? err}` })
    }
  }

  function addEvent(e: AppEvent, forcedCurrent?: StudyCard | null): Promise<void> {
    const derived = withEvent(snap.derived, e)
    const events = insertSorted(snap.events, e)
    publish({ derived, events }, {}, forcedCurrent)
    return save(() => db.putEvents(database!, [e]))
  }

  function maybeRequestPersist() {
    if (persistRequested || snap.persistence === 'granted') return
    persistRequested = true
    void requestPersistence()
  }

  async function requestPersistence(): Promise<PersistStatus> {
    let status: PersistStatus = 'unsupported'
    try {
      if (storageManager && typeof storageManager.persist === 'function') {
        status = (await storageManager.persist()) ? 'granted' : 'denied'
      }
    } catch {
      status = 'denied'
    }
    set({ persistence: status })
    return status
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot(): AppSnapshot {
      return snap
    },

    /** Open IndexedDB, load the log, derive state, pick the first card. Safe to call twice. */
    async init(): Promise<void> {
      if (snap.ready) return
      let events: AppEvent[] = []
      let deviceId = ''
      let lastExportAt: number | null = null
      let error: string | null = null
      if (!opts.inMemory) {
        try {
          database = await db.openQianDb(opts.dbName)
          events = (await db.loadEvents(database)).sort(compareEvents)
          deviceId = await db.getOrCreateDeviceId(database)
          lastExportAt = (await db.getMeta(database, 'lastExportAt')) ?? null
        } catch (err) {
          database = null
          error = `Storage is unavailable; progress will not be saved. (${(err as Error)?.message ?? err})`
        }
      }
      if (!deviceId) deviceId = uuid()
      let persistence: PersistStatus = 'unsupported'
      try {
        if (storageManager && typeof storageManager.persisted === 'function')
          persistence = (await storageManager.persisted()) ? 'granted' : 'unknown'
      } catch {
        persistence = 'unknown'
      }
      // Only this device's own events: another device's clock may be ahead.
      lastStamp = 0
      for (const e of events) if (e.deviceId === deviceId && e.ts > lastStamp) lastStamp = e.ts
      lastStamp = Math.min(lastStamp, now())
      snap = { ...snap, ready: true, deviceId }
      publish({ derived: buildDerived(events, snap.settings.requestRetention), events }, { error, lastExportAt, persistence })
    },

    /** Grade a card. Advances to the next card. */
    grade(key: CardKey, grade: GradeName, elapsedMs?: number): Promise<void> {
      const { wordId, dir } = parseCardKey(key)
      maybeRequestPersist()
      return addEvent(makeReview({ wordId, dir, grade, ts: stamp(), deviceId: snap.deviceId, elapsedMs }))
    },

    /** "I already know this": Easy on both cards of the word. Advances to the next card. */
    markKnown(wordId: string): Promise<void> {
      maybeRequestPersist()
      return addEvent(makeKnown({ wordId, ts: stamp(), deviceId: snap.deviceId }))
    },

    /** Delete this device's most recent review/known event and show that card again. */
    async undo(): Promise<AppEvent | null> {
      const e = lastUndoable(snap.events)
      if (!e) return null
      const derived = withoutEvent(snap.derived, e)
      const events = snap.events.filter((x) => x.id !== e.id)
      const key = e.kind === 'review' ? cardKey(e.wordId, e.dir) : cardKey(e.wordId, 'listen')
      publish({ derived, events }, {}, studyCardFor(derived, key))
      await save(() => db.deleteEvent(database!, e.id))
      return e
    },

    setSuspended(wordId: string, suspended: boolean): Promise<void> {
      const keepCurrent = snap.current && snap.current.wordId !== wordId ? snap.current : undefined
      return addEvent(makeSuspend({ wordId, suspended, ts: stamp(), deviceId: snap.deviceId }), keepCurrent)
    },

    flag(wordId: string, reason: FlagReason, note?: string): Promise<void> {
      return addEvent(makeFlag({ wordId, reason, note, ts: stamp(), deviceId: snap.deviceId }), snap.current)
    },

    /** Resolve all open flags of this word with this reason. */
    resolveFlag(wordId: string, reason: FlagReason): Promise<void> {
      return addEvent(makeFlag({ wordId, reason, resolved: true, ts: stamp(), deviceId: snap.deviceId }), snap.current)
    },

    updateSettings(patch: Partial<Settings>): void {
      const settings = validateSettings({ ...snap.settings, ...patch }, snap.settings)
      const ok = persistSettings(settings)
      const rebuild = settings.requestRetention !== snap.settings.requestRetention
      const derived = rebuild ? buildDerived(snap.events, settings.requestRetention) : snap.derived
      const cur = snap.current
      const current = cur && rebuild ? { ...cur, previews: previewIntervals(derived, cur.key, now()) } : cur
      publish({ derived, events: snap.events, settings }, ok ? {} : { error: 'Settings could not be saved in this browser.' }, current)
    },

    /** Re-pick the current card (e.g. after a timer, or when the user taps "keep going"). */
    next(): void {
      refresh()
    },

    /** Keep practicing when caught up (practice-ahead reviews are logged like normal reviews). */
    setPracticeAhead(on: boolean): void {
      publish({ derived: snap.derived, events: snap.events, practiceAhead: on })
    },

    /** Pure query: what would be picked now (does not change the current card). */
    peekNext(practiceAhead = snap.practiceAhead): Selection {
      return select(snap.derived, snap.events, snap.settings, practiceAhead)
    },

    previews(key: CardKey): Record<GradeName, IntervalPreview> {
      return previewIntervals(snap.derived, key, now())
    },

    async exportData(): Promise<{ filename: string; text: string }> {
      const t = now()
      const text = serializeExport(buildExport(snap.events, snap.settings, snap.deviceId, t))
      await save(() => db.setMeta(database!, 'lastExportAt', t))
      set({ lastExportAt: t })
      return { filename: exportFileName(t), text }
    },

    /** Merge (default) or replace from a backup file. Throws ImportError on invalid input. */
    async importData(file: Blob | string, mode: ImportMode = 'merge'): Promise<ImportSummary> {
      const text = typeof file === 'string' ? file : await readFileText(file)
      const { file: parsed, skipped } = parseImport(text)
      let events: AppEvent[]
      let added: number
      let duplicates: number
      let settings = snap.settings
      if (mode === 'replace') {
        events = mergeEvents([], parsed.events).events
        added = events.length
        duplicates = parsed.events.length - events.length
        settings = parsed.settings
        persistSettings(settings)
        await save(() => db.replaceEvents(database!, events))
      } else {
        const m = mergeEvents(snap.events, parsed.events)
        events = m.events
        added = m.added.length
        duplicates = m.duplicates
        await save(() => db.putEvents(database!, m.added))
      }
      publish({ derived: buildDerived(events, settings.requestRetention), events, settings })
      return { mode, added, duplicates, skipped, total: events.length }
    },

    /** Delete all progress. Settings are reset too unless keepSettings. */
    async resetAll(keepSettings = false): Promise<void> {
      await save(() => db.clearAll(database!))
      const settings = keepSettings ? snap.settings : { ...DEFAULT_SETTINGS }
      if (!keepSettings) persistSettings(settings)
      publish({ derived: emptyDerived(settings.requestRetention), events: [], settings, practiceAhead: false }, { lastExportAt: null })
    },

    requestPersistence,

    /** Stop timers and close the database (tests / HMR). */
    dispose(): void {
      if (timer) clearTimeout(timer)
      timer = null
      listeners.clear()
      database?.close()
      database = null
    },
  }
}

let appStore: AppStore | null = null

/** The app-wide store (created lazily; call `init()` once at startup). */
export function getAppStore(): AppStore {
  return (appStore ??= createAppStore())
}
