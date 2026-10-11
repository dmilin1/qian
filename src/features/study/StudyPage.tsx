// Study screen: an endless flashcard session driven by store.current (see docs/app-notes.md).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayResult } from '../../lib/audio'
import type { FlagReason, GradeName } from '../../lib/events'
import type { StudyCard } from '../../lib/store'
import { getWords } from '../../lib/words'
import {
  Button,
  Card,
  Icon,
  Kbd,
  SealMark,
  Spinner,
  playClip,
  stopPlayback,
  useAudioPlayer,
  useIsAudioUnlocked,
  useSnapshot,
  useStore,
} from '../../components'
import { ActionBar } from './ActionBar'
import { CardMenu } from './CardMenu'
import { CaughtUp } from './CaughtUp'
import { ListenFace, SayFace } from './CardFaces'
import { predictNextWordIds } from './predictNext'
import { ProgressLine, ProgressTiles } from './Progress'
import { progressNumbers } from './progressNumbers'
import { studySession } from './session'
import { useStudyHotkeys } from './useStudyHotkeys'

const SOURCE_LABEL: Partial<Record<StudyCard['source'], string>> = {
  practice: 'Practice ahead',
  learningEarly: 'A little early',
}

export default function StudyPage() {
  const snap = useSnapshot()
  const store = useStore()
  const player = useAudioPlayer()
  const unlocked = useIsAudioUnlocked()
  const words = useMemo(() => getWords(), [])

  const [started, setStarted] = useState(() => studySession.started || unlocked)
  const [epoch, setEpoch] = useState(0)
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const [blockedId, setBlockedId] = useState<string | null>(null)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const shownAtRef = useRef(0)

  const current = snap.current
  // A card's identity: a new card (or the same card shown again after a grade/undo) gets a new id,
  // while unrelated snapshot changes (settings, flags) keep it, so the reveal state survives them.
  const cardId = current ? `${epoch}|${current.key}|${current.shownAt}` : null
  const revealed = cardId !== null && revealedId === cardId
  const blocked = cardId !== null && blockedId === cardId

  const progress = progressNumbers(snap.queue, snap.settings.workingSetCap, words.list.length)
  // Caught up: would practice-ahead have anything to show? (pure query, cheap)
  const canPractice = current ? true : store.peekNext(true).pick !== null

  const start = useCallback(() => {
    try {
      player.unlock?.()
    } catch {
      // ignore; the player also unlocks itself on the first gesture
    }
    studySession.start()
    setStarted(true)
  }, [player])

  const onPlayResult = useCallback(
    (r: PlayResult) => {
      if (r === 'blocked') setBlockedId(cardId)
      else if (r === 'clip' || r === 'tts') setBlockedId(null)
    },
    [cardId],
  )

  const play = useCallback(
    (kind: 'word' | 'example', slow = false) => {
      if (!current) return
      void playClip(player, current.wordId, kind, { slow }).then(onPlayResult)
    },
    [current, player, onPlayResult],
  )

  // New card on screen: start the clock, autoplay (Listen), preload what's likely next.
  useEffect(() => {
    if (!started || !current) return
    shownAtRef.current = Date.now()
    if (current.dir === 'listen' && store.getSnapshot().settings.autoplay) play('word')
    const t = setTimeout(() => {
      const next = predictNextWordIds(store.getSnapshot(), words)
      player.preload([current.wordId, ...next])
    }, 400)
    return () => clearTimeout(t)
    // Deliberately keyed on the card identity only, not on every snapshot update.
  }, [cardId, started]) // oxlint-disable-line react-hooks/exhaustive-deps

  // Leaving the Study screen stops audio.
  useEffect(() => () => stopPlayback(player), [player])

  // Toast auto-hide.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const reveal = useCallback(() => {
    if (!current || !cardId || revealed) return
    setRevealedId(cardId)
    if (current.dir === 'say' && snap.settings.autoplay) play('word')
  }, [current, cardId, revealed, play, snap.settings.autoplay])

  const nextCard = () => {
    stopPlayback(player)
    setEpoch((e) => e + 1)
    setRevealedId(null)
    setBlockedId(null)
  }

  const grade = (g: GradeName) => {
    if (!current || !revealed) return
    const elapsed = Math.max(0, Date.now() - shownAtRef.current)
    nextCard()
    void store.grade(current.key, g, elapsed)
  }

  const markKnown = () => {
    if (!current?.canMarkKnown || revealed) return
    nextCard()
    void store.markKnown(current.wordId)
    setToast(`Marked “${current.word.gloss}” as known. It will come back to check in about a week.`)
  }

  const undo = () => {
    if (!snap.canUndo) return
    nextCard()
    void store.undo()
  }

  const flag = (reason: FlagReason, note: string) => {
    if (!current) return
    void store.flag(current.wordId, reason, note || undefined)
    setToast('Thanks, card flagged. Find flags in the Words tab.')
  }

  const suspend = () => {
    if (!current) return
    const w = current.word
    nextCard()
    void store.setSuspended(w.id, true)
    setToast(`Suspended “${w.gloss}”. Unsuspend it from the Words tab.`)
  }

  const practice = () => {
    start()
    store.setPracticeAhead(true)
  }

  const canHear = !!current && (current.dir === 'listen' || revealed)
  useStudyHotkeys({
    enabled: !overlayOpen,
    handlers: {
      primary: () => {
        if (!started && current) start()
        else if (!current) {
          if (canPractice) practice()
        } else if (!revealed) reveal()
        else play('word')
      },
      grade: (g) => grade(g),
      replay: () => canHear && play('word'),
      slow: () => canHear && play('word', true),
      example: () => revealed && play('example'),
      known: () => markKnown(),
      undo: () => undo(),
    },
  })

  if (!snap.ready) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const toastEl = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 flex justify-center px-5 sm:top-20">
      {toast ? (
        <p className="pointer-events-auto max-w-content rounded-xl bg-ink px-4 py-2.5 text-sm text-paper shadow-pop motion-safe:animate-rise-in">{toast}</p>
      ) : null}
    </div>
  )

  const undoButton = (
    <Button
      variant="ghost"
      size="md"
      iconOnly
      icon="undo"
      aria-label="Undo last answer"
      title="Undo (Z)"
      disabled={!snap.canUndo}
      onClick={undo}
      className="text-muted hover:text-ink"
    />
  )

  // ----- caught up -----
  if (!current) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex justify-end">{undoButton}</div>
        <CaughtUp queue={snap.queue} progress={progress} canPractice={canPractice} onPractice={practice} />
        {toastEl}
      </div>
    )
  }

  // ----- start screen (first tap unlocks audio on iOS/Chrome autoplay policies) -----
  if (!started) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-6 text-center motion-safe:animate-rise-in">
        <div className="flex flex-col items-center gap-4">
          <SealMark size={56} />
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Ready to listen?</h1>
          <p className="max-w-xs text-muted text-balance">
            Each word plays out loud. Headphones help. Answer honestly, and new words arrive as old ones settle.
          </p>
        </div>
        <ProgressTiles p={progress} />
        <Button variant="primary" size="xl" block icon="study" onClick={start} trailing={<Kbd>Space</Kbd>} className="h-16 rounded-2xl text-xl">
          Start studying
        </Button>
        {toastEl}
      </div>
    )
  }

  // ----- the card -----
  const sourceLabel = SOURCE_LABEL[current.source]
  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center gap-1">
        <ProgressLine p={progress} className="mr-auto" />
        {undoButton}
        <CardMenu word={current.word} onFlag={flag} onSuspend={suspend} onOpenChange={setOverlayOpen} />
      </div>

      <Card
        key={cardId}
        as="article"
        aria-label={current.dir === 'listen' ? 'Listen card' : 'Say card'}
        padding="lg"
        animate="rise"
        className="flex flex-1 flex-col gap-5 sm:min-h-120 sm:flex-none"
      >
        <header className="flex items-center gap-2 text-sm text-muted">
          <Icon name={current.dir === 'listen' ? 'study' : 'volume'} size={16} />
          <span className="font-medium">{current.dir === 'listen' ? 'Listen' : 'Say'}</span>
          {current.isNew ? (
            <span className="ml-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold tracking-wider text-accent uppercase">New</span>
          ) : null}
          {sourceLabel ? <span className="ml-auto text-xs">{sourceLabel}</span> : null}
        </header>
        {current.dir === 'listen' ? (
          <ListenFace card={current} revealed={revealed} blocked={blocked} onPlayResult={onPlayResult} />
        ) : (
          <SayFace card={current} revealed={revealed} blocked={blocked} onPlayResult={onPlayResult} />
        )}
      </Card>

      <ActionBar card={current} revealed={revealed} onReveal={reveal} onGrade={grade} onKnown={markKnown} />
      {toastEl}
    </div>
  )
}
