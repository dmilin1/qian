// Guess which word(s) come after the current card, so their audio can be preloaded while the
// learner is still on this card. Pure: simulates "graded Good" and "graded Again" through the
// real scheduler on a copy of the derived state (the store itself is never touched).
import type { AppEvent, CardKey, GradeName } from '../../lib/events'
import { cardKey, makeReview } from '../../lib/events'
import { withEvent } from '../../lib/derive'
import { mulberry32, RECENT_WINDOW, selectNext } from '../../lib/scheduler'
import type { AppSnapshot } from '../../lib/store'
import type { WordIndex } from '../../lib/words'

/** Same rule as the store: the last RECENT_WINDOW graded cards, a "known" event counting as both cards. */
function recentKeys(events: readonly AppEvent[]): CardKey[] {
  const out: CardKey[] = []
  for (let i = events.length - 1; i >= 0 && out.length < RECENT_WINDOW; i--) {
    const e = events[i]
    if (e.kind === 'review') out.unshift(cardKey(e.wordId, e.dir))
    else if (e.kind === 'known') out.unshift(cardKey(e.wordId, 'listen'), cardKey(e.wordId, 'say'))
  }
  return out
}

export function predictNextWordIds(
  snap: Pick<AppSnapshot, 'current' | 'derived' | 'events' | 'settings' | 'practiceAhead' | 'deviceId'>,
  words: Pick<WordIndex, 'order' | 'has'>,
  now = Date.now(),
  grades: readonly GradeName[] = ['good', 'again'],
): string[] {
  const cur = snap.current
  if (!cur) return []
  const out: string[] = []
  const recent = [...recentKeys(snap.events), cur.key].slice(-RECENT_WINDOW)
  for (const grade of grades) {
    try {
      const e = makeReview({ id: `predict-${grade}`, wordId: cur.wordId, dir: cur.dir, grade, ts: now, deviceId: snap.deviceId })
      const sel = selectNext({
        derived: withEvent(snap.derived, e),
        wordOrder: words.order,
        settings: snap.settings,
        now,
        recent,
        rng: mulberry32(now & 0xffff),
        practiceAhead: snap.practiceAhead,
        includeWord: words.has,
      })
      const id = sel.pick?.wordId
      if (id && id !== cur.wordId && !out.includes(id)) out.push(id)
    } catch {
      // Preloading is best effort.
    }
  }
  return out
}
