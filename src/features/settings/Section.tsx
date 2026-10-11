import type { ReactNode } from 'react'
import { Card, cx, Icon, type IconName } from '../../components'

export interface SectionProps {
  id: string
  title: string
  icon: IconName
  /** One line under the heading. */
  intro?: ReactNode
  children: ReactNode
}

/** A titled group of settings: heading above a card whose rows are separated by hairlines. */
export function Section({ id, title, icon, intro, children }: SectionProps) {
  const headingId = `${id}-heading`
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-24 flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
          <Icon name={icon} size={18} className="text-accent" />
          {title}
        </h2>
        {intro ? <p className="text-sm text-muted">{intro}</p> : null}
      </div>
      <Card padding="none" tone="flat" className="divide-y divide-line">
        {children}
      </Card>
    </section>
  )
}

const ROW_PY = { tight: 'py-1', md: 'py-3', loose: 'py-4' }

/** A padded row inside a Section card (`tight` for Toggle/Slider rows, which pad themselves). */
export function Row({ children, className, py = 'md' }: { children: ReactNode; className?: string; py?: keyof typeof ROW_PY }) {
  return <div className={cx('px-5', ROW_PY[py], className)}>{children}</div>
}

/** Label + description block for rows with custom controls. */
export function RowLabel({ title, description, htmlFor, id }: { title: ReactNode; description?: ReactNode; htmlFor?: string; id?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      {htmlFor ? (
        <label htmlFor={htmlFor} id={id} className="font-medium text-ink">
          {title}
        </label>
      ) : (
        <span id={id} className="font-medium text-ink">
          {title}
        </span>
      )}
      {description ? <span className="text-sm text-muted">{description}</span> : null}
    </div>
  )
}
