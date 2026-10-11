// Shown when no card is due: what's next, and "Keep practicing" (practice-ahead).
import type { ReactNode } from 'react'
import type { QueueInfo } from '../../lib/scheduler'
import { Button, Icon, Kbd, useNow } from '../../components'
import { ProgressTiles } from './Progress'
import type { ProgressNumbers } from './progressNumbers'
import { formatWhen } from './time'

interface Props {
  queue: QueueInfo
  progress: ProgressNumbers
  /** Whether practice-ahead has anything to show (graduated, non-suspended cards exist). */
  canPractice: boolean
  onPractice: () => void
  /** Banner shown right under the heading (the study nudge), so it is above the fold on short phones. */
  nudge?: ReactNode
}

export function CaughtUp({ queue, progress, canPractice, onPractice, nudge }: Props) {
  const now = useNow(15_000)
  const nextAt = Math.min(queue.nextLearningDueAt ?? Infinity, queue.nextReviewDueAt ?? Infinity)
  const next = Number.isFinite(nextAt) ? formatWhen(nextAt, now) : null
  const exhausted = queue.gateBlockedBy === 'exhausted'

  let why: string
  if (exhausted) why = `You've met all ${progress.total} words. From here on it's reviews only.`
  else if (queue.gateBlockedBy === 'workingSet')
    why = `${progress.inProgress} words are still settling in. New words join as they become stable.`
  else why = 'Nothing is at risk of being forgotten right now.'

  return (
    <div className="flex flex-1 flex-col items-center gap-6 py-6 text-center motion-safe:animate-rise-in">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success">
        <Icon name="check" size={30} strokeWidth={2} />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">All caught up</h1>
        <p className="max-w-sm text-muted text-balance">{why}</p>
        {next ? (
          <p className="text-ink">
            Next card <span className="font-medium">{next}</span>.
          </p>
        ) : null}
      </div>
      {nudge}
      <ProgressTiles p={progress} />
      <div className="flex w-full flex-col items-center gap-2">
        {!canPractice ? (
          <p className="text-sm text-muted">Nothing to practice ahead yet: words show up here once they have graduated from learning.</p>
        ) : (
          <>
            <Button variant="primary" size="xl" block icon="replay" onClick={onPractice} trailing={<Kbd>Space</Kbd>}>
              Keep practicing
            </Button>
            <p className="text-sm text-muted">Reviews the words you're least sure of, a little early.</p>
          </>
        )}
      </div>
    </div>
  )
}
