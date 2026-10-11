// Applies settings.theme to <html>: the `dark` class, color-scheme and <meta name="theme-color">.
// index.html runs the same logic before first paint to avoid a flash of the wrong theme.
import { useEffect } from 'react'
import { useSelector } from './hooks'
import { applyTheme, resolveTheme, useSystemDark } from './theme'

/** Renders nothing; keeps <html> in sync with the theme setting and the OS preference. */
export function ThemeSync() {
  const theme = useSelector((s) => s.settings.theme)
  const systemDark = useSystemDark()
  const resolved = resolveTheme(theme, systemDark)
  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])
  return null
}
