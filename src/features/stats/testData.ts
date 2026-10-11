// Seeded review history for the stats tests (fixture words w4f60 你, w6211 我, w662f 是).
import { makeFlag, makeKnown, makeReview, type AppEvent, type Dir, type GradeName } from '../../lib/events'

export const NOW = new Date(2026, 9, 11, 12, 0).getTime() // Sun Oct 11 2026, local noon
const DAY = 86_400_000
const dev = 'test-device'
let seq = 0
const id = () => `e${String(++seq).padStart(4, '0')}`

const at = (daysAgo: number, minute = 0) => {
  const d = new Date(NOW - daysAgo * DAY)
  d.setHours(9, minute, 0, 0)
  return d.getTime()
}

const rev = (wordId: string, dir: Dir, grade: GradeName, daysAgo: number, minute = 0, elapsedMs = 8000): AppEvent =>
  makeReview({ id: id(), wordId, dir, grade, ts: at(daysAgo, minute), deviceId: dev, elapsedMs })

/**
 * About six weeks of history:
 * - 你: listen learned, lapsed twice; say learned.
 * - 我: "I already know this", then reviewed.
 * - 是: listen still learning (many misses), with an open flag.
 * Reviews on the 3 days up to and including today (streak 3), plus earlier scattered days.
 */
export function seededEvents(): AppEvent[] {
  seq = 0
  return [
    rev('w4f60', 'listen', 'again', 42, 0),
    rev('w4f60', 'listen', 'good', 42, 2),
    rev('w4f60', 'listen', 'good', 42, 15),
    rev('w4f60', 'listen', 'good', 40),
    rev('w4f60', 'say', 'good', 40, 1),
    rev('w4f60', 'say', 'good', 40, 12),
    rev('w4f60', 'listen', 'again', 30),
    rev('w4f60', 'listen', 'good', 30, 12),
    rev('w4f60', 'say', 'good', 28),
    makeKnown({ id: id(), wordId: 'w6211', ts: at(21), deviceId: dev }),
    rev('w4f60', 'listen', 'again', 14),
    rev('w4f60', 'listen', 'good', 14, 12),
    rev('w6211', 'listen', 'good', 13),
    rev('w6211', 'say', 'easy', 13, 1),
    rev('w4f60', 'say', 'again', 7),
    rev('w4f60', 'say', 'good', 7, 12),
    rev('w662f', 'listen', 'again', 2),
    rev('w662f', 'listen', 'again', 2, 3),
    rev('w4f60', 'listen', 'good', 1),
    rev('w662f', 'listen', 'again', 1, 2),
    rev('w662f', 'listen', 'good', 0, 0, 120_000), // walked away: capped at 60 s
    rev('w6211', 'say', 'good', 0, 1),
    makeFlag({ id: id(), wordId: 'w662f', reason: 'audio', ts: at(0, 5), deviceId: dev }),
  ]
}
