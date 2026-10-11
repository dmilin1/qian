// Small status chips for the word list and detail page. A tiny "stage" circle fills up as a card
// matures (empty = unseen, a third = learning, two thirds = young, full = mature), so the status
// reads without relying on color alone.
import { cx, Icon } from '../../components'
import type { CardStatus } from '../../lib/stats'
import { STATUS_LABEL } from './format'

const FILL: Record<CardStatus, number> = { unseen: 0, learning: 1 / 3, young: 2 / 3, mature: 1 }

const COLOR: Record<CardStatus, string> = {
  unseen: 'text-faint',
  learning: 'text-accent',
  young: 'text-success',
  mature: 'text-success',
}

/** Pie-style stage glyph (decorative). */
export function StageGlyph({ status, size = 12, className }: { status: CardStatus; size?: number; className?: string }) {
  const f = FILL[status]
  const r = 5
  // Pie slice from 12 o'clock, clockwise.
  const a = f * 2 * Math.PI
  const x = 6 + r * Math.sin(a)
  const y = 6 - r * Math.cos(a)
  const large = f > 0.5 ? 1 : 0
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden focusable="false" className={cx('shrink-0', COLOR[status], className)}>
      <circle cx="6" cy="6" r={r} fill="none" stroke="currentColor" strokeWidth="1.4" />
      {f >= 1 ? (
        <circle cx="6" cy="6" r={r} fill="currentColor" />
      ) : f > 0 ? (
        <path d={`M6 6 L6 1 A${r} ${r} 0 ${large} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z`} fill="currentColor" />
      ) : null}
    </svg>
  )
}

const CHIP = 'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs leading-none whitespace-nowrap'

/** "Listen · learning" */
export function DirStatusChip({ dir, status, className }: { dir: 'listen' | 'say'; status: CardStatus; className?: string }) {
  const name = dir === 'listen' ? 'Listen' : 'Say'
  return (
    <span className={cx(CHIP, 'border-line bg-card text-muted', className)} data-status={status}>
      <StageGlyph status={status} />
      <span>
        <span className="text-ink/80">{name}</span>
        <span aria-hidden> · </span>
        <span className="sr-only">: </span>
        {STATUS_LABEL[status]}
      </span>
    </span>
  )
}

export function SuspendedChip({ className }: { className?: string }) {
  return (
    <span className={cx(CHIP, 'border-line-strong border-dashed bg-sunken text-muted', className)}>
      <Icon name="pause" size={11} />
      Suspended
    </span>
  )
}

export function FlaggedChip({ count = 1, className }: { count?: number; className?: string }) {
  return (
    <span className={cx(CHIP, 'border-danger/30 bg-danger-soft text-danger', className)}>
      <Icon name="flag" size={12} />
      {count > 1 ? `Flagged (${count})` : 'Flagged'}
    </span>
  )
}

/** Both cards unseen: one quiet chip instead of two ("Listen · unseen", "Say · unseen"). */
export function UnseenChip({ className }: { className?: string }) {
  return (
    <span className={cx(CHIP, 'border-transparent bg-sunken/70 text-muted', className)} data-status="unseen">
      <StageGlyph status="unseen" />
      <span>
        Unseen<span className="sr-only">: listen and say cards not started</span>
      </span>
    </span>
  )
}
