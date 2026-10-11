import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Element to render (default div; e.g. "section", "article", "li"). */
  as?: ElementType
  /** Inner padding (default md). */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** Raised (default) or flat (border only, for nested/list use). */
  tone?: 'raised' | 'flat' | 'sunken'
  /**
   * Entrance animation, replayed whenever the element remounts (give it a new `key` per
   * card/side). Disabled under prefers-reduced-motion.
   */
  animate?: 'none' | 'fade' | 'rise' | 'flip'
  children?: ReactNode
}

const PADDING = { none: '', sm: 'p-3', md: 'p-5', lg: 'p-6 sm:p-8' }
const TONE = {
  raised: 'bg-card border border-line shadow-card',
  flat: 'bg-card border border-line',
  sunken: 'bg-sunken',
}
const ANIMATE = {
  none: '',
  fade: 'motion-safe:animate-fade-in',
  rise: 'motion-safe:animate-rise-in',
  flip: 'motion-safe:animate-flip-in',
}

/** Surface container: rounded paper card. */
export function Card({ as: As = 'div', padding = 'md', tone = 'raised', animate = 'none', className, children, ...rest }: CardProps) {
  return (
    <As className={cx('rounded-2xl', TONE[tone], PADDING[padding], ANIMATE[animate], className)} {...rest}>
      {children}
    </As>
  )
}
