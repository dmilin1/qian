// Bottom action area: "Show answer" (+ "I already know this") on the front, Again/Good/Easy on
// the back. On phones the big buttons sit at the same y in both states, whether the bar is resting
// at the end of the page or stuck above the tab bar.
import { useEffect, useState } from 'react'
import type { GradeName } from '../../lib/events'
import type { StudyCard } from '../../lib/store'
import { Button, Kbd, cx } from '../../components'

const GRADES: { grade: GradeName; label: string; key: string; className: string }[] = [
  { grade: 'again', label: 'Again', key: '1', className: 'border border-line-strong bg-card text-danger hover:bg-danger-soft' },
  { grade: 'good', label: 'Good', key: '2', className: 'bg-accent-solid text-accent-ink shadow-card hover:bg-accent-solid-hover' },
  { grade: 'easy', label: 'Easy', key: '3', className: 'border border-line-strong bg-card text-success hover:bg-success-soft' },
]

/**
 * Grade buttons ignore taps for this long after reveal. "Show answer" and Good share the same
 * spot, so a double tap would otherwise grade the card before the answer was seen. Keys 1/2/3 go
 * through StudyPage and are not affected.
 */
export const GRADE_TAP_GUARD_MS = 350

interface Props {
  card: StudyCard
  revealed: boolean
  onReveal: () => void
  onGrade: (g: GradeName) => void
  onKnown: () => void
}

export function ActionBar({ card, revealed, onReveal, onGrade, onKnown }: Props) {
  // Armed = the guard has elapsed for this card's reveal. Derived, so the grade buttons are
  // disarmed from their very first paint.
  // Keyed on key + shownAt (stable across unrelated snapshot updates, like StudyPage's card id).
  const cardKey = `${card.key}|${card.shownAt}`
  const [armedKey, setArmedKey] = useState<string | null>(null)
  const armed = revealed && armedKey === cardKey
  useEffect(() => {
    if (!revealed) return
    const t = setTimeout(() => setArmedKey(cardKey), GRADE_TAP_GUARD_MS)
    return () => {
      clearTimeout(t)
      setArmedKey(null)
    }
  }, [revealed, cardKey])

  return (
    <div
      className={cx(
        // Sticky above the phone tab bar so the buttons stay under the thumb on long answers.
        // -mb-8 + pb-9 pulls the resting bar into <main>'s 2rem bottom padding, so its resting and
        // stuck positions are the same and revealing a long answer does not move the buttons.
        'sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-10 -mx-5 mt-auto -mb-8 touch-manipulation bg-paper/95 px-5 pt-3 pb-9 backdrop-blur-sm',
        'sm:bottom-0 sm:mt-5 sm:mb-0 sm:pb-[max(1rem,env(safe-area-inset-bottom))]',
      )}
    >
      {/* Secondary row, hidden on short screens (under 700px) so it does not cover the answer. */}
      {revealed ? (
        <p className="mb-2 hidden min-h-11 items-center justify-center text-sm text-muted [@media(min-height:700px)]:flex">How well did you know it?</p>
      ) : card.canMarkKnown ? (
        <div className="mb-2 flex min-h-11 items-center justify-center">
          <Button variant="ghost" size="md" icon="check" onClick={onKnown} trailing={<Kbd>K</Kbd>} className="text-muted hover:text-ink">
            I already know this
          </Button>
        </div>
      ) : (
        // On desktop the bar follows the card, so keep the row's height to avoid a jump on reveal.
        <div aria-hidden className="mb-2 hidden min-h-11 sm:[@media(min-height:700px)]:block" />
      )}
      {revealed ? (
        <div role="group" aria-label="Grade" className="grid grid-cols-3 gap-2.5" style={armed ? undefined : { pointerEvents: 'none' }}>
          {GRADES.map((g) => {
            const preview = card.previews[g.grade]?.label
            return (
              <button
                key={g.grade}
                type="button"
                onClick={() => {
                  if (armed) onGrade(g.grade)
                }}
                aria-label={preview ? `${g.label}, next in ${preview}` : g.label}
                className={cx(
                  'relative flex h-16 cursor-pointer select-none flex-col items-center justify-center rounded-2xl font-medium',
                  'transition-[background-color,transform] duration-150 active:scale-[0.97]',
                  g.className,
                )}
              >
                <span className="text-base leading-tight">{g.label}</span>
                {preview ? <span className="text-xs leading-tight tabular-nums opacity-80">{preview}</span> : null}
                <Kbd className="absolute top-1.5 right-2">{g.key}</Kbd>
              </button>
            )
          })}
        </div>
      ) : (
        <Button variant="secondary" size="xl" block onClick={onReveal} className="h-16 rounded-2xl text-lg" trailing={<Kbd>Space</Kbd>}>
          Show answer
        </Button>
      )}
    </div>
  )
}
