// Event-sourced log: the single source of truth for all learning progress.
// Card states, suspensions, flags and the learner's own notes are all derived by replaying these events in (ts, id) order.

export type Dir = 'listen' | 'say'
export const DIRS: readonly Dir[] = ['listen', 'say']

export type GradeName = 'again' | 'good' | 'easy'
export const GRADES: readonly GradeName[] = ['again', 'good', 'easy']

export type FlagReason = 'audio' | 'pinyin' | 'meaning' | 'example' | 'other'
export const FLAG_REASONS: readonly FlagReason[] = ['audio', 'pinyin', 'meaning', 'example', 'other']

/** `${wordId}:${dir}` */
export type CardKey = string

interface EventBase {
  id: string // uuid
  wordId: string
  ts: number // ms since epoch
  deviceId: string
}

export interface ReviewEvent extends EventBase {
  kind: 'review'
  dir: Dir
  grade: GradeName
  elapsedMs?: number // time spent on the card (UI-measured)
}

/** "I already know this": FSRS Easy on both the listen and the say card at `ts`. */
export interface KnownEvent extends EventBase {
  kind: 'known'
}

export interface SuspendEvent extends EventBase {
  kind: 'suspend'
  suspended: boolean
}

/**
 * A flag on a word. An event with `resolved: true` resolves every earlier open flag
 * of the same word with the same reason.
 */
export interface FlagEvent extends EventBase {
  kind: 'flag'
  reason: FlagReason
  note?: string
  resolved?: boolean
}

/** The learner's own note on a word (a mnemonic or their own meaning). The latest one wins; empty text clears it. */
export interface NoteEvent extends EventBase {
  kind: 'note'
  text: string
}

/** Longest personal note, in characters. */
export const USER_NOTE_MAX = 500

export type AppEvent = ReviewEvent | KnownEvent | SuspendEvent | FlagEvent | NoteEvent
export type GradingEvent = ReviewEvent | KnownEvent

export function cardKey(wordId: string, dir: Dir): CardKey {
  return `${wordId}:${dir}`
}

export function parseCardKey(key: CardKey): { wordId: string; dir: Dir } {
  const i = key.lastIndexOf(':')
  const dir = key.slice(i + 1)
  if (i <= 0 || (dir !== 'listen' && dir !== 'say')) throw new Error(`Invalid card key: ${key}`)
  return { wordId: key.slice(0, i), dir }
}

export function siblingKey(key: CardKey): CardKey {
  const { wordId, dir } = parseCardKey(key)
  return cardKey(wordId, dir === 'listen' ? 'say' : 'listen')
}

/** Total order used for replay: timestamp, then id as a tiebreaker. */
export function compareEvents(a: AppEvent, b: AppEvent): number {
  if (a.ts !== b.ts) return a.ts - b.ts
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortEvents<T extends AppEvent>(events: readonly T[]): T[] {
  return [...events].sort(compareEvents)
}

export function isGradingEvent(e: AppEvent): e is GradingEvent {
  return e.kind === 'review' || e.kind === 'known'
}

export function uuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// ---------- constructors ----------

interface Common {
  wordId: string
  ts: number
  deviceId: string
  id?: string
}

export function makeReview(p: Common & { dir: Dir; grade: GradeName; elapsedMs?: number }): ReviewEvent {
  const e: ReviewEvent = { id: p.id ?? uuid(), kind: 'review', wordId: p.wordId, dir: p.dir, grade: p.grade, ts: p.ts, deviceId: p.deviceId }
  if (p.elapsedMs !== undefined && Number.isFinite(p.elapsedMs) && p.elapsedMs >= 0) e.elapsedMs = Math.round(p.elapsedMs)
  return e
}

export function makeKnown(p: Common): KnownEvent {
  return { id: p.id ?? uuid(), kind: 'known', wordId: p.wordId, ts: p.ts, deviceId: p.deviceId }
}

export function makeSuspend(p: Common & { suspended: boolean }): SuspendEvent {
  return { id: p.id ?? uuid(), kind: 'suspend', wordId: p.wordId, suspended: p.suspended, ts: p.ts, deviceId: p.deviceId }
}

export function makeFlag(p: Common & { reason: FlagReason; note?: string; resolved?: boolean }): FlagEvent {
  const e: FlagEvent = { id: p.id ?? uuid(), kind: 'flag', wordId: p.wordId, reason: p.reason, ts: p.ts, deviceId: p.deviceId }
  if (p.note) e.note = p.note
  if (p.resolved) e.resolved = true
  return e
}

export function makeNote(p: Common & { text: string }): NoteEvent {
  return { id: p.id ?? uuid(), kind: 'note', wordId: p.wordId, text: p.text.trim().slice(0, USER_NOTE_MAX), ts: p.ts, deviceId: p.deviceId }
}

// ---------- validation (used for import and for reading IndexedDB defensively) ----------

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Returns a clean copy of a valid event (unknown fields dropped), or null if invalid. */
export function sanitizeEvent(v: unknown): AppEvent | null {
  if (!isObj(v)) return null
  const { id, kind, wordId, ts, deviceId } = v
  if (!isStr(id) || !isStr(wordId) || !isStr(deviceId)) return null
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < 0) return null
  const base = { id, wordId, ts, deviceId }
  switch (kind) {
    case 'review': {
      if (v.dir !== 'listen' && v.dir !== 'say') return null
      if (!GRADES.includes(v.grade as GradeName)) return null
      const e: ReviewEvent = { ...base, kind, dir: v.dir, grade: v.grade as GradeName }
      if (typeof v.elapsedMs === 'number' && Number.isFinite(v.elapsedMs) && v.elapsedMs >= 0) e.elapsedMs = v.elapsedMs
      return e
    }
    case 'known':
      return { ...base, kind }
    case 'suspend':
      if (typeof v.suspended !== 'boolean') return null
      return { ...base, kind, suspended: v.suspended }
    case 'flag': {
      if (!FLAG_REASONS.includes(v.reason as FlagReason)) return null
      const e: FlagEvent = { ...base, kind, reason: v.reason as FlagReason }
      if (typeof v.note === 'string' && v.note) e.note = v.note
      if (v.resolved === true) e.resolved = true
      return e
    }
    case 'note':
      if (typeof v.text !== 'string') return null
      return { ...base, kind, text: v.text.trim().slice(0, USER_NOTE_MAX) }
    default:
      return null
  }
}
