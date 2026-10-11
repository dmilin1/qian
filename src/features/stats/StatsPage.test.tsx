import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it } from 'vitest'
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

async function renderStats(events: AppEvent[] = []) {
  const store = createAppStore({ inMemory: true, storage: null, storageManager: null, words, now: () => NOW })
  await store.init()
  if (events.length) await store.importData(serializeExport(buildExport(events, DEFAULT_SETTINGS, 'test-device', NOW)), 'replace')
  const router = createMemoryRouter(
    [
      { path: '/stats', element: <StatsPage words={words} now={NOW} /> },
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

describe('<StatsPage>', () => {
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
})
