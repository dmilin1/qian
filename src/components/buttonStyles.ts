import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 cursor-pointer'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-solid text-accent-ink shadow-sm hover:bg-accent-solid-hover',
  secondary: 'border border-line-strong bg-card text-ink hover:bg-sunken',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'border border-danger/40 text-danger hover:bg-danger-soft',
}

// Heights: sm 36px, md 44px (minimum touch target), lg 52px, xl 60px.
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-base',
  lg: 'h-13 px-5 text-lg',
  xl: 'h-15 px-6 text-lg',
}
const ICON_ONLY: Record<ButtonSize, string> = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-13 w-13',
  xl: 'h-15 w-15',
}
export const ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 20, lg: 22, xl: 24 }

export interface ButtonStyleOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  iconOnly?: boolean
  className?: string
}

/** Button classes, e.g. to style a router <Link> like a button. */
export function buttonClasses({ variant = 'secondary', size = 'md', block, iconOnly, className }: ButtonStyleOptions = {}) {
  return cx(BASE, VARIANTS[variant], iconOnly ? cx(ICON_ONLY[size], 'p-0') : SIZES[size], block && 'w-full', className)
}
