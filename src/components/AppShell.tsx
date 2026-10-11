import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router'
import { cx } from './cx'
import { Banner, Logo, Spinner } from './Display'
import { useSelector } from './hooks'
import { Icon } from './Icon'
import { NAV_ITEMS, titleFor } from './navItems'
import { UpdateNotice } from './UpdateNotice'

/** Top bar: wider screens (sm and up). */
function TopBar() {
  return (
    <header className="sticky top-0 z-20 hidden border-b border-line bg-paper/85 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:block">
      <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between gap-4 px-5">
        <NavLink to="/" aria-label="千 qian, Study" className="-m-1 rounded-lg p-1">
          <Logo />
        </NavLink>
        <nav aria-label="Main">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    cx(
                      'flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors duration-150',
                      isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-sunken hover:text-ink',
                    )
                  }
                >
                  <Icon name={n.icon} size={18} />
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}

/** Bottom tab bar: phones (below sm). */
function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
    >
      <ul className="mx-auto flex h-(--tabbar-h) max-w-content items-stretch px-2">
        {NAV_ITEMS.map((n) => (
          <li key={n.to} className="flex flex-1">
            <NavLink
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.6875rem] font-medium tracking-wide transition-colors duration-150',
                  isActive ? 'text-accent' : 'text-muted hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cx('flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150', isActive && 'bg-accent-soft')}>
                    <Icon name={n.icon} size={22} strokeWidth={isActive ? 2 : 1.75} />
                  </span>
                  {n.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function StoreError() {
  const error = useSelector((s) => s.error)
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!error || dismissed === error) return null
  return (
    <Banner tone="warning" onDismiss={() => setDismissed(error)} className="mb-4">
      {error}
    </Banner>
  )
}

export function PageLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <Spinner />
    </div>
  )
}

/**
 * Layout for every route: skip link, top bar (sm+) or bottom tab bar (phones), a centered
 * single column (`max-w-content`), the store error banner, and a loading state until the store
 * is ready. `main` is a flex column, so a page can use `flex-1` to fill the height.
 */
export function AppShell() {
  const ready = useSelector((s) => s.ready)
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const first = useRef(true)

  // Title per section. A layout effect runs before every passive effect of the commit, so a
  // page's more specific usePageTitle() (a passive effect) always wins.
  useLayoutEffect(() => {
    const t = titleFor(pathname)
    document.title = t ? `${t} · 千 qian` : '千 qian'
  }, [pathname])

  // Move focus to <main> after in-app navigation (screen readers).
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <>
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          mainRef.current?.focus()
        }}
        className="sr-only z-50 rounded-lg bg-card px-4 py-2 text-ink shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <TopBar />
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto flex w-full max-w-content flex-1 flex-col px-5 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(var(--tabbar-h)+2rem+env(safe-area-inset-bottom))] outline-none sm:pt-8 sm:pb-12"
      >
        <UpdateNotice className="mb-4" />
        <StoreError />
        {ready ? (
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        ) : (
          <PageLoading />
        )}
      </main>
      <TabBar />
      <ScrollRestoration />
    </>
  )
}
