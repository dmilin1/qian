import type { IconName } from './Icon'

export interface NavItem {
  to: string
  label: string
  icon: IconName
  /** Only active on an exact match (Study at "/"). */
  end?: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Study', icon: 'study', end: true },
  { to: '/words', label: 'Words', icon: 'words' },
  { to: '/stats', label: 'Stats', icon: 'stats' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

/** Section title for a pathname (null for Study). */
export function titleFor(pathname: string): string | null {
  const item = NAV_ITEMS.find((n) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + '/')))
  return item && item.to !== '/' ? item.label : null
}
