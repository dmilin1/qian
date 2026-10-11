import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProvider } from '../../components'
import { makeFakePlayer } from '../../components/test-utils'
import { FIXTURE_WORDS } from '../../lib/__fixtures__/words'
import type { AppEvent } from '../../lib/events'
import { buildExport, serializeExport } from '../../lib/exportImport'
import { DEFAULT_SETTINGS } from '../../lib/settings'
import { createAppStore } from '../../lib/store'
import { createWordIndex } from '../../lib/words'
import StatsPage from './StatsPage'
import { NOW, seededEvents } from './testData'

const words = createWordIndex(FIXTURE_WORDS)

async function renderStats(events: AppEvent[] = [], opts: { liveClock?: boolean } = {}) {
  const store = createAppStore({ inMemory: true, storage: null, storageManager: null, words, now: () => NOW })
  await store.init()
  if (events.length) await store.importData(serializeExport(buildExport(events, DEFAULT_SETTINGS, 'test-device', NOW)), 'replace')
  const router = createMemoryRouter(
    [
      { path: '/stats', element: <StatsPage words={words} now={opts.liveClock ? undefined : NOW} /> },
      { path: '/words/:id', element: <p>word detail</p> },
      { path: '/words', element: <p>word list</p> },
      { path: '/', element: <p>study</p> },
    ],
    { initialEntries: ['/stats'] },
  )
  render(
    <AppProvider store={store} player={makeFakePlayer().player}>
      <RouterProvider router={router} />
    </AppProvider>,
  )
  return { store, router }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('<StatsPage>', () => {
  it('rolls over to the new day when the app is resumed', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    await renderStats(seededEvents(), { liveClock: true })
    const overview = screen.getByRole('region', { name: 'Overview' })
    const tile = (label: string) => within(overview).getByText(label).closest('div')!
    expect(tile('Reviews today')).toHaveTextContent('2')
    expect(tile('Streak')).toHaveTextContent('including today')

    // The installed app sits on Stats overnight and is brought back to the foreground.
    vi.setSystemTime(NOW + 24 * 60 * 60 * 1000)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(tile('Reviews today')).toHaveTextContent(/^Reviews today0/)
    expect(tile('Streak')).toHaveTextContent('study today to keep it')
  })

  it('shows an empty state for a brand-new user', async () => {
    await renderStats()
    expect(screen.getByRole('heading', { name: 'Stats' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nothing to show yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start studying/i })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('heading', { name: 'Accuracy' })).not.toBeInTheDocument()
  })

  it('renders every section with seeded data', async () => {
    const { router } = await renderStats(seededEvents())

    const overview = screen.getByRole('region', { name: 'Overview' })
    const tile = (label: string) => within(overview).getByText(label).closest('div')!
    expect(tile('Words introduced')).toHaveTextContent('3')
    expect(tile('Words introduced')).toHaveTextContent('of 3')
    expect(tile('Streak')).toHaveTextContent('3 days')
    expect(tile('Reviews today')).toHaveTextContent('2')
    expect(tile('Time today')).toHaveTextContent('1 min')
    expect(tile('Accuracy')).toHaveTextContent('%')

    for (const name of ['Progress through the 3', 'Daily reviews', 'Accuracy', 'Upcoming reviews', 'Hardest words', 'Flagged cards']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }

    // Each chart has a plain-text summary.
    const heat = screen.getByRole('region', { name: 'Daily reviews' })
    expect(within(heat).getByText(/reviews on \d+ days in the last \d+ months/)).toBeInTheDocument()
    expect(within(heat).getByRole('img')).toHaveAccessibleName(/Daily reviews/)
    expect(heat.querySelectorAll('rect[data-day]').length).toBeGreaterThan(7 * 12 - 1)
    const acc = screen.getByRole('region', { name: 'Accuracy' })
    expect(within(acc).getByText(/Listen \d+% of \d+ reviews · Say \d+% of \d+ reviews/)).toBeInTheDocument()
    expect(within(acc).getByRole('table', { hidden: true })).toBeInTheDocument()
    const progress = screen.getByRole('region', { name: 'Progress through the 3' })
    expect(within(progress).getByText(/Listen cards: 3 started/)).toBeInTheDocument()
    expect(within(progress).getByRole('rowheader', { name: /Learning/ })).toBeInTheDocument()

    // Hardest words link to the word detail page.
    const hardest = screen.getByRole('region', { name: 'Hardest words' })
    const links = within(hardest).getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', '/words/w4f60')
    expect(links[0]).toHaveTextContent(/\d+ lapses?/)
    expect(within(hardest).getAllByRole('button', { name: /Play/ })).toHaveLength(links.length)

    // Flagged cards link to the words page filter.
    const flags = screen.getByRole('region', { name: 'Flagged cards' })
    expect(within(flags).getByText(/1 open flag on 1 word/)).toBeInTheDocument()
    const review = within(flags).getByRole('link', { name: /review/i })
    expect(review).toHaveAttribute('href', '/words?f=flagged')

    review.click()
    await screen.findByText('word list')
    expect(router.state.location.search).toBe('?f=flagged')
  })

  it('exports open flags as a CSV list', async () => {
    const blobs: Blob[] = []
    const names: string[] = []
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn((b: Blob) => (blobs.push(b), 'blob:x')), configurable: true, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    try {
      await renderStats(seededEvents())
      const flags = screen.getByRole('region', { name: 'Flagged cards' })
      await userEvent.click(within(flags).getByRole('button', { name: /export flags/i }))
      await waitFor(() => expect(blobs).toHaveLength(1))
      expect(names[0]).toMatch(/^qian-flags-\d{4}-\d{2}-\d{2}\.csv$/)
      expect(blobs[0].type).toBe('text/csv')
      const text = await new Promise<string>((res) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.readAsText(blobs[0])
      })
      const lines = text.trim().split('\n')
      expect(lines[0]).toBe('wordId,trad,pinyin,gloss,reason,note,flaggedAt,resolved')
      expect(lines).toHaveLength(2)
      expect(lines[1]).toMatch(/^w662f,是,shì,/)
    } finally {
      click.mockRestore()
    }
  })

  it('offers no flag export without open flags', async () => {
    await renderStats(seededEvents().filter((e) => e.kind !== 'flag'))
    const flags = screen.getByRole('region', { name: 'Flagged cards' })
    expect(within(flags).queryByRole('button', { name: /export flags/i })).toBeNull()
  })
})
