// The content of a study card: front (question) and the revealed answer, for both directions.
import { useEffect, useRef, type ReactNode } from 'react'
import type { Word } from '../../data/types'
import type { PlayResult } from '../../lib/audio'
import type { StudyCard } from '../../lib/store'
import { AudioButton, Hanzi, Icon, Kbd, Pinyin, cx, useSettings } from '../../components'

/** blocked = the browser refused autoplay (needs a tap); failed = neither a clip nor TTS could play. */
export type AudioIssue = 'blocked' | 'failed' | null

interface FaceProps {
  card: StudyCard
  revealed: boolean
  /** Why the last play of this card's audio did not work, if it did not. */
  audioIssue: AudioIssue
  onPlayResult: (r: PlayResult) => void
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
      <Icon name="info" size={16} className="mt-0.5 text-muted" />
      <span>{word.note}</span>
    </p>
  )
}

function Example({ word }: { word: Word }) {
  const ex = word.example
  if (!ex?.pinyin) return null
  return (
    <figure className="flex items-start gap-3 rounded-xl border border-line px-3.5 py-3 text-left">
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
 * First block of the answer. On mount (reveal) it scrolls itself into view above the sticky action
 * bar, so on short screens the meaning is not hidden behind the grade buttons. The scroll margins
 * match the bar's height: tab bar + bar on phones (taller when the prompt row shows at 700px+).
 */
function AnswerLead({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof el.scrollIntoView !== 'function') return
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [])
  return (
    <div
      ref={ref}
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

/** Divider + answer block, faded in. */
function Answer({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Answer" className="flex flex-col gap-4 motion-safe:animate-rise-in">
      <hr className="mx-auto my-1 w-16 border-line-strong" />
      {children}
    </section>
  )
}

export function ListenFace({ card, revealed, audioIssue, onPlayResult }: FaceProps) {
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
        <AudioHint issue={audioIssue} />
      </Front>
      {revealed ? (
        <Answer>
          <AnswerLead className="gap-3">
            <Gloss word={w} size="lg" />
            <PosChip pos={w.pos} />
            <SpokenAs word={w} />
          </AnswerLead>
          <Note word={w} />
          <Example word={w} />
        </Answer>
      ) : null}
    </>
  )
}

export function SayFace({ card, revealed, audioIssue, onPlayResult }: FaceProps) {
  const w = card.word
  return (
    <>
      <Front revealed={revealed} className="gap-3">
        <Gloss word={w} size="xl" />
        <PosChip pos={w.pos} />
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
          <Note word={w} />
          <Example word={w} />
        </Answer>
      ) : null}
    </>
  )
}
