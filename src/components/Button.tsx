import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { buttonClasses, ICON_SIZE, type ButtonStyleOptions } from './buttonStyles'
import { Icon, type IconName } from './Icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleOptions {
  /** Leading icon. */
  icon?: IconName
  /** Trailing icon. */
  iconRight?: IconName
  /** Optional trailing element, e.g. a <Kbd> hint. */
  trailing?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

/**
 * Button. For icon-only buttons pass `iconOnly` and an `aria-label`.
 * `type` defaults to "button" (not submit).
 */
export function Button({
  variant,
  size = 'md',
  block,
  iconOnly,
  className,
  icon,
  iconRight,
  trailing,
  children,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  const iconPx = ICON_SIZE[size]
  return (
    <button ref={ref} type={type} className={buttonClasses({ variant, size, block, iconOnly, className })} {...rest}>
      {icon ? <Icon name={icon} size={iconPx} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={iconPx} /> : null}
      {trailing}
    </button>
  )
}

export type { ButtonSize, ButtonVariant } from './buttonStyles'
