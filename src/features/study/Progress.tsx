// Compact progress: due now, words in progress (working set), words introduced.
import type { ReactNode } from 'react'
import { StatTile, cx } from '../../components'
import type { ProgressNumbers } from './progressNumbers'

/**
 * One quiet line above the card, sharing its row with Undo and the card menu. It must stay on one
 * line at 375px even with the widest numbers ("999 due · 40/40 in progress · 1000 words"), so on
 * phones the gaps are a plain space wide and the word total ("/1000") is left to the tooltip.
 */
export function ProgressLine({ p, className }: { p: ProgressNumbers; className?: string }) {
  const item = (value: ReactNode, label: string, title: string) => (
    <span title={title} className="whitespace-nowrap">
      <span className="font-semibold text-ink tabular-nums">{value}</span> {label}
    </span>
  )
  return (
    <p aria-label="Progress" className={cx('flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[0.8125rem] text-muted sm:gap-x-3 sm:text-sm', className)}>
      {item(String(p.due), 'due', 'Cards due now')}
      <span aria-hidden className="text-faint">
        ·
      </span>
      {item(`${p.inProgress}/${p.cap}`, 'in progress', 'Words in progress (the working set) / its cap: new words wait while it is full')}
      <span aria-hidden className="text-faint">
        ·
      </span>
      {item(
        <>
          {p.introduced}
          <span className="max-sm:hidden">/{p.total}</span>
        </>,
        'words',
        `Words introduced so far, of ${p.total}`,
      )}
    </p>
  )
}

/** Tiles for the start and caught-up screens. */
export function ProgressTiles({ p }: { p: ProgressNumbers }) {
  return (
    <div className="grid w-full grid-cols-3 gap-2.5">
      <StatTile label="Due now" value={p.due} className="p-3" />
      <StatTile label="In progress" value={p.inProgress} hint={`of ${p.cap}`} className="p-3" />
      <StatTile label="Words" value={p.introduced} hint={`of ${p.total}`} className="p-3" />
    </div>
  )
}
