import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import { cx } from './cx'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Short text under the title (used as aria-describedby). */
  description?: ReactNode
  children?: ReactNode
  /** Action buttons, right-aligned (stacked full-width on phones). */
  footer?: ReactNode
  /** Close when the backdrop is clicked (default true). */
  dismissible?: boolean
  className?: string
}

/**
 * Modal dialog on the native <dialog> element: focus is trapped and restored by the browser,
 * Escape closes it, and the backdrop is styled in index.css.
 */
export function Modal({ open, onClose, title, description, children, footer, dismissible = true, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close()
      else d.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // Escape key: keep React state as the source of truth.
      onCancel={(e) => {
        e.preventDefault()
        if (dismissible) onClose()
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose()
      }}
      className={cx(
        'qian-dialog m-auto w-[min(100%-2rem,28rem)] max-h-[calc(100dvh-2rem)] rounded-2xl border border-line bg-card p-0 text-ink shadow-pop',
        className,
      )}
    >
      {open ? (
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1.5">
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="text-muted">
                {description}
              </p>
            ) : null}
          </div>
          {children}
          {footer ? <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  )
}

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Use the danger style for destructive actions. */
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Yes/no confirmation built on Modal. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}
