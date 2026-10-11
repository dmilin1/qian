// Bottom action area: "Show answer" (+ "I already know this") on the front, Again/Good/Easy on
// the back. Both states have the same height, so revealing never shifts the layout.
import type { GradeName } from '../../lib/events'
import type { StudyCard } from '../../lib/store'
import { Button, Kbd, cx } from '../../components'

const GRADES: { grade: GradeName; label: string; key: string; className: string }[] = [
  { grade: 'again', label: 'Again', key: '1', className: 'border border-line-strong bg-card text-danger hover:bg-danger-soft' },
  { grade: 'good', label: 'Good', key: '2', className: 'bg-accent-solid text-accent-ink shadow-card hover:bg-accent-solid-hover' },
  { grade: 'easy', label: 'Easy', key: '3', className: 'border border-line-strong bg-card text-success hover:bg-success-soft' },
]

interface Props {
  card: StudyCard
  revealed: boolean
  onReveal: () => void
  onGrade: (g: GradeName) => void
  onKnown: () => void
}

export function ActionBar({ card, revealed, onReveal, onGrade, onKnown }: Props) {
  return (
    <div
      className={cx(
        // Sticky above the phone tab bar so the buttons stay under the thumb on long answers.
        'sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-10 -mx-5 mt-auto bg-paper/95 px-5 pt-3 pb-1 backdrop-blur-sm',
        'sm:bottom-0 sm:mt-5 sm:pb-4',
      )}
    >
      {/* Secondary row. On phones the big buttons stay anchored at the bottom whatever this holds. */}
      {revealed ? (
        <p className="mb-2 hidden min-h-11 items-center justify-center text-sm text-muted sm:flex [@media(min-height:700px)]:flex">How well did you know it?</p>
      ) : card.canMarkKnown ? (
        <div className="mb-2 flex min-h-11 items-center justify-center">
          <Button variant="ghost" size="md" icon="check" onClick={onKnown} trailing={<Kbd>K</Kbd>} className="text-muted hover:text-ink">
            I already know this
          </Button>
        </div>
      ) : (
        // On desktop the bar follows the card, so keep the row's height to avoid a jump on reveal.
        <div aria-hidden className="mb-2 hidden min-h-11 sm:block" />
      )}
      {revealed ? (
        <div role="group" aria-label="Grade" className="grid grid-cols-3 gap-2.5">
          {GRADES.map((g) => {
            const preview = card.previews[g.grade]?.label
            return (
              <button
                key={g.grade}
                type="button"
                onClick={() => onGrade(g.grade)}
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
