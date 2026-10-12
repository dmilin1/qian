// The content of a study card: front (question) and the revealed answer, for both directions.
import { useEffect, useRef, type ReactNode } from 'react'
import type { Word } from '../../data/types'
import type { PlayResult } from '../../lib/audio'
import type { StudyCard } from '../../lib/store'
import { AddUserNoteButton, AudioButton, Hanzi, Icon, Kbd, NoteText, Pinyin, UserNoteView, cx, useSettings } from '../../components'

/** blocked = the browser refused autoplay (needs a tap); failed = neither a clip nor TTS could play. */
export type AudioIssue = 'blocked' | 'failed' | null

interface FaceProps {
  card: StudyCard
  revealed: boolean
  /** Why the last play of this card's audio did not work, if it did not. */
  audioIssue: AudioIssue
  onPlayResult: (r: PlayResult) => void
  /** The learner's own note on this word, if any. */
  userNote?: string
  /** Opens the note editor. */
  onEditNote: () => void
}

/** Word replay + slow replay. */
function ReplayRow({ word, size, primary, onPlayResult }: { word: Word; size: 'lg' | 'hero'; primary?: boolean; onPlayResult: (r: PlayResult) => void }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <span className="relative inline-flex">
        <AudioButton wordId={word.id} size={size} emphasis={primary ? 'primary' : 'quiet'} label="Replay word" onResult={onPlayResult} />
        <Kbd className="absolute -right-1 -bottom-1 bg-card text-muted">R</Kbd>
      </span>
      <span className="relative inline-flex">
        <AudioButton wordId={word.id} slow size="md" label="Replay slowly" onResult={onPlayResult}>
          Slow
        </AudioButton>
        <Kbd className="absolute -right-1 -bottom-1 bg-card text-muted">S</Kbd>
      </span>
    </div>
  )
}

function AudioHint({ issue }: { issue: AudioIssue }) {
  if (!issue) return null
  if (issue === 'blocked') {
    return (
      <p role="status" className="text-sm text-muted">
        Your browser paused autoplay. Tap play to hear it.
      </p>
    )
  }
  return (
    <p role="status" className="text-sm text-muted">
      Couldn’t play audio.{' '}
      <a href="#/settings" className="font-medium text-ink underline underline-offset-2">
        Check Settings → Audio
      </a>
      .
    </p>
  )
}

function Gloss({ word, size }: { word: Word; size: 'lg' | 'xl' }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <p className={cx('font-semibold tracking-tight text-ink text-balance', size === 'xl' ? 'text-3xl' : 'text-2xl')}>{word.gloss}</p>
      {word.hint ? <p className="text-lg text-muted">({word.hint})</p> : null}
    </div>
  )
}

function PosChip({ pos }: { pos: string }) {
  if (!pos) return null
  return <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium tracking-wide text-muted uppercase">{pos}</span>
}

function SpokenAs({ word }: { word: Word }) {
  if (!word.spokenAs) return null
  return (
    <p className="flex items-baseline justify-center gap-2 text-sm text-muted">
      <span>spoken:</span>
      <Pinyin text={word.spokenAs} size="md" />
    </p>
  )
}

function Note({ word }: { word: Word }) {
  if (!word.note) return null
  return (
    <p className="flex gap-2 rounded-xl bg-sunken px-4 py-3 text-left text-sm text-ink">
      <Icon name="info" size={16} className="mt-0.5 shrink-0 text-muted" />
      <span>
        <NoteText note={word.note} />
      </span>
    </p>
  )
}

function Example({ word }: { word: Word }) {
  const ex = word.example
  if (!ex?.pinyin) return null
  return (
    <figure data-answer-example className="flex items-start gap-3 rounded-xl border border-line px-3.5 py-3 text-left">
      <span className="relative mt-0.5 inline-flex">
        <AudioButton wordId={word.id} kind="example" size="sm" label="Play example sentence" />
        <Kbd className="absolute -right-1.5 -bottom-1.5 bg-card text-muted">E</Kbd>
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <Pinyin text={ex.pinyin} size="md" as="p" />
        <Hanzi text={ex.trad} size="sm" />
        <figcaption className="text-sm text-muted">{ex.english}</figcaption>
      </div>
    </figure>
  )
}

/**
 * Plays the example sentence before reveal, as a hint: the word heard in context, where it can sound a little
 * different than on its own. Audio only, so it gives nothing away on a Listen card.
 */
function SentenceHint({ word }: { word: Word }) {
  if (!word.example?.pinyin) return null
  return (
    <span className="relative inline-flex">
      <AudioButton wordId={word.id} kind="example" size="md" label="Hear it in a sentence">
        In a sentence
      </AudioButton>
      <Kbd className="absolute -right-1 -bottom-1 bg-card text-muted">E</Kbd>
    </span>
  )
}

/** The learner's own note, or (when `addable`) a button to add one. */
function YourNote({ note, addable, onEdit }: { note?: string; addable?: boolean; onEdit: () => void }) {
  if (note) return <UserNoteView note={note} onEdit={onEdit} />
  if (!addable) return null
  return (
    <span className="relative inline-flex">
      <AddUserNoteButton onClick={onEdit} />
      <Kbd className="absolute -right-1 -bottom-1 bg-card text-muted">N</Kbd>
    </span>
  )
}

/** Pinyin (hero, tone colored) and characters (small, muted). */
function WordForm({ word }: { word: Word }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Pinyin word={word} size="hero" as="p" />
      <Hanzi word={word} size="lg" />
    </div>
  )
}

function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-col items-center gap-4 text-center', className)}>{children}</div>
}

/**
 * Front of the card. Top-anchored (not centred), so nothing on it moves when its content changes on
 * reveal. The min height only applies before reveal; after it, the answer moves up to save room.
 */
function Front({ revealed, children, className }: { revealed: boolean; children: ReactNode; className?: string }) {
  return <Section className={cx('justify-start pt-2', !revealed && 'min-h-48', className)}>{children}</Section>
}

/**
 * First block of the answer (meaning on Listen, word and replay on Say). Its scroll margins match the sticky
 * action bar's height (tab bar + bar on phones, taller when the prompt row shows at 700px+); the reveal scroll in
 * Answer reads them, so the answer is never left behind the grade buttons.
 */
function AnswerLead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-answer-lead
      className={cx(
        'flex flex-col items-center gap-4 text-center',
        'scroll-mt-4 scroll-mb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+7.5rem)] [@media(min-height:700px)]:scroll-mb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+11rem)] sm:scroll-mt-20 sm:scroll-mb-40!',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * On reveal, scroll just enough to show the answer's first block and, when it fits, the example sentence below it
 * (its audio is the most useful thing after the meaning), without pushing the first block's top out of view.
 */
function revealScroll(section: HTMLElement | null) {
  const lead = section?.querySelector<HTMLElement>('[data-answer-lead]')
  if (!lead || typeof window.scrollBy !== 'function') return
  const example = section!.querySelector<HTMLElement>('[data-answer-example]')
  const style = getComputedStyle(lead)
  const marginTop = parseFloat(style.scrollMarginTop) || 0
  const visibleBottom = window.innerHeight - (parseFloat(style.scrollMarginBottom) || 0)
  const top = lead.getBoundingClientRect().top
  const bottom = (example ?? lead).getBoundingClientRect().bottom
  let delta = 0
  if (top < marginTop) delta = top - marginTop
  else if (bottom > visibleBottom) delta = Math.min(bottom - visibleBottom, top - marginTop)
  if (Math.abs(delta) < 1) return
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollBy({ top: delta, behavior: reduce ? 'auto' : 'smooth' })
}

/** Divider + answer block, faded in. */
function Answer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => revealScroll(ref.current), [])
  return (
    <section ref={ref} aria-label="Answer" className="flex flex-col gap-4 motion-safe:animate-rise-in">
      <hr className="mx-auto my-1 w-16 border-line-strong" />
      {children}
    </section>
  )
}

export function ListenFace({ card, revealed, audioIssue, onPlayResult, userNote, onEditNote }: FaceProps) {
  const { listenFront } = useSettings()
  const audioOnly = listenFront === 'audioOnly'
  const w = card.word
  return (
    <>
      <Front revealed={revealed}>
        {audioOnly ? (
          <>
            <ReplayRow word={w} size="hero" primary onPlayResult={onPlayResult} />
            {/* If audio cannot play at all, fall back to showing the word so the card still works. */}
            {revealed || audioIssue === 'failed' ? <WordForm word={w} /> : <p className="text-lg text-muted">What does this mean?</p>}
          </>
        ) : (
          <>
            <WordForm word={w} />
            <ReplayRow word={w} size="lg" onPlayResult={onPlayResult} />
          </>
        )}
        {revealed ? null : <SentenceHint word={w} />}
        <AudioHint issue={audioIssue} />
      </Front>
      {revealed ? (
        <Answer>
          <AnswerLead className="gap-3">
            <Gloss word={w} size="lg" />
            <PosChip pos={w.pos} />
            <SpokenAs word={w} />
            <YourNote note={userNote} addable onEdit={onEditNote} />
          </AnswerLead>
          {/* Example first: its audio is what a learner by ear wants next; the note is reference text. */}
          <Example word={w} />
          <Note word={w} />
        </Answer>
      ) : null}
    </>
  )
}

export function SayFace({ card, revealed, audioIssue, onPlayResult, userNote, onEditNote }: FaceProps) {
  const w = card.word
  return (
    <>
      <Front revealed={revealed} className="gap-3">
        <Gloss word={w} size="xl" />
        <PosChip pos={w.pos} />
        <YourNote note={userNote} onEdit={onEditNote} />
        {revealed ? null : (
          <p className="mt-2 flex items-center gap-2 text-muted">
            <Icon name="volume" size={18} />
            Say it out loud
          </p>
        )}
      </Front>
      {revealed ? (
        <Answer>
          <AnswerLead>
            <WordForm word={w} />
            <ReplayRow word={w} size="lg" onPlayResult={onPlayResult} />
            <AudioHint issue={audioIssue} />
            <SpokenAs word={w} />
          </AnswerLead>
          {/* Example first: its audio is what a learner by ear wants next; the note is reference text. */}
          <Example word={w} />
          <Note word={w} />
          {userNote ? null : (
            <div className="flex justify-center">
              <YourNote addable onEdit={onEditNote} />
            </div>
          )}
        </Answer>
      ) : null}
    </>
  )
}
