// Progress through the word list: one segmented bar per direction (learning / young / mature on a
// "not started" track), with a combined legend + count table underneath.
import type { ProgressCounts, StatusCounts } from '../../lib/stats'
import { Section, Swatch } from './parts'

type Seg = 'learning' | 'young' | 'mature'
const SEGMENTS: { key: Seg; label: string; color: string; help: string }[] = [
  { key: 'learning', label: 'Learning', color: 'var(--viz-learning)', help: 'in short learning steps' },
  { key: 'young', label: 'Young', color: 'var(--viz-young)', help: 'remembered for under 3 weeks' },
  { key: 'mature', label: 'Mature', color: 'var(--viz-mature)', help: 'remembered for 3 weeks or more' },
]

const DIR_LABEL = { listen: 'Listen', say: 'Say' } as const

function SegmentedBar({ counts, total, label }: { counts: StatusCounts; total: number; label: string }) {
  const started = counts.learning + counts.young + counts.mature
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-muted tabular-nums">
          {started.toLocaleString('en-US')} / {total.toLocaleString('en-US')} started
        </span>
      </div>
      {/* Segments touch through a 2px track-colored gap; tiny non-zero segments stay visible. */}
      <div aria-hidden className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" style={{ background: 'var(--viz-track)' }}>
        {SEGMENTS.map((s) =>
          counts[s.key] > 0 ? (
            <span
              key={s.key}
              data-segment={s.key}
              className="h-full"
              style={{ width: `${(100 * counts[s.key]) / Math.max(1, total)}%`, minWidth: 4, background: s.color }}
            />
          ) : null,
        )}
      </div>
    </div>
  )
}

export function ProgressSection({ progress, totalWords }: { progress: ProgressCounts; totalWords: number }) {
  const l = progress.listen
  const s = progress.say
  const started = (c: StatusCounts) => c.learning + c.young + c.mature
  const summary = `Listen cards: ${started(l)} started, ${l.mature} mature. Say cards: ${started(s)} started, ${s.mature} mature.`
  return (
    <Section id="stats-progress" title={`Progress through the ${totalWords.toLocaleString('en-US')}`} summary={summary}>
      <div className="flex flex-col gap-4">
        <SegmentedBar counts={l} total={totalWords} label={DIR_LABEL.listen} />
        <SegmentedBar counts={s} total={totalWords} label={DIR_LABEL.say} />
      </div>
      {/* Legend doubles as the table view. */}
      <table className="w-full text-sm tabular-nums">
        <caption className="sr-only">Cards by status and direction</caption>
        <thead>
          <tr className="text-muted">
            <th scope="col" className="pb-1 text-left font-normal">
              <span className="sr-only">Status</span>
            </th>
            <th scope="col" className="w-16 pb-1 text-right font-normal">
              Listen
            </th>
            <th scope="col" className="w-16 pb-1 text-right font-normal">
              Say
            </th>
          </tr>
        </thead>
        <tbody>
          {SEGMENTS.map((seg) => (
            <tr key={seg.key} className="border-t border-line">
              <th scope="row" className="py-1.5 text-left font-normal">
                <span className="flex items-center gap-2">
                  <Swatch color={seg.color} />
                  <span className="text-ink">{seg.label}</span>
                  <span className="hidden truncate text-faint min-[400px]:inline">{seg.help}</span>
                </span>
              </th>
              <td className="py-1.5 text-right text-ink">{l[seg.key].toLocaleString('en-US')}</td>
              <td className="py-1.5 text-right text-ink">{s[seg.key].toLocaleString('en-US')}</td>
            </tr>
          ))}
          <tr className="border-t border-line">
            <th scope="row" className="py-1.5 text-left font-normal">
              <span className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-[3px] border border-line-strong" style={{ background: 'var(--viz-track)' }} />
                <span className="text-ink">Not started</span>
              </span>
            </th>
            <td className="py-1.5 text-right text-muted">{l.unseen.toLocaleString('en-US')}</td>
            <td className="py-1.5 text-right text-muted">{s.unseen.toLocaleString('en-US')}</td>
          </tr>
          {l.suspended > 0 ? (
            <tr className="border-t border-line">
              <th scope="row" className="py-1.5 pl-5 text-left font-normal text-muted">
                Suspended
              </th>
              <td className="py-1.5 text-right text-muted">{l.suspended.toLocaleString('en-US')}</td>
              <td className="py-1.5 text-right text-muted">{s.suspended.toLocaleString('en-US')}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </Section>
  )
}
