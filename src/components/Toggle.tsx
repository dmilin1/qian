import { useId, type ReactNode } from 'react'
import { cx } from './cx'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Visible label. The whole row is clickable. */
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
  id?: string
}

/** On/off switch (role="switch") as a full-width settings row. */
export function Toggle({ checked, onChange, label, description, disabled, className, id }: ToggleProps) {
  const autoId = useId()
  const btnId = id ?? autoId
  const descId = `${btnId}-desc`
  return (
    <div className={cx('flex items-center justify-between gap-4 py-3', disabled && 'opacity-50', className)}>
      <div className="flex min-w-0 flex-col">
        <label htmlFor={btnId} className="cursor-pointer font-medium text-ink">
          {label}
        </label>
        {description ? (
          <span id={descId} className="text-sm text-muted">
            {description}
          </span>
        ) : null}
      </div>
      <button
        id={btnId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex h-8 w-13 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200',
          checked ? 'border-accent-solid bg-accent-solid' : 'border-line-strong bg-sunken',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'inline-block h-6 w-6 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-[0.1875rem]',
          )}
        />
      </button>
    </div>
  )
}
