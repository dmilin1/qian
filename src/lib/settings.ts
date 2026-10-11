// User settings, persisted in localStorage. Every read/write is guarded: storage may be
// unavailable (private mode, quota, disabled cookies) and the app must still work.

export type ListenFront = 'full' | 'audioOnly'
export type Theme = 'system' | 'light' | 'dark'

export interface Settings {
  listenFront: ListenFront // Listen card front: audio + pinyin + characters, or audio only
  showCharacters: boolean
  toneColors: boolean
  autoplay: boolean
  slowRate: number // playback rate for the slow button
  requestRetention: number // FSRS target retention
  workingSetCap: number // max unstable words before new words pause
  stableDays: number // stability (days) at which a card stops counting as unstable
  backlogLimit: number // new words pause while more than this many reviews are due
  theme: Theme
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  listenFront: 'full',
  showCharacters: true,
  toneColors: true,
  autoplay: true,
  slowRate: 0.7,
  requestRetention: 0.9,
  workingSetCap: 30,
  stableDays: 5,
  backlogLimit: 10,
  theme: 'system',
})

export const SETTINGS_KEY = 'qian.settings'
export const SETTINGS_VERSION = 1

/** Numeric limits, exported for slider UIs. */
export const SETTING_RANGES = {
  slowRate: { min: 0.5, max: 1, step: 0.05 },
  requestRetention: { min: 0.7, max: 0.97, step: 0.01 },
  workingSetCap: { min: 1, max: 100, step: 1 },
  stableDays: { min: 1, max: 60, step: 1 },
  backlogLimit: { min: 0, max: 500, step: 1 },
} as const

type NumKey = keyof typeof SETTING_RANGES
const INT_KEYS: ReadonlySet<NumKey> = new Set(['workingSetCap', 'stableDays', 'backlogLimit'])

function num(v: unknown, key: NumKey): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  const { min, max } = SETTING_RANGES[key]
  const x = Math.min(max, Math.max(min, v))
  return INT_KEYS.has(key) ? Math.round(x) : x
}

const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
const oneOf = <T extends string>(v: unknown, opts: readonly T[]) => (opts.includes(v as T) ? (v as T) : undefined)

/** Validate untrusted input. Invalid fields fall back to `base` (defaults unless given); numbers are clamped. */
export function validateSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const v = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  return {
    listenFront: oneOf(v.listenFront, ['full', 'audioOnly'] as const) ?? base.listenFront,
    showCharacters: bool(v.showCharacters) ?? base.showCharacters,
    toneColors: bool(v.toneColors) ?? base.toneColors,
    autoplay: bool(v.autoplay) ?? base.autoplay,
    slowRate: num(v.slowRate, 'slowRate') ?? base.slowRate,
    requestRetention: num(v.requestRetention, 'requestRetention') ?? base.requestRetention,
    workingSetCap: num(v.workingSetCap, 'workingSetCap') ?? base.workingSetCap,
    stableDays: num(v.stableDays, 'stableDays') ?? base.stableDays,
    backlogLimit: num(v.backlogLimit, 'backlogLimit') ?? base.backlogLimit,
    theme: oneOf(v.theme, ['system', 'light', 'dark'] as const) ?? base.theme,
  }
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Load settings (defaults on any failure). Stored as { v, settings } to allow future migrations. */
export function loadSettings(storage: Storage | null = defaultStorage()): Settings {
  try {
    const raw = storage?.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as { v?: number; settings?: unknown }
    // Migrations would go here, keyed on parsed.v.
    return validateSettings(parsed?.settings)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Returns false if the settings could not be persisted. */
export function saveSettings(s: Settings, storage: Storage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(SETTINGS_KEY, JSON.stringify({ v: SETTINGS_VERSION, settings: s }))
    return true
  } catch {
    return false
  }
}

export function clearSettings(storage: Storage | null = defaultStorage()): void {
  try {
    storage?.removeItem(SETTINGS_KEY)
  } catch {
    // ignore
  }
}
