// Small building blocks shared by the Stats sections.
import type { ReactNode } from 'react'
import { Card, cx } from '../../components'

/** A titled card. `summary` is the chart's plain-language text alternative (always visible). */
export function Section({
  id,
  title,
  summary,
  action,
  children,
  className,
}: {
  id: string
  title: ReactNode
  summary?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <Card as="section" aria-labelledby={`${id}-title`} className={cx('flex flex-col gap-4', className)}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {summary ? (
            <p id={`${id}-summary`} className="text-sm text-muted">
              {summary}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </Card>
  )
}

/** The chart's table twin, collapsed by default. */
export function DataTable({ caption, head, rows }: { caption: string; head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <details className="group text-sm">
      <summary className="-mx-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted select-none hover:text-ink">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden className="transition-transform group-open:rotate-90">
          <path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Show data as a table
      </summary>
      <div className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-line">
        <table className="w-full text-left tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-sunken text-muted">
            <tr>
              {head.map((h, i) => (
                <th key={i} scope="col" className={cx('px-3 py-2 font-medium', i > 0 && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((c, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="px-3 py-1.5 font-normal text-ink">
                      {c}
                    </th>
                  ) : (
                    <td key={j} className="px-3 py-1.5 text-right text-ink">
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** The subset of recharts' tooltip content props we use. */
export interface TipProps {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: unknown }>
}

/** Tooltip box used by the recharts charts. */
export function TooltipBox({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-sm shadow-pop">
      <div className="mb-0.5 font-medium text-ink">{title}</div>
      <div className="flex flex-col gap-0.5 text-muted">{children}</div>
    </div>
  )
}

/** A colored key mark (dot, line or square) beside text; text itself stays in ink/muted. */
export function Swatch({ color, shape = 'square' }: { color: string; shape?: 'square' | 'dot' | 'line' }) {
  const cls = shape === 'line' ? 'h-0.5 w-3.5 rounded-full' : shape === 'dot' ? 'h-2.5 w-2.5 rounded-full' : 'h-3 w-3 rounded-[3px]'
  return <span aria-hidden className={cx('inline-block shrink-0', cls)} style={{ background: color }} />
}
