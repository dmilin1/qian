// Human wording for "when is the next card?" on the caught-up screen.

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function clock(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * "in under a minute", "in 8 min", "in 3 h (at 4:05 PM)", "tomorrow at 9:00 AM",
 * "on Tuesday", "in 12 days". `at` and `now` are epoch ms.
 */
export function formatWhen(at: number, now: number): string {
  const ms = at - now
  if (ms < MIN) return 'in under a minute'
  if (ms < HOUR) return `in ${Math.round(ms / MIN)} min`
  const dayDiff = Math.round((startOfDay(at) - startOfDay(now)) / DAY)
  if (dayDiff === 0) return `in ${Math.round(ms / HOUR)} h (at ${clock(at)})`
  if (dayDiff === 1) return `tomorrow at ${clock(at)}`
  if (dayDiff < 7) return `on ${new Date(at).toLocaleDateString(undefined, { weekday: 'long' })}`
  return `in ${dayDiff} days`
}
