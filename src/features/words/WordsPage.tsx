// Word list: all words in frequency order, searchable (English, characters, pinyin with or without
// tones) and filterable by learning status. Rows are windowed (fixed height) so 1000 words stay
// cheap to render. The query and filter live in the URL (?q=&f=) so "back" from a word restores them.
import { memo, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { Word } from '../../data/types'
import { AudioButton, Button, cx, EmptyState, Hanzi, Icon, PageHeader, Pinyin, useSelector } from '../../components'
import { getWords, type WordIndex } from '../../lib/words'
import { filterCounts, isWordFilter, listSummary, matchesFilter, UNSEEN_INFO, WORD_FILTERS, wordInfoMap, type WordFilter, type WordInfo } from './filters'
import { buildSearchIndex, searchWords } from './search'
import { DirStatusChip, SuspendedChip, UnseenChip } from './StatusChip'
import { useWindowedRange } from './useWindowedRange'

/** Fixed row height in px (rows are absolutely positioned for windowing). */
export const ROW_HEIGHT = 96

export interface WordsPageProps {
  /** Word list (defaults to the app's words.json; tests pass fixtures). */
  words?: WordIndex
}

export default function WordsPage({ words = getWords() }: WordsPageProps) {
  const derived = useSelector((s) => s.derived)
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const fParam = params.get('f')
  const filter: WordFilter = isWordFilter(fParam) ? fParam : 'all'
  const deferredQuery = useDeferredValue(query)

  const infos = useMemo(() => wordInfoMap(derived, words.list), [derived, words])
  const counts = useMemo(() => filterCounts(infos.values()), [infos])
  const summary = useMemo(() => listSummary(infos.values()), [infos])
  const index = useMemo(() => buildSearchIndex(words.list), [words])
  const searched = useMemo(() => searchWords(index, deferredQuery), [index, deferredQuery])
  const results = useMemo(
    () => (filter === 'all' ? searched : searched.filter((w) => matchesFilter(infos.get(w.id) ?? UNSEEN_INFO, filter))),
    [searched, filter, infos],
  )

  const update = (patch: { q?: string; f?: WordFilter }) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (patch.q !== undefined) {
          if (patch.q) next.set('q', patch.q)
          else next.delete('q')
        }
        if (patch.f !== undefined) {
          if (patch.f === 'all') next.delete('f')
          else next.set('f', patch.f)
        }
        return next
      },
      { replace: true, preventScrollReset: true },
    )
  }

  // When the result set changes, bring the top of the list back into view (if scrolled past it).
  const listRef = useRef<HTMLUListElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  // Compare with the previous values (not a "first run" flag, which StrictMode's double effects
  // would defeat), so a remount from "back" keeps the restored scroll position.
  const prevKey = useRef(`${deferredQuery}\u0000${filter}`)
  useEffect(() => {
    const key = `${deferredQuery}\u0000${filter}`
    if (prevKey.current === key) return
    prevKey.current = key
    const list = listRef.current
    if (!list) return
    const stickyH = controlsRef.current?.getBoundingClientRect().height ?? 0
    const top = list.getBoundingClientRect().top
    if (top < stickyH) window.scrollTo({ top: window.scrollY + top - stickyH - 8 })
  }, [deferredQuery, filter])

  const known = summary.young + summary.mature

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Words"
        subtitle={
          <>
            <span className="font-medium text-ink tabular-nums">{summary.introduced.toLocaleString('en')}</span> of{' '}
            <span className="tabular-nums">{summary.total.toLocaleString('en')}</span> introduced
          </>
        }
        className="mb-3"
      />
      <SummaryBar total={summary.total} learning={summary.learning} known={known} mature={summary.mature} />
      <p className="mt-2 mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          <span className="tabular-nums text-ink">{summary.learning}</span> learning
        </span>
        <span>
          <span className="tabular-nums text-ink">{known}</span> known
        </span>
        <span>
          <span className="tabular-nums text-ink">{summary.mature}</span> mature
        </span>
      </p>

      <div
        ref={controlsRef}
        className="sticky top-0 z-10 -mx-5 flex flex-col gap-3 border-b border-line bg-paper px-5 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 backdrop-blur-md sm:top-16 sm:pt-3"
      >
        <SearchBox value={query} onChange={(q) => update({ q })} />
        <FilterChips value={filter} counts={counts} onChange={(f) => update({ f })} />
      </div>

      <p role="status" aria-live="polite" className="mt-3 mb-1 px-1 text-sm text-muted">
        {resultLabel(results.length, summary.total, deferredQuery, filter)}
      </p>

      {results.length === 0 ? (
        <EmptyState
          icon="search"
          title="No matching words"
          action={
            <>
              {query ? (
                <Button size="sm" variant="secondary" onClick={() => update({ q: '' })}>
                  Clear search
                </Button>
              ) : null}
              {filter !== 'all' ? (
                <Button size="sm" variant="ghost" onClick={() => update({ f: 'all' })}>
                  Show all words
                </Button>
              ) : null}
            </>
          }
        >
          Try English (“eat”), pinyin with or without tones (“chi”, “chi1”, “chī”) or characters.
        </EmptyState>
      ) : (
        <WordList listRef={listRef} words={results} infos={infos} />
      )}
    </div>
  )
}

function resultLabel(n: number, total: number, query: string, filter: WordFilter): string {
  if (!query.trim() && filter === 'all') return `${total.toLocaleString('en')} words, most common first`
  const what = n === 1 ? 'word' : 'words'
  return `${n.toLocaleString('en')} ${what}`
}

// ---------- header progress bar ----------

function SummaryBar({ total, learning, known, mature }: { total: number; learning: number; known: number; mature: number }) {
  const w = (n: number) => `${total ? (n / total) * 100 : 0}%`
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
      <span className="h-full bg-success" style={{ width: w(mature) }} />
      <span className="h-full bg-success/55" style={{ width: w(known - mature) }} />
      <span className="h-full bg-accent/75" style={{ width: w(learning) }} />
    </div>
  )
}

// ---------- search ----------

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  // Local state keeps typing responsive (the URL update is replace-only and cheap, but this keeps
  // the caret stable even if the router re-renders asynchronously).
  const [draft, setDraft] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if (value !== draft) setDraft(value)
  }
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Search words
      </label>
      <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          onChange(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && draft) {
            e.preventDefault()
            setDraft('')
            onChange('')
          } else if (e.key === 'Enter') {
            // Hide the on-screen keyboard on phones.
            inputRef.current?.blur()
          }
        }}
        placeholder="Search English, pinyin or 字"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        className="h-12 w-full appearance-none rounded-xl border border-line-strong bg-card pr-11 pl-10 text-base text-ink placeholder:text-faint focus-visible:border-accent [&::-webkit-search-cancel-button]:hidden"
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => {
            setDraft('')
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute top-1/2 right-1 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  )
}

// ---------- filters ----------

function FilterChips({ value, counts, onChange }: { value: WordFilter; counts: Record<WordFilter, number>; onChange: (f: WordFilter) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = WORD_FILTERS.findIndex((o) => o.value === value)
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % WORD_FILTERS.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + WORD_FILTERS.length) % WORD_FILTERS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = WORD_FILTERS.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(WORD_FILTERS[next].value)
    const btn = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]
    btn?.focus()
    btn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
  return (
    <div
      role="radiogroup"
      aria-label="Filter words"
      onKeyDown={onKeyDown}
      className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      {WORD_FILTERS.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors duration-150',
              active ? 'border-accent/35 bg-accent-soft text-accent' : 'border-line bg-card text-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {o.label}
            <span className={cx('tabular-nums text-xs', active ? 'text-accent' : 'text-faint')}>{counts[o.value].toLocaleString('en')}</span>
          </button>
        )
      })}
    </div>
  )
}

// ---------- list ----------

function WordList({ listRef, words, infos }: { listRef: RefObject<HTMLUListElement | null>; words: readonly Word[]; infos: Map<string, WordInfo> }) {
  const { start, end } = useWindowedRange(listRef, words.length, ROW_HEIGHT)
  const rows: ReactNode[] = []
  for (let i = start; i < Math.min(end, words.length); i++) {
    const w = words[i]
    rows.push(<WordRow key={w.id} word={w} info={infos.get(w.id) ?? UNSEEN_INFO} index={i} total={words.length} />)
  }
  return (
    <ul ref={listRef} aria-label="Words" className="relative" style={{ height: words.length * ROW_HEIGHT }}>
      {rows}
    </ul>
  )
}

const WordRow = memo(function WordRow({ word, info, index, total }: { word: Word; info: WordInfo; index: number; total: number }) {
  return (
    <li
      aria-setsize={total}
      aria-posinset={index + 1}
      className="absolute inset-x-0 border-b border-line"
      style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
    >
      <Link
        to={`/words/${encodeURIComponent(word.id)}`}
        state={{ fromList: true }}
        className="-mx-2 flex h-full scroll-mt-40 scroll-mb-24 items-center gap-3 rounded-xl px-2 pr-14 transition-colors duration-150 hover:bg-sunken/70 focus-visible:-outline-offset-2"
      >
        <span className="w-7 shrink-0 self-start pt-[0.95rem] text-right text-xs tabular-nums text-faint" aria-hidden>
          {word.rank}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-baseline gap-2.5">
            <Pinyin word={word} size="lg" className="truncate" />
            <Hanzi word={word} size="sm" force showSimp className="shrink-0 whitespace-nowrap" />
            {info.openFlags > 0 ? (
              <span className="shrink-0 self-center text-danger" title="Flagged">
                <Icon name="flag" size={16} />
                <span className="sr-only">{`, flagged (${info.openFlags})`}</span>
              </span>
            ) : null}
          </span>
          <span className="truncate text-sm text-ink/85">
            {word.gloss}
            {word.hint ? <span className="text-muted"> ({word.hint})</span> : null}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            {info.suspended ? (
              <SuspendedChip />
            ) : !info.introduced ? (
              <UnseenChip />
            ) : (
              <>
                <DirStatusChip dir="listen" status={info.listen} />
                <DirStatusChip dir="say" status={info.say} />
              </>
            )}
          </span>
        </span>
        <span className="sr-only">{`, rank ${word.rank}`}</span>
      </Link>
      <span className="absolute top-1/2 right-0 -translate-y-1/2">
        <AudioButton wordId={word.id} size="md" label={`Play ${word.pinyin}`} />
      </span>
    </li>
  )
})
