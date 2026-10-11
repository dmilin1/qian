// Accuracy over time, Listen vs Say (share of reviews not graded "Again"). Daily points while the
// history is short, weekly points (Monday weeks) after that.
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { Dir } from '../../lib/events'
import { percent, plural, type AccuracyPoint, type AccuracySeries, type Ratio } from './statsModel'
import { DataTable, Section, Swatch, TooltipBox, type TipProps } from './parts'
import { useReducedMotion } from './hooks'

const SERIES: { key: Dir; label: string; color: string }[] = [
  { key: 'listen', label: 'Listen', color: 'var(--viz-listen)' },
  { key: 'say', label: 'Say', color: 'var(--viz-say)' },
]

const fmtPct = (v: number | null) => (v === null ? '–' : `${Math.round(v)}%`)

function AccuracyTooltip({ active, payload, granularity }: TipProps & { granularity: AccuracySeries['granularity'] }) {
  const p = payload?.[0]?.payload as AccuracyPoint | undefined
  if (!active || !p) return null
  return (
    <TooltipBox title={granularity === 'week' ? `Week of ${p.label}` : p.label}>
      {SERIES.map((s) => {
        const n = s.key === 'listen' ? p.listenN : p.sayN
        return (
          <span key={s.key} className="flex items-center gap-2">
            <Swatch color={s.color} shape="dot" />
            <span className="text-ink">{s.label}</span>
            <span className="ml-auto pl-3 tabular-nums">{n ? `${fmtPct(p[s.key])} of ${n}` : 'no reviews'}</span>
          </span>
        )
      })}
    </TooltipBox>
  )
}

export function AccuracySection({ series, byDir }: { series: AccuracySeries; byDir: Record<Dir, Ratio> }) {
  const reduced = useReducedMotion()
  const { points, granularity } = series
  const values = points.flatMap((p) => [p.listen, p.say]).filter((v): v is number => v !== null)
  // Accuracy usually sits high; start the axis near the data (in steps of 10) rather than at 0,
  // but never hide how far it dips.
  const yMin = values.length ? Math.max(0, Math.min(50, Math.floor((Math.min(...values) - 5) / 10) * 10)) : 0
  const showDots = points.length <= 14

  const recent = recentWindow(points, granularity)
  const summary =
    SERIES.map((s) => {
      const p = percent(byDir[s.key])
      return p === null ? `${s.label}: no reviews yet` : `${s.label} ${p}% of ${plural(byDir[s.key].total, 'review')}`
    }).join(' · ') + (recent ? `. ${recent}` : '.')

  return (
    <Section id="stats-accuracy" title="Accuracy" summary={summary}>
      {/* Legend: always present for two series; the colored mark carries identity, text stays ink. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-2">
            <Swatch color={s.color} shape="line" />
            <span className="text-ink">{s.label}</span>
            <span className="text-muted tabular-nums">{fmtPct(percent(byDir[s.key]))}</span>
          </span>
        ))}
      </div>
      {points.length ? (
        <div aria-hidden className="-mx-1">
          <LineChart
            responsive
            data={points}
            style={{ width: '100%', height: 200 }}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: 'var(--viz-axis)' }}
              tick={{ fill: 'var(--muted)', fontSize: 12 }}
              minTickGap={16}
              interval="preserveStartEnd"
              tickMargin={6}
            />
            <YAxis
              domain={[yMin, 100]}
              ticks={yTicks(yMin)}
              tickFormatter={(v: number) => `${v}%`}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted)', fontSize: 12 }}
              width={44}
            />
            <Tooltip
              content={(props) => <AccuracyTooltip active={props.active} payload={props.payload} granularity={granularity} />}
              cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
              isAnimationActive={!reduced}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                type="monotone"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                connectNulls
                dot={showDots ? { r: 4, fill: s.color, stroke: 'var(--card)', strokeWidth: 2 } : false}
                activeDot={{ r: 5, fill: s.color, stroke: 'var(--card)', strokeWidth: 2 }}
                isAnimationActive={!reduced}
              />
            ))}
          </LineChart>
        </div>
      ) : null}
      {points.length ? (
        <DataTable
          caption={`Accuracy per ${granularity}, Listen and Say`}
          head={[granularity === 'week' ? 'Week of' : 'Day', 'Listen', 'Say']}
          rows={[...points]
            .reverse()
            .filter((p) => p.listenN || p.sayN)
            .map((p) => [p.label, p.listenN ? `${fmtPct(p.listen)} (${p.listenN})` : '–', p.sayN ? `${fmtPct(p.say)} (${p.sayN})` : '–'])}
        />
      ) : null}
    </Section>
  )
}

function yTicks(min: number): number[] {
  const step = 100 - min > 50 ? 25 : 10
  const out: number[] = []
  for (let v = 100; v >= min; v -= step) out.unshift(v)
  if (out[0] !== min) out.unshift(min)
  return out
}

/** "Last 4 weeks: Listen 91%, Say 84%" over the most recent buckets (pooled counts). */
function recentWindow(points: AccuracyPoint[], granularity: AccuracySeries['granularity']): string | null {
  if (points.length < 2) return null
  const n = Math.min(points.length, granularity === 'week' ? 4 : 7)
  const tail = points.slice(-n)
  const parts = SERIES.map((s) => {
    const r: Ratio = { correct: 0, total: 0 }
    for (const p of tail) {
      r.correct += s.key === 'listen' ? p.listenC : p.sayC
      r.total += s.key === 'listen' ? p.listenN : p.sayN
    }
    const v = percent(r)
    return v === null ? null : `${s.label} ${v}%`
  }).filter(Boolean)
  return parts.length ? `Last ${n} ${granularity}s: ${parts.join(', ')}` : null
}
