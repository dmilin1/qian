// The learner's own note on a word (a mnemonic or their own meaning): its display and the edit dialog.
// Shared by the study card and the word detail page.
import { useId, useState } from 'react'
import { USER_NOTE_MAX } from '../lib/events'
import { Button } from './Button'
import { cx } from './cx'
import { Icon } from './Icon'
import { Modal } from './Modal'

/** The note, labelled as the learner's own, with a small edit button. */
export function UserNoteView({ note, onEdit, className }: { note: string; onEdit?: () => void; className?: string }) {
  return (
    <div className={cx('flex w-full items-start gap-2 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-left', className)}>
      <Icon name="pencil" size={16} className="mt-1 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-ink">
        <span className="sr-only">Your note: </span>
        <span className="whitespace-pre-wrap">{note}</span>
      </p>
      {onEdit ? (
        <Button variant="ghost" size="sm" iconOnly icon="pencil" aria-label="Edit your note" onClick={onEdit} className="-my-1 -mr-2 text-muted hover:text-ink" />
      ) : null}
    </div>
  )
}

/** A quiet "Add your note" button, for words without one. */
export function AddUserNoteButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button variant="ghost" size="sm" icon="pencil" onClick={onClick} className={cx('text-muted hover:text-ink', className)}>
      Add your note
    </Button>
  )
}

export interface UserNoteDialogProps {
  open: boolean
  /** Names the word in the title, e.g. its pinyin and gloss. */
  wordLabel: string
  note: string
  onClose: () => void
  /** Called with the trimmed text; empty text removes the note. */
  onSave: (text: string) => void
}

export function UserNoteDialog({ open, wordLabel, note, onClose, onSave }: UserNoteDialogProps) {
  const formId = useId()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={note ? `Edit your note: ${wordLabel}` : `Add your note: ${wordLabel}`}
      description="Your own meaning or a way to remember it. It shows next to the English on this word’s cards."
      footer={
        <>
          {note ? (
            <Button variant="danger" onClick={() => onSave('')} className="sm:mr-auto">
              Remove
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" icon="check">
            Save
          </Button>
        </>
      }
    >
      {/* Modal renders children only while open, so the form starts from the saved note each time. */}
      <NoteForm id={formId} initial={note} onSave={onSave} />
    </Modal>
  )
}

function NoteForm({ id, initial, onSave }: { id: string; initial: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(initial)
  const fieldId = useId()
  return (
    <form
      id={id}
      onSubmit={(e) => {
        e.preventDefault()
        onSave(text.trim())
      }}
    >
      <label htmlFor={fieldId} className="sr-only">
        Your note
      </label>
      <textarea
        id={fieldId}
        value={text}
        maxLength={USER_NOTE_MAX}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter saves; plain Enter adds a line.
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            onSave(text.trim())
          }
        }}
        rows={3}
        autoFocus
        placeholder="e.g. possessive negative action"
        className="w-full resize-y rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-base text-ink placeholder:text-faint focus-visible:border-accent"
      />
    </form>
  )
}
