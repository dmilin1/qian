import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AppProvider } from '../../components'
import { makeFakePlayer, makeTestStore } from '../../components/test-utils'
import { cardKey } from '../../lib/events'
import { FIXTURE_WORDS, makeWords } from '../../lib/__fixtures__/words'
import { createWordIndex, type WordIndex } from '../../lib/words'
import WordDetailPage from './WordDetailPage'
import WordsPage, { ROW_HEIGHT } from './WordsPage'

const fixtures = createWordIndex(FIXTURE_WORDS) // 你 nǐ, 我 wǒ, 是 shì

beforeAll(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})

async function renderPage(path = '/words', words: WordIndex = fixtures) {
  const store = makeTestStore()
  await store.init()
  const fake = makeFakePlayer()
  const router = createMemoryRouter(
    [
      { path: '/words', element: <WordsPage words={words} /> },
      { path: '/words/:id', element: <WordDetailPage words={words} /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <AppProvider store={store} player={fake.player} init={false}>
      <RouterProvider router={router} />
    </AppProvider>,
  )
  return { store, fake, router }
}

const rows = () => within(screen.getByRole('list', { name: 'Words' })).queryAllByRole('listitem')
const rowText = () => rows().map((r) => r.textContent ?? '')

describe('<WordsPage>', () => {
  it('lists every word in rank order with status chips and a summary', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { name: 'Words' })).toBeInTheDocument()
    expect(screen.getByText(/introduced/).textContent).toMatch(/0 of 3 introduced/)
    const items = rows()
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('nǐ')
    expect(items[0]).toHaveTextContent('you')
    expect(items[0]).toHaveTextContent('Unseen')
    expect(items[0]).not.toHaveTextContent('Listen')
    expect(items[0]).toHaveAttribute('aria-setsize', '3')
    expect(items[2]).toHaveTextContent('shì')
  })

  it('searches by tone-numbered pinyin, English and characters, keeping the query in the URL', async () => {
    const { router } = await renderPage()
    const box = screen.getByRole('searchbox', { name: 'Search words' })
    await userEvent.type(box, 'wo3')
    expect(rowText()).toHaveLength(1)
    expect(rowText()[0]).toContain('wǒ')
    expect(router.state.location.search).toBe('?q=wo3')

    await userEvent.clear(box)
    await userEvent.type(box, 'to be')
    expect(rowText()).toHaveLength(1)
    expect(rowText()[0]).toContain('shì')

    await userEvent.clear(box)
    await userEvent.type(box, '你')
    expect(rowText()).toHaveLength(1)

    await userEvent.clear(box)
    await userEvent.type(box, 'zzz')
    expect(screen.getByText('No matching words')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(rows()).toHaveLength(3)
    expect(router.state.location.search).toBe('')
  })

  it('restores query and filter from the URL', async () => {
    await renderPage('/words?q=ni&f=unseen')
    expect(screen.getByRole('searchbox')).toHaveValue('ni')
    expect(screen.getByRole('radio', { name: /Unseen/ })).toHaveAttribute('aria-checked', 'true')
    expect(rows()).toHaveLength(1)
  })

  it('filters by status, with counts', async () => {
    const { store } = await renderPage()
    await act(() => store.grade(cardKey('w6211', 'listen'), 'good')) // 我: learning
    await act(() => store.markKnown('w662f')) // 是: known
    await act(() => store.setSuspended('w4f60', true)) // 你: suspended

    expect(screen.getByText(/introduced/).textContent).toMatch(/2 of 3 introduced/)
    const learning = screen.getByRole('radio', { name: /Learning/ })
    expect(learning).toHaveTextContent('1')
    await userEvent.click(learning)
    expect(rowText()).toEqual([expect.stringContaining('wǒ')])
    expect(rows()[0]).toHaveTextContent(/learning/)

    await userEvent.click(screen.getByRole('radio', { name: /Known/ }))
    expect(rowText()).toEqual([expect.stringContaining('shì')])
    expect(rows()[0]).toHaveTextContent(/young/)

    await userEvent.click(screen.getByRole('radio', { name: /Suspended/ }))
    expect(rowText()).toEqual([expect.stringContaining('nǐ')])
    expect(rows()[0]).toHaveTextContent('Suspended')

    await userEvent.click(screen.getByRole('radio', { name: /Unseen/ }))
    expect(screen.getByText('No matching words')).toBeInTheDocument()

    await act(() => store.flag('w6211', 'audio', 'muffled'))
    await userEvent.click(screen.getByRole('radio', { name: /Flagged/ }))
    expect(rowText()).toEqual([expect.stringContaining('flagged (1)')])
    expect(rows()[0]).toHaveTextContent(/Listen\s*·?\s*:?\s*learning/)
  })

  it('filter chips are a keyboard-navigable radio group', async () => {
    const { router } = await renderPage()
    const all = screen.getByRole('radio', { name: /All/ })
    all.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: /Learning/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Learning/ })).toHaveFocus()
    expect(router.state.location.search).toBe('?f=learning')
  })

  it('plays audio from the row without opening the word', async () => {
    const { fake, router } = await renderPage()
    await userEvent.click(within(rows()[1]).getByRole('button', { name: 'Play wǒ' }))
    expect(fake.play).toHaveBeenCalledWith('w6211', 'word', { slow: false })
    expect(router.state.location.pathname).toBe('/words')
  })

  it('opens the detail page when a row is tapped', async () => {
    const { router } = await renderPage()
    await userEvent.click(within(rows()[2]).getByRole('link'))
    expect(router.state.location.pathname).toBe('/words/w662f')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('shì')
  })

  it('only renders the rows near the viewport for a long list', async () => {
    const many = createWordIndex(makeWords(1000))
    await renderPage('/words', many)
    const list = screen.getByRole('list', { name: 'Words' })
    expect(list.style.height).toBe(`${1000 * ROW_HEIGHT}px`)
    const items = rows()
    expect(items.length).toBeGreaterThan(5)
    expect(items.length).toBeLessThan(60)
    expect(items[0]).toHaveAttribute('aria-posinset', '1')
    expect(items[0]).toHaveAttribute('aria-setsize', '1000')
    expect(screen.getByText(/introduced/).textContent).toMatch(/0 of 1,000 introduced/)
  })
})
