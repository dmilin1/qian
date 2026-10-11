// Hardest words (most lapses) and flagged cards.
import { Link } from 'react-router'
import { AudioButton, Button, buttonClasses, Hanzi, Icon, Pinyin } from '../../components'
import { plural, type HardWord } from './statsModel'
import { Section } from './parts'

/** Words page filter for open flags (the words page keeps its filter in `?f=`). */
export const FLAGGED_WORDS_HREF = '/words?f=flagged'

function HardCounts({ h }: { h: HardWord }) {
  return (
    <span className="flex shrink-0 flex-col items-end text-sm leading-tight tabular-nums">
      {h.lapses ? <span className="text-ink">{plural(h.lapses, 'lapse')}</span> : null}
      <span className={h.lapses ? 'text-muted' : 'text-ink'}>{plural(h.misses, 'miss', 'misses')}</span>
    </span>
  )
}

export function HardestSection({ words }: { words: HardWord[] }) {
  return (
    <Section
      id="stats-hardest"
      title="Hardest words"
      summary={
        words.length
          ? 'Most often forgotten after being learned, then most "Again" presses.'
          : 'No misses yet. Words you forget will show up here.'
      }
    >
      {words.length ? (
        <ol className="-mx-2 flex flex-col">
          {words.map((h) => (
            <li key={h.word.id} className="flex items-center gap-1 border-t border-line first:border-t-0">
              <AudioButton wordId={h.word.id} kind="word" size="md" emphasis="quiet" label={`Play “${h.word.gloss}”`} />
              <Link
                to={`/words/${encodeURIComponent(h.word.id)}`}
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 hover:bg-sunken"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-baseline gap-2 overflow-hidden whitespace-nowrap">
                    <Pinyin word={h.word} size="md" className="font-medium" />
                    <Hanzi word={h.word} size="sm" />
                  </span>
                  <span className="truncate text-sm text-muted">{h.word.gloss}</span>
                </span>
                <HardCounts h={h} />
                <Icon name="chevron-right" size={16} className="shrink-0 text-faint" />
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </Section>
  )
}

export function FlaggedSection({ open, words, onExport }: { open: number; words: number; onExport?: () => void }) {
  return (
    <Section
      id="stats-flags"
      title="Flagged cards"
      summary={
        open
          ? `${plural(open, 'open flag')} on ${plural(words, 'word')} (bad audio, pinyin or meaning).`
          : 'No open flags. Flag a card while studying if its audio, pinyin or meaning looks wrong.'
      }
      action={
        open ? (
          <Link to={FLAGGED_WORDS_HREF} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            <Icon name="flag" size={16} />
            Review
          </Link>
        ) : null
      }
    >
      {open && onExport ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button size="sm" variant="secondary" icon="download" onClick={onExport}>
            Export flags (CSV)
          </Button>
          <span className="text-sm text-muted">A list to send to whoever fixes the word data.</span>
        </div>
      ) : null}
    </Section>
  )
}
