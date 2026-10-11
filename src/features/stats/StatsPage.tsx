// Stats: headline tiles, progress through the word list, review heatmap, accuracy (Listen vs Say),
// upcoming reviews, hardest words and flagged cards. Lazy-loaded (recharts stays out of the main
// bundle); all numbers come from the pure model in ./statsModel.ts.
import { useMemo } from 'react'
import { Link } from 'react-router'
import { buttonClasses, EmptyState, Icon, PageHeader, StatTile, useNow, useSnapshot } from '../../components'
import { getWords, type WordIndex } from '../../lib/words'
import { AccuracySection } from './AccuracySection'
import { ForecastSection } from './ForecastSection'
import { HeatmapSection } from './HeatmapSection'
import { ProgressSection } from './ProgressSection'
import { exportOpenFlags } from './flagsExport'
import { buildStatsModel, formatDuration, percent, plural } from './statsModel'
import { FlaggedSection, HardestSection } from './WordsSections'
import './stats.css'

/** How often Stats re-reads the clock while open (it also refreshes on resume). */
const STATS_CLOCK_MS = 5 * 60_000

export interface StatsPageProps {
  /** Word list (defaults to the app's words.json); tests pass fixtures. */
  words?: WordIndex
  /** Clock override for tests. */
  now?: number
}

export default function StatsPage({ words: wordsProp, now: nowProp }: StatsPageProps = {}) {
  const snap = useSnapshot()
  const words = wordsProp ?? getWords()
  const { derived, events, revision } = snap
  // "now" ticks every few minutes and on resume (useNow listens for visibilitychange), so an installed app left on
  // Stats overnight rolls over to the new day; it is also re-read whenever the log changes (each review).
  const tick = useNow(STATS_CLOCK_MS)
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- tick and revision are the refresh triggers
  const now = useMemo(() => nowProp ?? Math.max(tick, Date.now()), [nowProp, tick, revision])
  const model = useMemo(() => buildStatsModel({ derived, events, words, now }), [derived, events, words, now])
  const exportFlags = () => void exportOpenFlags(derived, words)

  if (model.empty) {
    return (
      <>
        <PageHeader title="Stats" />
        <EmptyState
          icon="stats"
          title="Nothing to show yet"
          action={
            <Link to="/" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
              <Icon name="study" size={20} />
              Start studying
            </Link>
          }
        >
          Your progress through the {model.totalWords.toLocaleString('en-US')} words, daily streak and accuracy will appear here
          after your first few cards.
        </EmptyState>
        {model.flags.open ? <FlaggedSection open={model.flags.open} words={model.flags.words} onExport={exportFlags} /> : null}
      </>
    )
  }

  const acc = percent(model.accuracy)
  const streakHint = model.streak.days === 0 ? 'study today to start one' : model.streak.studiedToday ? 'including today' : 'study today to keep it'

  return (
    <div className="qian-stats flex flex-col gap-5 pb-4">
      <PageHeader title="Stats" className="mb-1" />

      <section aria-label="Overview" className="grid grid-cols-2 gap-3">
        <StatTile
          label="Words introduced"
          accent
          value={model.introduced.toLocaleString('en-US')}
          hint={`of ${model.totalWords.toLocaleString('en-US')}`}
        />
        <StatTile label="Known words" value={model.known.toLocaleString('en-US')} hint={`${model.mature.toLocaleString('en-US')} mature`} />
        <StatTile label="Streak" icon="flame" value={plural(model.streak.days, 'day')} hint={streakHint} />
        <StatTile label="Reviews today" value={model.reviewsToday.toLocaleString('en-US')} hint={`${model.totalGradings.toLocaleString('en-US')} all time`} />
        <StatTile label="Time today" icon="clock" value={formatDuration(model.timeTodayMs)} hint={`${formatDuration(model.timeTotalMs)} total`} />
        <StatTile label="Accuracy" value={acc === null ? '–' : `${acc}%`} hint={acc === null ? 'no reviews yet' : `of ${plural(model.accuracy.total, 'review')}`} />
      </section>

      <ProgressSection progress={model.progress} totalWords={model.totalWords} />
      <HeatmapSection daily={model.daily} now={now} />
      <AccuracySection series={model.accuracySeries} byDir={model.accuracyByDir} />
      <ForecastSection points={model.forecast} />
      <HardestSection words={model.hardest} />
      <FlaggedSection open={model.flags.open} words={model.flags.words} onExport={exportFlags} />
    </div>
  )
}
