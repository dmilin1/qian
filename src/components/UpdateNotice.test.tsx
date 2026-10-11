import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { markUpdateReady, reloadApp, resetUpdateState } from './pwaUpdate'
import { UpdateNotice } from './UpdateNotice'

afterEach(() => resetUpdateState())

describe('<UpdateNotice>', () => {
  it('keeps its live region mounted and fills it when an update is ready; "Later" dismisses', async () => {
    render(<UpdateNotice />)
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()
    act(() => markUpdateReady())
    expect(status).toHaveTextContent('A new version of qian is ready.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(status).toBeEmptyDOMElement()
    // Dismissed stays dismissed for this page load.
    act(() => markUpdateReady())
    expect(status).toBeEmptyDOMElement()
  })
})

describe('reloadApp', () => {
  it('rewrites the hash without a hashchange, then reloads', () => {
    const calls: string[] = []
    const win = {
      location: { pathname: '/qian/', search: '?a=1', reload: vi.fn(() => calls.push('reload')) },
      history: { replaceState: vi.fn((_s: unknown, _t: string, url?: string | URL | null) => calls.push(`replace ${String(url)}`)) },
    }
    reloadApp('#/', win)
    expect(calls).toEqual(['replace /qian/?a=1#/', 'reload'])
    calls.length = 0
    reloadApp(undefined, win)
    expect(calls).toEqual(['reload'])
  })
})
