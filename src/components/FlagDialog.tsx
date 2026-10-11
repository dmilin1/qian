// "Flag this word" dialog: a reason and an optional note. Shared by the study card menu and the
// word detail page so both offer the same reasons, labels and limits.
import { useId, useState } from 'react'
import { FLAG_REASONS, type FlagReason } from '../lib/events'
import { Button } from './Button'
import { cx } from './cx'
import { FLAG_NOTE_MAX, FLAG_REASON_LABEL } from './flagReasons'
import { Modal } from './Modal'

export interface FlagDialogProps {
  open: boolean
  /** Names the word in the title, e.g. its pinyin and gloss. */
  wordLabel: string
  onClose: () => void
  onSubmit: (reason: FlagReason, note: string) => void
}

/** Flag a word: pick a reason and add an optional note. */
export function FlagDialog({ open, wordLabel, onClose, onSubmit }: FlagDialogProps) {
  const formId = useId()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Flag ${wordLabel}`}
      description="Report a problem so it can be fixed later. Open flags are listed in Words, and you can export them."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" icon="flag">
            Flag word
          </Button>
        </>
      }
    >
      {/* Modal renders children only while open, so the form starts empty each time. */}
      <FlagForm id={formId} onSubmit={onSubmit} />
    </Modal>
  )
}

function FlagForm({ id, onSubmit }: { id: string; onSubmit: FlagDialogProps['onSubmit'] }) {
  const [reason, setReason] = useState<FlagReason>('audio')
  const [note, setNote] = useState('')
  const name = useId()
  const noteId = useId()
  return (
    <form
      id={id}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(reason, note.trim())
      }}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-ink">What’s wrong?</legend>
        {FLAG_REASONS.map((r) => (
          <label
            key={r}
            className={cx(
              'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2 transition-colors duration-150',
              reason === r ? 'border-accent/40 bg-accent-soft text-ink' : 'border-line bg-card text-ink hover:bg-sunken',
            )}
          >
            <input
              type="radio"
              name={name}
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
              className="h-4 w-4 accent-(--accent-solid)"
            />
            {FLAG_REASON_LABEL[r]}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className="font-medium text-ink">
          Note <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id={noteId}
          value={note}
          maxLength={FLAG_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. sounds like 4th tone, should be 2nd"
          className="w-full resize-y rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-base text-ink placeholder:text-faint focus-visible:border-accent"
        />
      </div>
    </form>
  )
}
