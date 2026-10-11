import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { markUpdateReady, reloadApp, resetUpdateState } from './pwaUpdate'
import { RouteError } from './RouteError'

vi.mock('./pwaUpdate', async (importOriginal) => ({ ...(await importOriginal<typeof import('./pwaUpdate')>()), reloadApp: vi.fn() }))

function Boom(): never {
  throw new Error('Failed to fetch dynamically imported module: /qian/assets/StatsPage-old.js')
}

function renderError() {
  const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <RouteError /> }])
  render(<RouterProvider router={router} />)
}

afterEach(() => {
  resetUpdateState()
  vi.mocked(reloadApp).mockClear()
})

describe('<RouteError>', () => {
  it('"Back to study" really reloads onto the study route (a hash link would not reload)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderError()
    expect(screen.getByText(/dynamically imported module/)).toHaveClass('text-muted')
    const btn = screen.getByRole('button', { name: 'Back to study' })
    expect(screen.queryByRole('link', { name: 'Back to study' })).toBeNull()
    await userEvent.click(btn)
    expect(reloadApp).toHaveBeenCalledWith('#/')
  })

  it('shows the new-version notice when an update is waiting', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderError()
    expect(screen.queryByText(/new version/)).toBeNull()
    act(() => markUpdateReady())
    expect(screen.getByText(/new version of qian is ready/)).toBeInTheDocument()
  })
})
