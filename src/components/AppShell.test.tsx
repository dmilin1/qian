import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { routes } from './routes'
import { AppProvider } from './AppProvider'
import { makeFakePlayer, makeTestStore } from './test-utils'

async function renderApp(path = '/') {
  const store = makeTestStore()
  await store.init()
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AppProvider store={store} player={makeFakePlayer().player}>
      <RouterProvider router={router} />
    </AppProvider>,
  )
  return { store, router }
}

describe('<AppShell>', () => {
  beforeAll(() => {
    // jsdom has no scrolling; ScrollRestoration calls it on navigation.
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  })

  it('renders main navigation with the four sections and marks the current one', async () => {
    await renderApp('/')
    const navs = screen.getAllByRole('navigation', { name: 'Main' })
    expect(navs).toHaveLength(2) // top bar (sm+) and bottom tab bar (phones); CSS shows one
    for (const nav of navs) {
      const links = within(nav).getAllByRole('link').map((a) => a.textContent)
      expect(links).toEqual(['Study', 'Words', 'Stats', 'Settings'])
      expect(within(nav).getByRole('link', { name: 'Study' })).toHaveAttribute('aria-current', 'page')
    }
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('navigates between sections and sets the document title', async () => {
    const { router } = await renderApp('/')
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[1]
    await userEvent.click(within(nav).getByRole('link', { name: 'Settings' }))
    expect(router.state.location.pathname).toBe('/settings')
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(document.title).toBe('Settings · 千 qian')
    expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps Words active on a word detail route and lazy-loads Stats', async () => {
    await renderApp('/words/w4f60')
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[1]
    expect(within(nav).getByRole('link', { name: 'Words' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(nav).getByRole('link', { name: 'Stats' }))
    expect(await screen.findByRole('heading', { name: 'Stats' })).toBeInTheDocument()
  })

  it("lets a page's usePageTitle override the section title on first render", async () => {
    await renderApp('/words/w4f60')
    await screen.findByRole('heading', { level: 1 })
    expect(document.title).not.toBe('Words · 千 qian')
    expect(document.title).toMatch(/你 · 千 qian$/)
  })

  it('redirects unknown routes to Study', async () => {
    const { router } = await renderApp('/nope')
    expect(router.state.location.pathname).toBe('/')
  })
})
