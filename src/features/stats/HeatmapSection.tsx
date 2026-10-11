// Calendar heatmap of daily reviews: plain SVG (weeks as columns, Monday on top). The number of
// weeks adapts to the available width (about 6 months on desktop, 4+ on a phone) so cells and
// labels never shrink below a legible size; on wide screens the SVG scales up to fill the card.
import { useMemo, useState } from 'react'
import { buildHeatmap, formatLongDate, plural, type HeatCell } from './statsModel'
import { Section } from './parts'
import { useElementWidth } from './hooks'

const CELL = 12
const GAP = 2
const STEP = CELL + GAP
const LEFT = 28 // weekday labels
const TOP = 16 // month labels
const MAX_WEEKS = 26
const MIN_WEEKS = 12
const DAY_LABELS: [number, string][] = [
  [0, 'Mon'],
  [2, 'Wed'],
  [4, 'Fri'],
]

export function HeatmapSection({ daily, now }: { daily: ReadonlyMap<string, number>; now: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const weeks = width ? Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.floor((width - LEFT + GAP) / STEP))) : MAX_WEEKS
  const map = useMemo(() => buildHeatmap(daily, now, weeks), [daily, now, weeks])
  const [active, setActive] = useState<HeatCell | null>(null)

  const w = LEFT + weeks * STEP - GAP
  const h = TOP + 7 * STEP - GAP
  const months = Math.round(weeks / 4.35)
  const summary = map.total
    ? `${plural(map.total, 'review')} on ${plural(map.activeDays, 'day')} in the last ${months} months.` +
      (map.best ? ` Best day: ${formatLongDate(map.best.ts)}, ${map.best.count}.` : '')
    : `No reviews in the last ${months} months.`

  const readout = active
    ? `${formatLongDate(active.ts)}${active.today ? ' (today)' : ''}: ${active.future ? 'upcoming' : plural(active.count, 'review')}`
    : null

  return (
    <Section id="stats-heatmap" title="Daily reviews" summary={summary}>
      <div ref={ref} className="w-full">
        <svg
          role="img"
          aria-labelledby="stats-heatmap-title stats-heatmap-summary"
          viewBox={`0 0 ${w} ${h}`}
          className="block h-auto w-full"
          onPointerLeave={() => setActive(null)}
        >
          {map.months.map((m) => (
            <text key={`${m.col}-${m.label}`} x={LEFT + m.col * STEP} y={10} fontSize={10} fill="var(--muted)">
              {m.label}
            </text>
          ))}
          {DAY_LABELS.map(([row, label]) => (
            <text key={label} x={0} y={TOP + row * STEP + CELL - 2} fontSize={10} fill="var(--muted)">
              {label}
            </text>
          ))}
          {map.weeks.map((col, ci) =>
            col.map((c, ri) =>
              c.future ? null : (
                <rect
                  key={c.key}
                  data-day={c.key}
                  data-level={c.level}
                  x={LEFT + ci * STEP}
                  y={TOP + ri * STEP}
                  width={CELL}
                  height={CELL}
                  rx={3}
                  fill={`var(--viz-heat-${c.level})`}
                  stroke={c.today ? 'var(--ink)' : active?.key === c.key ? 'var(--muted)' : 'none'}
                  strokeWidth={c.today || active?.key === c.key ? 1.5 : 0}
                  onPointerEnter={() => setActive(c)}
                  onClick={() => setActive(c)}
                />
              ),
            ),
          )}
        </svg>
      </div>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <span className="text-muted tabular-nums" aria-live="polite">
          {readout ?? <span className="text-muted">Tap a day for its count</span>}
        </span>
        <span className="flex items-center gap-1.5 text-faint" aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((lv) => (
            <span key={lv} className="inline-block h-3 w-3 rounded-[3px]" style={{ background: `var(--viz-heat-${lv})` }} />
          ))}
          More
        </span>
      </div>
    </Section>
  )
}
