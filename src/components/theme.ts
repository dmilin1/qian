// Theme helpers: resolve settings.theme against the OS preference and apply it to <html>.
import { useSyncExternalStore } from 'react'
import type { Theme } from '../lib/settings'

/** Page background per theme; keep in sync with --paper in index.css and the script in index.html. */
export const THEME_COLORS = { light: '#f6f1e7', dark: '#141312' } as const

export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}

const QUERY = '(prefers-color-scheme: dark)'

function subscribeSystem(cb: () => void): () => void {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(QUERY) : undefined
  if (!mq) return () => {}
  mq.addEventListener?.('change', cb)
  return () => mq.removeEventListener?.('change', cb)
}

function getSystemDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches
}

/** Whether the OS prefers dark mode (live). */
export function useSystemDark(): boolean {
  return useSyncExternalStore(subscribeSystem, getSystemDark, () => false)
}

export function applyTheme(resolved: 'light' | 'dark', doc: Document = document): void {
  const root = doc.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  const color = THEME_COLORS[resolved]
  const metas = doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  if (metas.length === 0) {
    const m = doc.createElement('meta')
    m.name = 'theme-color'
    m.content = color
    doc.head.appendChild(m)
  }
  // Drop the media-query variants from index.html once the user's choice is known.
  metas.forEach((m) => {
    m.removeAttribute('media')
    m.content = color
  })
}

