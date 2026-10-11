// App store: event log + derived state + settings + the current study card.
// Framework-free; React reads it via useSyncExternalStore (see useAppStore.ts).
import type { Word } from '../data/types'
import * as db from './db'
import { buildDerived, emptyDerived, isSuspended, withEvent, withoutEvent, type Derived } from './derive'
import { defaultDayOffsetMs } from './fsrs'
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
  RECENT_WINDOW,
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
  /** FSRS day-boundary shift (fsrs.defaultDayOffsetMs). Default: captured once per device and kept in IndexedDB. */
  dayOffsetMs?: number
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
/** How many of this session's answers Undo can step back through. */
const UNDO_DEPTH = 20

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
  const readSettings = () => (storage === undefined ? loadSettings() : loadSettings(storage))
  let dayOffsetMs = opts.dayOffsetMs ?? defaultDayOffsetMs()
  /** Review/known events graded in this session, oldest first: the only ones Undo may remove. */
  let undoable: { id: string; wordId: string }[] = []
  /** Events added in memory whose IndexedDB write has not succeeded (yet); kept across resyncs. */
  const unsaved = new Map<string, AppEvent>()
  /** Events undone in memory whose IndexedDB delete is still in flight. */
  const deleting = new Set<string>()
  let channel: BroadcastChannel | null = null

  let snap: AppSnapshot = {
    ready: false,
    error: null,
    revision: 0,
    deviceId: '',
    settings: initialSettings,
    derived: emptyDerived(initialSettings.requestRetention, dayOffsetMs),
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
    for (let i = events.length - 1; i >= 0 && out.length < RECENT_WINDOW; i--) {
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
    if (!word || isSuspended(derived, wordId)) return null
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

  function canUndoIn(derived: Derived) {
    return lastUndoable(derived) !== null
  }

  /** Newest event graded in this session that is still in the log (ids are stamped in increasing ts order). */
  function lastUndoable(derived: Derived): GradingEvent | null {
    for (let i = undoable.length - 1; i >= 0; i--) {
      const { id, wordId } = undoable[i]
      const e = derived.eventsByWord.get(wordId)?.find((x) => x.id === id)
      if (e && (e.kind === 'review' || e.kind === 'known')) return e
    }
    return null
  }

  function rememberUndo(e: AppEvent) {
    undoable.push({ id: e.id, wordId: e.wordId })
    if (undoable.length > UNDO_DEPTH) undoable = undoable.slice(-UNDO_DEPTH)
  }

  /** Recompute queue + current card for the given state and publish it. */
  function publish(state: { derived: Derived; events: readonly AppEvent[]; settings?: Settings; practiceAhead?: boolean }, extra: Partial<AppSnapshot> = {}, forcedCurrent?: StudyCard | null) {
    const settings = state.settings ?? snap.settings
    const practiceAhead = state.practiceAhead ?? snap.practiceAhead
    const sel = select(state.derived, state.events, settings, practiceAhead)
    const current = forcedCurrent !== undefined ? forcedCurrent : toStudyCard(state.derived, sel)
    set({ ...extra, derived: state.derived, events: state.events, settings, practiceAhead, queue: sel.info, current, canUndo: canUndoIn(state.derived) })
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
    // Long waits are re-checked every hour (refresh -> publish -> scheduleRefresh), so a page kept
    // alive overnight still picks up the next card and keeps the queue counts fresh.
    timer = setTimeout(() => {
      timer = null
      if (!snap.current) refresh()
    }, Math.min(wait, MAX_TIMER_MS))
  }

  function refresh() {
    publish({ derived: snap.derived, events: snap.events })
  }

  // Timers are frozen or throttled while a page is hidden (background tab, iOS PWA kept in memory),
  // so also re-pick when the page comes back. Only while caught up: never swap a card mid-answer.
  let detachResume: (() => void) | null = null
  function onResume() {
    if (snap.ready && !snap.current && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) refresh()
    void resync()
  }
  function attachResume() {
    if (detachResume || typeof window === 'undefined' || typeof document === 'undefined') return
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('pageshow', onResume)
    detachResume = () => {
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('pageshow', onResume)
      detachResume = null
    }
  }

  /**
   * Run a database write. Resolves true on success, or when there is no database (in-memory mode; init already
   * reported that). On failure resolves false, and also shows the generic banner unless `report` is false.
   */
  async function save(fn: () => Promise<void>, report = true): Promise<boolean> {
    if (!database) return true
    try {
      await fn()
      return true
    } catch (err) {
      if (report) set({ error: `Could not save progress: ${(err as Error)?.message ?? err}` })
      return false
    }
  }

  async function addEvent(e: AppEvent, forcedCurrent?: StudyCard | null): Promise<void> {
    const derived = withEvent(snap.derived, e)
    const events = insertSorted(snap.events, e)
    unsaved.set(e.id, e)
    publish({ derived, events }, {}, forcedCurrent)
    if (await save(() => db.putEvents(database!, [e]))) {
      unsaved.delete(e.id)
      announce()
    }
  }

  // ----- other tabs / windows -----
  // Each tab keeps the log in memory. Writes are union-by-id, but without this a stale tab would export an
  // incomplete backup, keep showing (and writing into) a log another tab reset, and keep old settings.

  function announce() {
    try {
      channel?.postMessage('changed')
    } catch {
      // ignore: the other tabs resync when they become visible anyway
    }
  }

  function sameCard(a: Derived, b: Derived, key: CardKey) {
    const x = a.cards.get(key)?.card
    const y = b.cards.get(key)?.card
    if (!x || !y) return !x && !y
    return x.reps === y.reps && x.last_review?.getTime() === y.last_review?.getTime()
  }

  /** Reload the log and settings written by other tabs. Replaces the in-memory log (a reset elsewhere wins). */
  async function resync(): Promise<boolean> {
    if (!database || !snap.ready) return false
    let loaded: AppEvent[]
    try {
      loaded = await db.loadEvents(database)
    } catch {
      return false
    }
    const byId = new Map<string, AppEvent>()
    for (const e of loaded) if (!deleting.has(e.id)) byId.set(e.id, e)
    for (const e of unsaved.values()) byId.set(e.id, e)
    const settings = readSettings()
    // Events missing from the database were undone, replaced or reset in another tab.
    const removed = snap.events.some((e) => !byId.has(e.id))
    const eventsChanged = removed || byId.size !== snap.events.length
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(snap.settings)
    if (!eventsChanged && !settingsChanged) return false
    const events = eventsChanged ? [...byId.values()].sort(compareEvents) : snap.events
    const derived =
      eventsChanged || settings.requestRetention !== snap.settings.requestRetention
        ? buildDerived(events, settings.requestRetention, dayOffsetMs)
        : snap.derived
    const cur = snap.current
    const keep = cur && !removed && !isSuspended(derived, cur.wordId) && sameCard(snap.derived, derived, cur.key) ? cur : undefined
    publish({ derived, events, settings, practiceAhead: events.length ? undefined : false }, {}, keep)
    return true
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

  /** Remember that a backup made at `t` was saved (drives the "back up" reminder). */
  async function markExported(t: number): Promise<void> {
    await save(() => db.setMeta(database!, 'lastExportAt', t))
    set({ lastExportAt: t })
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
          if (opts.dayOffsetMs === undefined) {
            // Keep the day boundary fixed per device (DST, travel), so replay stays deterministic.
            const stored = await db.getMeta(database, 'dayOffsetMs')
            if (typeof stored === 'number' && Number.isFinite(stored)) dayOffsetMs = stored
            else await db.setMeta(database, 'dayOffsetMs', dayOffsetMs)
          }
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
      attachResume()
      if (database && typeof BroadcastChannel === 'function') {
        try {
          channel = new BroadcastChannel(`qian:${opts.dbName ?? db.DB_NAME}`)
          channel.onmessage = () => void resync()
        } catch {
          channel = null
        }
      }
      publish({ derived: buildDerived(events, snap.settings.requestRetention, dayOffsetMs), events }, { error, lastExportAt, persistence })
    },

    /** Grade a card. Advances to the next card. */
    grade(key: CardKey, grade: GradeName, elapsedMs?: number): Promise<void> {
      const { wordId, dir } = parseCardKey(key)
      maybeRequestPersist()
      const e = makeReview({ wordId, dir, grade, ts: stamp(), deviceId: snap.deviceId, elapsedMs })
      rememberUndo(e)
      return addEvent(e)
    },

    /** "I already know this": Easy on both cards of the word. Advances to the next card. */
    markKnown(wordId: string): Promise<void> {
      maybeRequestPersist()
      const e = makeKnown({ wordId, ts: stamp(), deviceId: snap.deviceId })
      rememberUndo(e)
      return addEvent(e)
    },

    /**
     * Delete the most recent answer given in this session (up to UNDO_DEPTH back) and show that card again.
     * Answers from earlier sessions are never undone.
     */
    async undo(): Promise<AppEvent | null> {
      const e = lastUndoable(snap.derived)
      if (!e) return null
      undoable = undoable.filter((x) => x.id !== e.id)
      unsaved.delete(e.id)
      deleting.add(e.id)
      const derived = withoutEvent(snap.derived, e)
      const events = snap.events.filter((x) => x.id !== e.id)
      const key = e.kind === 'review' ? cardKey(e.wordId, e.dir) : cardKey(e.wordId, 'listen')
      publish({ derived, events }, {}, studyCardFor(derived, key) ?? undefined)
      if (await save(() => db.deleteEvent(database!, e.id))) announce()
      deleting.delete(e.id)
      return e
    },

    setSuspended(wordId: string, suspended: boolean): Promise<void> {
      // Undo means "undo last answer"; right after a suspend it would rewind the previous card instead, so
      // it is disabled until the next answer.
      undoable = []
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
      const derived = rebuild ? buildDerived(snap.events, settings.requestRetention, dayOffsetMs) : snap.derived
      const cur = snap.current
      const current = cur && rebuild ? { ...cur, previews: previewIntervals(derived, cur.key, now()) } : cur
      publish({ derived, events: snap.events, settings }, ok ? {} : { error: 'Settings could not be saved in this browser.' }, current)
      if (ok) announce()
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

    /**
     * Build a backup file. Records it as the last export unless `record: false` (the Share path records only once
     * the share sheet actually succeeds, via markExported).
     */
    async exportData(options: { record?: boolean } = {}): Promise<{ filename: string; text: string; exportedAt: number }> {
      const t = now()
      // Read the log from IndexedDB, not memory: another tab may have added events this one has not seen.
      // In-memory events are merged in so a failed save is still backed up.
      let events: readonly AppEvent[] = snap.events
      if (database) {
        try {
          events = mergeEvents(await db.loadEvents(database), snap.events).events
        } catch {
          // fall back to memory
        }
      }
      const text = serializeExport(buildExport(events, snap.settings, snap.deviceId, t))
      if (options.record !== false) await markExported(t)
      return { filename: exportFileName(t), text, exportedAt: t }
    },

    markExported,

    /**
     * Merge (default) or replace from a backup file. Throws ImportError on invalid input, and an Error (nothing
     * changed) when the browser could not save the result.
     */
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
        if (!(await save(() => db.replaceEvents(database!, events), false))) throw new Error(IMPORT_SAVE_FAILED)
        // Only after the log is saved, so a failed import never leaves the backup's settings with the old log.
        persistSettings(settings)
        undoable = []
        unsaved.clear()
      } else {
        const m = mergeEvents(snap.events, parsed.events)
        added = m.added.length
        duplicates = m.duplicates
        if (!(await save(() => db.putEvents(database!, m.added), false))) throw new Error(IMPORT_SAVE_FAILED)
        // Re-merge onto the current log: answers given while the file was being saved are kept.
        events = mergeEvents(snap.events, m.added).events
      }
      publish({ derived: buildDerived(events, settings.requestRetention, dayOffsetMs), events, settings })
      announce()
      return { mode, added, duplicates, skipped, total: events.length }
    },

    /** Delete all progress. Settings are reset too unless keepSettings. Throws (nothing changed) if the browser could not erase it. */
    async resetAll(keepSettings = false): Promise<void> {
      if (!(await save(() => db.clearAll(database!)))) throw new Error('Could not erase progress in this browser; nothing was changed.')
      const settings = keepSettings ? snap.settings : { ...DEFAULT_SETTINGS }
      if (!keepSettings) persistSettings(settings)
      undoable = []
      unsaved.clear()
      publish({ derived: emptyDerived(settings.requestRetention, dayOffsetMs), events: [], settings, practiceAhead: false }, { lastExportAt: null })
      announce()
    },

    requestPersistence,

    /** Stop timers and close the database (tests / HMR). */
    dispose(): void {
      if (timer) clearTimeout(timer)
      timer = null
      detachResume?.()
      channel?.close()
      channel = null
      listeners.clear()
      database?.close()
      database = null
    },
  }
}

const IMPORT_SAVE_FAILED = 'The backup could not be saved in this browser; nothing was changed.'

let appStore: AppStore | null = null

/** The app-wide store (created lazily; call `init()` once at startup). */
export function getAppStore(): AppStore {
  return (appStore ??= createAppStore())
}
