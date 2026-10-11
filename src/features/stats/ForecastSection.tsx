// Due cards per day for the next two weeks (today includes anything overdue).
import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from 'recharts'
import { plural, type ForecastPoint } from './statsModel'
import { DataTable, Section, TooltipBox, type TipProps } from './parts'
import { useReducedMotion } from './hooks'

function ForecastTooltip({ active, payload }: TipProps) {
  const p = payload?.[0]?.payload as ForecastPoint | undefined
  if (!active || !p) return null
  return <TooltipBox title={p.long}>{plural(p.due, 'card')} due</TooltipBox>
}

export function ForecastSection({ points }: { points: ForecastPoint[] }) {
  const reduced = useReducedMotion()
  const today = points[0]?.due ?? 0
  const week = points.slice(0, 7).reduce((n, p) => n + p.due, 0)
  const total = points.reduce((n, p) => n + p.due, 0)
  const peak = points.reduce<ForecastPoint | null>((m, p) => (p.due > (m?.due ?? 0) ? p : m), null)
  // Label only today's bar and the busiest day; the axis and tooltip carry the rest.
  const labelled = new Set([points[0]?.key, peak?.key])

  const summary = total
    ? `${plural(today, 'card')} due today, ${week.toLocaleString('en-US')} over the next 7 days.` +
      (peak && peak.key !== points[0]?.key ? ` Busiest: ${peak.long}, ${peak.due}.` : '')
    : 'Nothing scheduled in the next two weeks.'

  return (
    <Section id="stats-forecast" title="Upcoming reviews" summary={summary}>
      {total ? (
        <>
          <div aria-hidden className="-mx-1">
            <BarChart
              responsive
              data={points}
              style={{ width: '100%', height: 180 }}
              margin={{ top: 18, right: 4, bottom: 0, left: 0 }}
              barCategoryGap={2}
              accessibilityLayer={false}
            >
              <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: 'var(--viz-axis)' }}
                tick={{ fill: 'var(--muted)', fontSize: 12 }}
                interval="preserveStartEnd"
                minTickGap={8}
                tickMargin={6}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--muted)', fontSize: 12 }}
                width={36}
              />
              <Tooltip content={(props) => <ForecastTooltip active={props.active} payload={props.payload} />} cursor={{ fill: 'var(--sunken)' }} isAnimationActive={!reduced} />
              <Bar dataKey="due" name="Due" fill="var(--viz-bar)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reduced}>
                <LabelList
                  dataKey="due"
                  position="top"
                  content={(props) => {
                    const { x, y, width, value, index } = props as { x: number; y: number; width: number; value: number; index: number }
                    const p = points[index]
                    if (!p || !labelled.has(p.key) || !value) return null
                    return (
                      <text x={Number(x) + Number(width) / 2} y={Number(y) - 6} textAnchor="middle" fontSize={12} fill="var(--ink)">
                        {value}
                      </text>
                    )
                  }}
                />
              </Bar>
            </BarChart>
          </div>
          <DataTable caption="Cards due per day, next 14 days" head={['Day', 'Due']} rows={points.map((p) => [p.long, p.due])} />
        </>
      ) : null}
    </Section>
  )
}
