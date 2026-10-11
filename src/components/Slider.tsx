import { useId, type CSSProperties, type ReactNode } from 'react'
import { cx } from './cx'

export interface SliderProps {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  label: ReactNode
  description?: ReactNode
  /** Value display, e.g. v => `${Math.round(v * 100)}%`. */
  format?: (value: number) => string
  disabled?: boolean
  className?: string
}

/** Labeled range input with the current value shown. Pair with SETTING_RANGES from src/lib/settings. */
export function Slider({ value, onChange, min, max, step = 1, label, description, format = String, disabled, className }: SliderProps) {
  const id = useId()
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0
  const shown = format(value)
  return (
    <div className={cx('flex flex-col gap-1 py-2', disabled && 'opacity-50', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="font-medium text-ink">
          {label}
        </label>
        <output htmlFor={id} className="font-medium text-ink tabular-nums">
          {shown}
        </output>
      </div>
      {description ? (
        <span id={`${id}-desc`} className="text-sm text-muted">
          {description}
        </span>
      ) : null}
      <input
        id={id}
        type="range"
        className="qian-range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={shown}
        aria-describedby={description ? `${id}-desc` : undefined}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
