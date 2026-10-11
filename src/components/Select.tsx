import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export interface SelectProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly SelectOption<T>[]
  label: ReactNode
  description?: ReactNode
  /** Hide the label visually (still read by screen readers). */
  hideLabel?: boolean
  disabled?: boolean
  className?: string
}

/** Native <select> (best on mobile), styled to match. */
export function Select<T extends string>({ value, onChange, options, label, description, hideLabel, disabled, className }: SelectProps<T>) {
  const id = useId()
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cx('font-medium text-ink', hideLabel && 'sr-only')}>
        {label}
      </label>
      {description ? (
        <span id={`${id}-desc`} className="-mt-1 text-sm text-muted">
          {description}
        </span>
      ) : null}
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          aria-describedby={description ? `${id}-desc` : undefined}
          onChange={(e) => onChange(e.target.value as T)}
          className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-line-strong bg-card pr-10 pl-3.5 text-base text-ink hover:bg-sunken disabled:opacity-50"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={18} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
      </div>
    </div>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: IconName
}

export interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  /** Accessible group label. */
  label: string
  className?: string
}

/** A few mutually exclusive options side by side (radio group with arrow-key navigation). */
export function SegmentedControl<T extends string>({ value, onChange, options, label, className }: SegmentedControlProps<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = options.findIndex((o) => o.value === value)
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(options[next].value)
    const btn = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]
    btn?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cx('flex rounded-xl border border-line bg-sunken p-1', className)}>
      {options.map((o) => {
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
              'flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors duration-150',
              active ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {o.icon ? <Icon name={o.icon} size={16} /> : null}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
