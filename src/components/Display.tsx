// Small display components: StatTile, EmptyState, Kbd, PageHeader, Spinner, Banner, Logo.
import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

// ----- StatTile -----

export interface StatTileProps {
  label: ReactNode
  value: ReactNode
  /** Small caption under the value, e.g. "this week". */
  hint?: ReactNode
  icon?: IconName
  /** Accent-colored value (use sparingly, e.g. for the headline number). */
  accent?: boolean
  className?: string
}

export function StatTile({ label, value, hint, icon, accent, className }: StatTileProps) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1 rounded-2xl border border-line bg-card p-4', className)}>
      <span className="flex items-center gap-1.5 text-sm text-muted">
        {icon ? <Icon name={icon} size={16} /> : null}
        {label}
      </span>
      <span className={cx('text-3xl font-semibold tracking-tight tabular-nums', accent ? 'text-accent' : 'text-ink')}>{value}</span>
      {hint ? <span className="text-sm text-muted">{hint}</span> : null}
    </div>
  )
}

// ----- EmptyState -----

export interface EmptyStateProps {
  icon?: IconName
  title: ReactNode
  children?: ReactNode
  /** Buttons/links. */
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon = 'sparkle', title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sunken text-muted">
        <Icon name={icon} size={26} />
      </span>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {children ? <div className="max-w-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

// ----- Kbd -----

/**
 * Keyboard shortcut hint; hidden on touch devices (shown only with a fine, hover-capable pointer).
 * aria-hidden so the key isn't read as part of a button's name ("Show answer Space"); put
 * `aria-keyshortcuts` on the owning control to expose the shortcut to assistive tech.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cx(
        'kbd-hint min-w-[1.5em] items-center justify-center rounded-md border border-current/25 px-1.5 font-sans text-[0.75em] leading-[1.6] font-medium opacity-70',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

// ----- PageHeader -----

export interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Right-aligned actions. */
  actions?: ReactNode
  /** Leading element, e.g. a back button. */
  leading?: ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, actions, leading, className }: PageHeaderProps) {
  return (
    <header className={cx('mb-6 flex items-center gap-3', className)}>
      {leading}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

// ----- Spinner -----

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cx('inline-flex items-center gap-2 text-muted', className)}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden className="motion-safe:animate-spin">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}

// ----- Banner -----

export interface BannerProps {
  tone?: 'info' | 'warning' | 'success'
  children: ReactNode
  action?: ReactNode
  onDismiss?: () => void
  className?: string
}

/** Inline notice. Warning banners are announced (role="alert"). */
export function Banner({ tone = 'info', children, action, onDismiss, className }: BannerProps) {
  const styles = {
    info: 'border-line bg-sunken text-ink',
    warning: 'border-danger/30 bg-danger-soft text-ink',
    success: 'border-success/30 bg-success-soft text-ink',
  }[tone]
  const icon: IconName = tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info'
  return (
    <div role={tone === 'warning' ? 'alert' : 'status'} className={cx('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', styles, className)}>
      <Icon name={icon} size={18} className={cx('mt-0.5', tone === 'warning' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-muted')} />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1.5 cursor-pointer rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink">
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  )
}

// ----- Logo -----

/** Seal mark: 千 in white on a cinnabar rounded square (same drawing as public/favicon.svg). */
export function SealMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={cx('shrink-0', className)}>
      <rect width="64" height="64" rx="14" fill="var(--accent-solid)" />
      <path d="M41.5 13.5c-5.2 2.6-12 4-19 4.6M14 33h36M32 18.6V51" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Brand: seal mark + "qian" wordmark. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <SealMark />
      <span className="text-lg font-semibold tracking-tight text-ink">
        <span className="sr-only">千 </span>qian
      </span>
    </span>
  )
}
