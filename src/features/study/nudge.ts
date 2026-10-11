// Which reminder the Study screen shows (see StudyNudge.tsx), and its per-browser snooze.
import type { PersistStatus } from '../../lib/store'
import { backupOverdue } from '../settings/backup'

export type NudgeKind = 'install' | 'backup' | 'persist'

const DAY_MS = 24 * 60 * 60 * 1000
/** A dismissed reminder comes back after this many days (if it still applies). */
export const NUDGE_SNOOZE_DAYS = 3
const SNOOZE_KEY = 'qian.nudgeSnoozedAt'

export type Snoozes = Partial<Record<NudgeKind, number>>

export function readSnoozes(): Snoozes {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as Snoozes) : {}
  } catch {
    return {}
  }
}

export function writeSnooze(kind: NudgeKind, t: number) {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ ...readSnoozes(), [kind]: t }))
  } catch {
    // Storage unavailable: the dismissal lasts for this page view only.
  }
}

export interface NudgeInput {
  ios: boolean
  standalone: boolean
  eventCount: number
  lastExportAt: number | null
  persistence: PersistStatus
  snoozedAt: Snoozes
  now: number
}

/** Which reminder to show, most important first (null = none). Nothing before the first answer. */
export function pickNudge(o: NudgeInput): NudgeKind | null {
  if (o.eventCount === 0) return null
  const awake = (k: NudgeKind) => {
    const t = o.snoozedAt[k]
    return typeof t !== 'number' || o.now - t >= NUDGE_SNOOZE_DAYS * DAY_MS
  }
  if (o.ios && !o.standalone && awake('install')) return 'install'
  if (backupOverdue(o.eventCount, o.lastExportAt, o.now) && awake('backup')) return 'backup'
  if (o.persistence === 'denied' && awake('persist')) return 'persist'
  return null
}
