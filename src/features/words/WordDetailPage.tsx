// Word detail: big pinyin + audio (normal and slow), characters, meaning, example sentence,
// per-direction FSRS card stats, the full review history, suspend/unsuspend and flags.
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import type { Word } from '../../data/types'
import {
  AudioButton,
  Banner,
  Button,
  buttonClasses,
  Card,
  cx,
  EmptyState,
  FlagDialog,
  Hanzi,
  Icon,
  Pinyin,
  useNow,
  usePageTitle,
  useSelector,
  useStore,
} from '../../components'
import { cardStateName, getCard, isSuspended, type CardState, type Derived, type FlagRecord } from '../../lib/derive'
import type { AppEvent, Dir, FlagReason } from '../../lib/events'
import { getFsrs, retrievability, State } from '../../lib/fsrs'
import { cardStatus, wordHistory } from '../../lib/stats'
import { getWords, type WordIndex } from '../../lib/words'
import {
  FLAG_REASON_SHORT,
  formatDate,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRelative,
  formatStability,
  posLabel,
} from './format'
import { DirStatusChip, FlaggedChip, SuspendedChip } from './StatusChip'

export interface WordDetailPageProps {
  /** Word list (defaults to the app's words.json; tests pass fixtures). */
  words?: WordIndex
}

interface ListState {
  fromList?: boolean
}

const NO_FLAGS: readonly FlagRecord[] = []

export default function WordDetailPage({ words = getWords() }: WordDetailPageProps) {
  const { id = '' } = useParams()
  const word = words.get(id)
  usePageTitle(word ? `${word.pinyin} ${word.trad}` : 'Word not found')

  if (!word) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon="words"
          title="Word not found"
          action={
            <Link to="/words" className={buttonClasses({ variant: 'secondary' })}>
              All words
            </Link>
          }
        >
          This word isn’t in the current word list.
        </EmptyState>
      </>
    )
  }
  return <WordDetail key={word.id} word={word} words={words} />
}

function BackLink() {
  const location = useLocation()
  const navigate = useNavigate()
  const fromList = (location.state as ListState | null)?.fromList === true
  return (
    <Link
      to="/words"
      onClick={(e) => {
        // Came from the list: go back so its search, filter and scroll position are restored.
        if (fromList && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault()
          void navigate(-1)
        }
      }}
      className="-ml-2 mb-4 inline-flex h-10 items-center gap-1 self-start rounded-xl pr-3 pl-1.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
    >
      <Icon name="chevron-left" size={20} />
      Words
    </Link>
  )
}

function WordDetail({ word, words }: { word: Word; words: WordIndex }) {
  const store = useStore()
  const derived = useSelector((s) => s.derived)
  const now = useNow()
  const suspended = isSuspended(derived, word.id)
  const flags = derived.words.get(word.id)?.flags ?? NO_FLAGS
  const openByReason = useMemo(() => groupOpenFlags(flags), [flags])
  const [flagOpen, setFlagOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const listen = getCard(derived, word.id, 'listen')
  const say = getCard(derived, word.id, 'say')

  return (
    <div className="flex flex-col">
      <BackLink />

      {/* ----- hero ----- */}
      <Card padding="lg" className="flex flex-col items-center gap-3 text-center motion-safe:animate-fade-in">
        <p className="text-sm text-muted">
          <span className="tabular-nums">#{word.rank}</span>
          <span aria-hidden> · </span>
          <span className="sr-only">, </span>
          {posLabel(word.pos)}
        </p>
        <h1 className="max-w-full wrap-break-word">
          <Pinyin word={word} size="hero" />
        </h1>
        {word.spokenAs ? (
          <p className="-mt-1 flex items-baseline gap-1.5 text-sm text-muted">
            spoken as <Pinyin text={word.spokenAs} size="md" />
          </p>
        ) : null}
        <Hanzi word={word} size="xl" force showSimp />
        <div className="mt-2 flex items-center gap-3">
          <AudioButton wordId={word.id} size="lg" emphasis="primary" label="Play word" />
          <AudioButton wordId={word.id} slow size="md" label="Play word slowly">
            Slow
          </AudioButton>
        </div>
        {(suspended || openByReason.size > 0) && (
          <div className="mt-1 flex flex-wrap justify-center gap-1.5">
            {suspended ? <SuspendedChip /> : null}
            {openByReason.size > 0 ? <FlaggedChip count={countOpen(flags)} /> : null}
          </div>
        )}
      </Card>

      {/* ----- meaning ----- */}
      <Section title="Meaning">
        <p className="text-xl leading-snug text-ink">{word.gloss}</p>
        {word.hint ? (
          <p className="mt-1 text-muted">
            <span className="text-ink/80">Hint on the Say card:</span> {word.hint}
          </p>
        ) : null}
        {word.note ? <p className="mt-3 rounded-xl bg-sunken px-4 py-3 text-[0.9375rem] leading-relaxed text-ink">{word.note}</p> : null}
      </Section>

      {/* ----- example ----- */}
      {word.example ? (
        <Section title="Example">
          <Card tone="flat" padding="md" className="flex flex-col gap-2">
            <Pinyin text={word.example.pinyin} size="lg" as="p" />
            <Hanzi text={word.example.trad} size="md" force />
            <p className="text-muted">{word.example.english}</p>
            <div className="mt-2 flex items-center gap-2">
              <AudioButton wordId={word.id} kind="example" size="md" label="Play example">
                Play
              </AudioButton>
              <AudioButton wordId={word.id} kind="example" slow size="md" label="Play example slowly">
                Slow
              </AudioButton>
            </div>
          </Card>
        </Section>
      ) : null}

      {/* ----- cards ----- */}
      <Section title="Cards">
        <div className="grid gap-3 sm:grid-cols-2">
          <CardStats dir="listen" card={listen} derived={derived} now={now} word={word} suspended={suspended} />
          <CardStats dir="say" card={say} derived={derived} now={now} word={word} suspended={suspended} listen={listen} />
        </div>
      </Section>

      {/* ----- actions + flags ----- */}
      <Section title="Manage">
        {notice ? (
          <Banner tone="success" onDismiss={() => setNotice(null)} className="mb-3">
            {notice}
          </Banner>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            icon={suspended ? 'play' : 'pause'}
            className="sm:flex-1"
            aria-pressed={suspended}
            onClick={() => {
              void store.setSuspended(word.id, !suspended)
              setNotice(suspended ? 'Unsuspended. This word will be scheduled again.' : 'Suspended. This word won’t come up until you unsuspend it.')
            }}
          >
            {suspended ? 'Unsuspend' : 'Suspend'}
          </Button>
          <Button variant="secondary" icon="flag" className="sm:flex-1" onClick={() => setFlagOpen(true)}>
            Flag a problem
          </Button>
        </div>
        {suspended ? <p className="mt-2 text-sm text-muted">Suspended words are skipped when studying.</p> : null}

        {openByReason.size > 0 ? (
          <ul className="mt-4 flex flex-col gap-2" aria-label="Open flags">
            {[...openByReason].map(([reason, list]) => (
              <li key={reason} className="flex items-start gap-3 rounded-xl border border-danger/25 bg-danger-soft/60 px-4 py-3">
                <Icon name="flag" size={18} className="mt-0.5 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{FLAG_REASON_SHORT[reason]}</p>
                  {list.map((f) => (
                    <p key={f.id} className="text-sm text-muted">
                      {f.note ? <span className="text-ink/85">“{f.note}” · </span> : null}
                      {formatDate(f.ts)}
                    </p>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="check"
                  onClick={() => {
                    void store.resolveFlag(word.id, reason)
                    setNotice(`${FLAG_REASON_SHORT[reason]} flag resolved.`)
                  }}
                  aria-label={`Resolve ${FLAG_REASON_SHORT[reason].toLowerCase()} flag`}
                >
                  Resolve
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {/* ----- history ----- */}
      <Section title="History">
        <History derived={derived} wordId={word.id} />
      </Section>

      <Neighbors word={word} words={words} />

      <FlagDialog
        open={flagOpen}
        wordLabel={`${word.pinyin} “${word.gloss}”`}
        onClose={() => setFlagOpen(false)}
        onSubmit={(reason, note) => {
          void store.flag(word.id, reason, note || undefined)
          setFlagOpen(false)
          setNotice('Flag saved. Thanks, it’s in the flagged list.')
        }}
      />
    </div>
  )
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx('mt-8', className)}>
      <h2 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted uppercase">{title}</h2>
      {children}
    </section>
  )
}

function countOpen(flags: readonly FlagRecord[]): number {
  return flags.filter((f) => !f.resolved).length
}

function groupOpenFlags(flags: readonly FlagRecord[]): Map<FlagReason, FlagRecord[]> {
  const m = new Map<FlagReason, FlagRecord[]>()
  for (const f of flags) {
    if (f.resolved) continue
    const list = m.get(f.reason) ?? []
    list.push(f)
    m.set(f.reason, list)
  }
  return m
}

// ---------- per-direction stats ----------

const STATE_LABEL = { new: 'New', learning: 'Learning', review: 'Review', relearning: 'Relearning' } as const

function CardStats({
  dir,
  card,
  listen,
  derived,
  now,
  word,
  suspended,
}: {
  dir: Dir
  card: CardState | undefined
  listen?: CardState
  derived: Derived
  now: number
  word: Word
  suspended: boolean
}) {
  const title = dir === 'listen' ? 'Listen' : 'Say'
  const subtitle = dir === 'listen' ? 'Hear it, recall the meaning' : 'See the meaning, say it'
  const status = cardStatus(card)
  const headingId = `card-${dir}`
  return (
    <Card tone="flat" padding="md" as="article" aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <h3 id={headingId} className="font-semibold text-ink">
            {title}
          </h3>
          <span className="text-sm text-muted">{subtitle}</span>
        </div>
        <DirStatusChip dir={dir} status={status} />
      </div>
      {card && card.card.state !== State.New ? (
        <CardNumbers card={card} derived={derived} now={now} suspended={suspended} />
      ) : (
        <p className="text-sm text-muted">
          {dir === 'listen'
            ? `Not introduced yet. New words come in frequency order; this one is #${word.rank}.`
            : listen && cardStateName(listen) !== 'learning'
              ? 'Not introduced yet. It’s ready and will come up as a new card soon.'
              : 'Not introduced yet. The Say card unlocks once the Listen card graduates from learning.'}
        </p>
      )}
    </Card>
  )
}

function CardNumbers({ card, derived, now, suspended }: { card: CardState; derived: Derived; now: number; suspended: boolean }) {
  const c = card.card
  const r = retrievability(getFsrs(derived.requestRetention), c, now)
  const due = c.due.getTime()
  const overdue = due <= now
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
      <Stat label="State">{STATE_LABEL[cardStateName(card)]}</Stat>
      <Stat label="Recall now" hint="Estimated chance you’d remember it right now (FSRS retrievability)">
        {formatPercent(r)}
      </Stat>
      <Stat label="Due" className="col-span-2">
        {suspended ? (
          <span className="text-muted">Suspended</span>
        ) : (
          <>
            <span className={overdue ? 'text-accent' : undefined}>{overdue ? (now - due < 60_000 ? 'now' : `overdue, ${formatRelative(due, now)}`) : formatRelative(due, now)}</span>
            <span className="text-muted"> · {formatDateTime(due)}</span>
          </>
        )}
      </Stat>
      <Stat label="Stability" hint="Time until recall drops to 90%">
        {formatStability(c.stability)}
      </Stat>
      <Stat label="Difficulty" hint="FSRS difficulty, 1 (easy) to 10 (hard)">
        {c.difficulty.toFixed(1)}
        <span className="text-muted"> / 10</span>
      </Stat>
      <Stat label="Reviews">{c.reps}</Stat>
      <Stat label="Lapses">{c.lapses}</Stat>
      <Stat label="First seen" className="col-span-2">
        {formatDate(card.introducedAt)}
        {c.last_review ? <span className="text-muted"> · last {formatRelative(c.last_review.getTime(), now)}</span> : null}
      </Stat>
    </dl>
  )
}

function Stat({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <dt className="text-xs text-muted" title={hint}>
        {label}
      </dt>
      <dd className="font-medium text-ink tabular-nums">{children}</dd>
    </div>
  )
}

// ---------- history ----------

const HISTORY_PAGE = 50

const GRADE_STYLE: Record<string, { label: string; dot: string }> = {
  again: { label: 'Again', dot: 'bg-danger' },
  good: { label: 'Good', dot: 'bg-success' },
  easy: { label: 'Easy', dot: 'bg-tone-3' },
  known: { label: 'I already know this', dot: 'bg-tone-3' },
}

function History({ derived, wordId }: { derived: Derived; wordId: string }) {
  const entries = useMemo(() => wordHistory(derived, wordId).slice().reverse(), [derived, wordId])
  const [showAll, setShowAll] = useState(false)
  if (entries.length === 0) {
    return <p className="text-muted">No reviews yet.</p>
  }
  const shown = showAll ? entries : entries.slice(0, HISTORY_PAGE)
  return (
    <>
      <ol className="relative flex flex-col" aria-label="Review history, newest first">
        {shown.map((h, i) => (
          <HistoryItem key={h.event.id} event={h.event} last={i === shown.length - 1} />
        ))}
      </ol>
      {!showAll && entries.length > HISTORY_PAGE ? (
        <Button variant="ghost" size="sm" className="mt-2 self-start" onClick={() => setShowAll(true)}>
          Show all {entries.length}
        </Button>
      ) : null}
    </>
  )
}

function HistoryItem({ event: e, last }: { event: AppEvent; last: boolean }) {
  let dot = 'bg-faint'
  let title: ReactNode
  let detail: ReactNode = null
  switch (e.kind) {
    case 'review': {
      const g = GRADE_STYLE[e.grade]
      dot = g.dot
      title = (
        <>
          {e.dir === 'listen' ? 'Listen' : 'Say'} <span className="text-muted">·</span> {g.label}
        </>
      )
      if (e.elapsedMs) detail = formatDuration(e.elapsedMs)
      break
    }
    case 'known':
      dot = GRADE_STYLE.known.dot
      title = '“I already know this”'
      detail = 'Both cards scheduled as Easy'
      break
    case 'suspend':
      title = e.suspended ? 'Suspended' : 'Unsuspended'
      break
    case 'flag':
      dot = e.resolved ? 'bg-success' : 'bg-danger'
      title = `${e.resolved ? 'Resolved flag' : 'Flagged'}: ${FLAG_REASON_SHORT[e.reason]}`
      if (e.note) detail = `“${e.note}”`
      break
  }
  return (
    <li className="relative flex gap-3 pb-4 pl-1">
      {!last ? <span aria-hidden className="absolute top-4 bottom-0 left-2.75 w-px bg-line" /> : null}
      <span aria-hidden className={cx('relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-paper', dot)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium text-ink">{title}</span>
        <span className="text-sm text-muted">
          <time dateTime={new Date(e.ts).toISOString()}>{formatDateTime(e.ts)}</time>
          {detail ? <> · {detail}</> : null}
        </span>
      </div>
    </li>
  )
}

// ---------- previous / next ----------

function Neighbors({ word, words }: { word: Word; words: WordIndex }) {
  const location = useLocation()
  const i = words.indexOf(word.id)
  const prev = i > 0 ? words.list[i - 1] : undefined
  const next = i >= 0 && i < words.list.length - 1 ? words.list[i + 1] : undefined
  if (!prev && !next) return null
  // Replace the entry so "back" still returns to the list in one step.
  const link = (w: Word, side: 'prev' | 'next') => (
    <Link
      to={`/words/${encodeURIComponent(w.id)}`}
      replace
      state={location.state}
      className={cx(
        'flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 transition-colors duration-150 hover:bg-sunken',
        side === 'next' && 'flex-row-reverse text-right',
      )}
      aria-label={`${side === 'prev' ? 'Previous' : 'Next'} word: ${w.pinyin}, ${w.gloss}`}
    >
      <Icon name={side === 'prev' ? 'chevron-left' : 'chevron-right'} size={18} className="text-muted" />
      <span className="flex min-w-0 flex-col">
        <span className="text-xs text-muted tabular-nums">#{w.rank}</span>
        <Pinyin word={w} size="sm" className="truncate font-medium" />
      </span>
    </Link>
  )
  return (
    <nav aria-label="Other words" className="mt-10 flex gap-3">
      {prev ? link(prev, 'prev') : <span className="flex-1" />}
      {next ? link(next, 'next') : <span className="flex-1" />}
    </nav>
  )
}
