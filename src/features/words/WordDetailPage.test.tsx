import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AppProvider } from '../../components'
import { makeFakePlayer, makeTestStore } from '../../components/test-utils'
import { cardKey } from '../../lib/events'
import { FIXTURE_WORDS, makeWord } from '../../lib/__fixtures__/words'
import { createWordIndex } from '../../lib/words'
import WordDetailPage from './WordDetailPage'
import WordsPage from './WordsPage'
import { formatPercent, formatRelative, formatStability } from './format'

const words = createWordIndex([
  ...FIXTURE_WORDS,
  makeWord(4, {
    id: 'w4f60-597d',
    trad: '你好',
    simp: '你好',
    pinyin: 'nǐ hǎo',
    pinyinNumbered: 'ni3 hao3',
    tones: [3, 3],
    spokenAs: 'ní hǎo',
    gloss: 'hello',
    hint: 'greeting',
    pos: 'interj',
    note: 'Polite greeting; friends often just say 嗨.',
    example: { trad: '你好，我是小明。', simp: '你好，我是小明。', pinyin: 'Nǐ hǎo, wǒ shì Xiǎomíng.', english: 'Hi, I’m Xiaoming.' },
  }),
  makeWord(5, { id: 'w9019', trad: '這', simp: '这', pinyin: 'zhè', pinyinNumbered: 'zhe4', tones: [4], gloss: 'this' }),
])

beforeAll(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  // jsdom lacks <dialog> methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

async function renderDetail(id: string, initialEntries?: string[]) {
  const store = makeTestStore()
  await store.init()
  const fake = makeFakePlayer()
  const router = createMemoryRouter(
    [
      { path: '/words', element: <WordsPage words={words} /> },
      { path: '/words/:id', element: <WordDetailPage words={words} /> },
    ],
    { initialEntries: initialEntries ?? [`/words/${id}`] },
  )
  render(
    <AppProvider store={store} player={fake.player} init={false}>
      <RouterProvider router={router} />
    </AppProvider>,
  )
  return { store, fake, router }
}

const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section') as HTMLElement

describe('<WordDetailPage>', () => {
  it('shows the word: pinyin, spoken-as hint, characters (trad + simp), meaning, example', async () => {
    await renderDetail('w4f60-597d')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nǐ hǎo')
    expect(screen.getByText(/spoken as/)).toHaveTextContent('ní hǎo')
    expect(screen.getAllByText('你好').length).toBeGreaterThan(0)
    expect(screen.getByText('interjection').parentElement).toHaveTextContent('#4')
    const meaning = section('Meaning')
    expect(meaning).toHaveTextContent('hello')
    expect(meaning).toHaveTextContent('greeting')
    expect(meaning).toHaveTextContent('Polite greeting')
    const example = section('Example')
    expect(example).toHaveTextContent('Hi, I’m Xiaoming.')
    expect(example).toHaveTextContent('Xiǎomíng')
    expect(section('History')).toHaveTextContent('No reviews yet.')
  })

  it('shows simplified characters when they differ', async () => {
    await renderDetail('w9019')
    expect(screen.getByText('这')).toBeInTheDocument()
    expect(screen.getByText('這')).toBeInTheDocument()
  })

  it('plays the word and the example, normal and slow', async () => {
    const { fake } = await renderDetail('w4f60-597d')
    await userEvent.click(screen.getByRole('button', { name: 'Play word' }))
    expect(fake.play).toHaveBeenLastCalledWith('w4f60-597d', 'word', { slow: false })
    await userEvent.click(screen.getByRole('button', { name: /Play word slowly/ }))
    expect(fake.play).toHaveBeenLastCalledWith('w4f60-597d', 'word', { slow: true })
    await userEvent.click(screen.getByRole('button', { name: /^Play\b.*Play example\)/ }))
    expect(fake.play).toHaveBeenLastCalledWith('w4f60-597d', 'example', { slow: false })
    await userEvent.click(screen.getByRole('button', { name: /Play example slowly/ }))
    expect(fake.play).toHaveBeenLastCalledWith('w4f60-597d', 'example', { slow: true })
  })

  it('shows per-direction card stats and the review history', async () => {
    const { store } = await renderDetail('w4f60')
    const cards = section('Cards')
    expect(within(cards).getByRole('article', { name: 'Listen' })).toHaveTextContent('Not introduced yet')

    await act(() => store.grade(cardKey('w4f60', 'listen'), 'again', 4200))
    await act(() => store.grade(cardKey('w4f60', 'listen'), 'good'))
    const listen = within(section('Cards')).getByRole('article', { name: 'Listen' })
    expect(listen).toHaveTextContent('Learning')
    expect(listen).toHaveTextContent(/Recall now\s*\d+%|Recall now\s*> 99%/)
    expect(listen).toHaveTextContent(/Reviews\s*2/)
    expect(listen).toHaveTextContent(/Lapses\s*0/)
    expect(listen).toHaveTextContent(/Stability/)
    expect(listen).toHaveTextContent(/Due/)
    const say = within(section('Cards')).getByRole('article', { name: 'Say' })
    expect(say).toHaveTextContent('unlocks once the Listen card graduates')

    const history = within(section('History')).getAllByRole('listitem')
    expect(history).toHaveLength(2)
    expect(history[0]).toHaveTextContent('Listen · Good')
    expect(history[1]).toHaveTextContent('Listen · Again')
    expect(history[1]).toHaveTextContent('4 s')
  })

  it('records "I already know this" in the history with both cards in review', async () => {
    const { store } = await renderDetail('w662f')
    await act(() => store.markKnown('w662f'))
    const cards = section('Cards')
    expect(within(cards).getByRole('article', { name: 'Listen' })).toHaveTextContent('Review')
    expect(within(cards).getByRole('article', { name: 'Say' })).toHaveTextContent('Review')
    expect(section('History')).toHaveTextContent('I already know this')
  })

  it('suspends and unsuspends', async () => {
    await renderDetail('w6211')
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(screen.getByRole('button', { name: 'Unsuspend' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('Suspended').length).toBeGreaterThan(0)
    expect(section('History')).toHaveTextContent('Suspended')
    await userEvent.click(screen.getByRole('button', { name: 'Unsuspend' }))
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
    expect(section('History')).toHaveTextContent('Unsuspended')
  })

  it('flags with a reason and note, then resolves the flag', async () => {
    const { store } = await renderDetail('w6211')
    await userEvent.click(screen.getByRole('button', { name: 'Flag a problem' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: /pinyin/i }))
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Note/ }), 'should be 2nd tone')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Flag word' }))

    const flags = store.getSnapshot().derived.words.get('w6211')!.flags
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ reason: 'pinyin', note: 'should be 2nd tone', resolved: false })
    const open = screen.getByRole('list', { name: 'Open flags' })
    expect(open).toHaveTextContent('Pinyin')
    expect(open).toHaveTextContent('should be 2nd tone')

    await userEvent.click(within(open).getByRole('button', { name: 'Resolve pinyin flag' }))
    expect(screen.queryByRole('list', { name: 'Open flags' })).not.toBeInTheDocument()
    expect(store.getSnapshot().derived.words.get('w6211')!.flags[0].resolved).toBe(true)
    expect(section('History')).toHaveTextContent('Resolved flag: Pinyin')
  })

  it('handles an unknown word id', async () => {
    await renderDetail('nope')
    expect(screen.getByText('Word not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All words' })).toHaveAttribute('href', '/words')
  })

  it('goes back to the list with its search intact, and steps to neighbouring words', async () => {
    const { router } = await renderDetail('', ['/words?q=shi'])
    await userEvent.click(screen.getByRole('link', { name: /shì/ }))
    expect(router.state.location.pathname).toBe('/words/w662f')
    await userEvent.click(screen.getByRole('link', { name: /Next word: nǐ hǎo/ }))
    expect(router.state.location.pathname).toBe('/words/w4f60-597d')
    await userEvent.click(screen.getByRole('link', { name: 'Words' }))
    expect(router.state.location.pathname).toBe('/words')
    expect(router.state.location.search).toBe('?q=shi')
  })
})

describe('format helpers', () => {
  it('formats stability, percentages and relative times', () => {
    expect(formatStability(0.25)).toBe('6 h')
    expect(formatStability(1)).toBe('1 day')
    expect(formatStability(3.24)).toBe('3.2 days')
    expect(formatStability(45)).toBe('45 days')
    expect(formatStability(120)).toBe('3.9 months')
    expect(formatPercent(0.934)).toBe('93%')
    expect(formatPercent(0.9999)).toBe('> 99%')
    const now = Date.UTC(2026, 9, 11, 12)
    expect(formatRelative(now + 10 * 60_000, now)).toBe('in 10 minutes')
    expect(formatRelative(now + 3 * 86_400_000, now)).toBe('in 3 days')
    expect(formatRelative(now - 2 * 3_600_000, now)).toBe('2 hours ago')
    expect(formatRelative(now + 10_000, now)).toBe('now')
  })
})
