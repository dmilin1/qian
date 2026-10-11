import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProvider } from '../../components/AppProvider'
import { makeFakePlayer, makeTestStore } from '../../components/test-utils'
import type { AudioPlayer } from '../../lib/audio'
import type { Settings } from '../../lib/settings'
import type { AppStore } from '../../lib/store'
import StudyPage from './StudyPage'
import { studySession } from './session'

type Store = ReturnType<typeof makeTestStore>

async function setup(opts: { settings?: Partial<Settings>; prepare?: (store: Store) => void | Promise<void>; player?: AudioPlayer } = {}) {
  const store = makeTestStore(opts.settings)
  await store.init()
  await opts.prepare?.(store)
  const fake = makeFakePlayer()
  const player = opts.player ?? fake.player
  const user = userEvent.setup()
  const utils = render(
    <AppProvider store={store} player={player}>
      <StudyPage />
    </AppProvider>,
  )
  return { ...utils, store, fake, user }
}

/** Grade cards through the store until `until(current)` holds. */
function advance(store: AppStore, until: (c: NonNullable<ReturnType<AppStore['getSnapshot']>['current']>) => boolean, grade: 'again' | 'good' | 'easy' = 'easy') {
  for (let i = 0; i < 20; i++) {
    const c = store.getSnapshot().current
    if (!c) throw new Error('caught up before reaching the wanted card')
    if (until(c)) return c
    void store.grade(c.key, grade, 1000)
  }
  throw new Error('card not reached')
}

const grades = () => screen.queryByRole('group', { name: 'Grade' })

beforeEach(() => {
  studySession.reset()
})

describe('Listen card', () => {
  it('front: autoplays, shows pinyin + characters, NEW badge and "I already know this"; no answer yet', async () => {
    const { fake } = await setup()
    const card = await screen.findByRole('article', { name: 'Listen card' })
    expect(within(card).getByText('nǐ')).toBeInTheDocument()
    expect(within(card).getByText('你')).toBeInTheDocument()
    expect(within(card).getByText('New')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Replay word' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Replay slowly/ })).toBeInTheDocument()
    expect(within(card).queryByText('you')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /I already know this/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show answer/ })).toBeInTheDocument()
    expect(grades()).toBeNull()
    expect(fake.play).toHaveBeenCalledWith('w4f60', 'word', { slow: false })
  })

  it('does not autoplay when autoplay is off', async () => {
    const { fake } = await setup({ settings: { autoplay: false } })
    await screen.findByRole('article', { name: 'Listen card' })
    expect(fake.play).not.toHaveBeenCalled()
  })

  it('back: gloss, pos, note, spokenAs, example with play button, and grade buttons with previews', async () => {
    const { user } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    const card = screen.getByRole('article', { name: 'Listen card' })
    expect(within(card).getByText('you')).toBeInTheDocument()
    expect(within(card).getByText('noun')).toBeInTheDocument()
    expect(within(card).getByText('example 1')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Play example sentence' })).toBeInTheDocument()
    // The known button only belongs on the front.
    expect(screen.queryByRole('button', { name: /I already know this/ })).toBeNull()
    const g = grades()!
    expect(within(g).getByRole('button', { name: /^Again, next in (<1m|\d+m)$/ })).toBeInTheDocument()
    expect(within(g).getByRole('button', { name: /^Good, next in/ })).toBeInTheDocument()
    expect(within(g).getByRole('button', { name: /^Easy, next in \d+d$/ })).toBeInTheDocument()
  })

  it('back shows note and "spoken as" hints when the word has them', async () => {
    const { user, store } = await setup({
      prepare: (s) => {
        // Patch the fixture word in the current card (fixtures have no note/spokenAs).
        const c = s.getSnapshot().current!
        Object.assign(c.word, { note: 'Polite form is 您.', spokenAs: 'ní' })
      },
    })
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    expect(screen.getByText('Polite form is 您.')).toBeInTheDocument()
    expect(screen.getByText('spoken:')).toBeInTheDocument()
    expect(screen.getByText('ní')).toBeInTheDocument()
    Object.assign(store.getSnapshot().current!.word, { note: undefined, spokenAs: undefined })
  })

  it('audioOnly mode hides pinyin and characters until reveal', async () => {
    const { user, fake } = await setup({ settings: { listenFront: 'audioOnly' } })
    const card = await screen.findByRole('article', { name: 'Listen card' })
    expect(within(card).queryByText('nǐ')).toBeNull()
    expect(within(card).queryByText('你')).toBeNull()
    expect(within(card).getByText('What does this mean?')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Replay word' })).toBeInTheDocument()
    expect(fake.play).toHaveBeenCalledWith('w4f60', 'word', { slow: false })
    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    expect(within(card).getByText('nǐ')).toBeInTheDocument()
    expect(within(card).getByText('你')).toBeInTheDocument()
    expect(within(card).getByText('you')).toBeInTheDocument()
    expect(within(card).queryByText('What does this mean?')).toBeNull()
  })

  it('hides characters when showCharacters is off', async () => {
    await setup({ settings: { showCharacters: false } })
    const card = await screen.findByRole('article', { name: 'Listen card' })
    expect(within(card).getByText('nǐ')).toBeInTheDocument()
    expect(within(card).queryByText('你')).toBeNull()
  })
})

describe('Say card', () => {
  const toSay = (s: AppStore) => {
    advance(s, (c) => c.dir === 'say')
  }

  it('front: English gloss + prompt, no pinyin, no audio, no known button', async () => {
    const { fake, store } = await setup({ prepare: toSay })
    const cur = store.getSnapshot().current!
    const card = await screen.findByRole('article', { name: 'Say card' })
    expect(within(card).getByText(cur.word.gloss)).toBeInTheDocument()
    expect(within(card).getByText('Say it out loud')).toBeInTheDocument()
    expect(within(card).queryByText(cur.word.pinyin)).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Replay word' })).toBeNull()
    expect(screen.queryByRole('button', { name: /I already know this/ })).toBeNull()
    expect(fake.play).not.toHaveBeenCalled()
  })

  it('back: pinyin, characters, replay, example; autoplays the word on reveal', async () => {
    const { fake, store, user } = await setup({ prepare: toSay })
    const cur = store.getSnapshot().current!
    await screen.findByRole('article', { name: 'Say card' })
    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    const card = screen.getByRole('article', { name: 'Say card' })
    expect(within(card).getByText(cur.word.pinyin)).toBeInTheDocument()
    expect(within(card).getByText(cur.word.trad)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Replay word' })).toBeInTheDocument()
    expect(within(card).getByText(cur.word.example.english)).toBeInTheDocument()
    expect(within(card).queryByText('Say it out loud')).toBeNull()
    expect(fake.play).toHaveBeenCalledWith(cur.wordId, 'word', { slow: false })
    expect(grades()).not.toBeNull()
  })
})

describe('"I already know this"', () => {
  it('appears only on a new word, and calls store.markKnown', async () => {
    const { user, store } = await setup()
    const spy = vi.spyOn(store, 'markKnown')
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: /I already know this/ }))
    expect(spy).toHaveBeenCalledWith('w4f60')
    expect(await screen.findByText(/Marked “you” as known/)).toBeInTheDocument()
  })

  it('is not offered on a card that is not new', async () => {
    await setup({
      prepare: (s) => {
        advance(s, (c) => !c.isNew, 'again')
      },
    })
    const card = await screen.findByRole('article')
    expect(within(card).queryByText('New')).toBeNull()
    expect(screen.queryByRole('button', { name: /I already know this/ })).toBeNull()
  })
})

describe('grading', () => {
  it('calls store.grade with the card key, grade and elapsed time, then shows the next card front', async () => {
    const { user, store } = await setup()
    const spy = vi.spyOn(store, 'grade')
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    await user.click(screen.getByRole('button', { name: /^Good/ }))
    expect(spy).toHaveBeenCalledTimes(1)
    const [key, grade, elapsed] = spy.mock.calls[0]
    expect(key).toBe('w4f60:listen')
    expect(grade).toBe('good')
    expect(typeof elapsed).toBe('number')
    expect(elapsed).toBeGreaterThanOrEqual(0)
    // Next card is shown on its front.
    expect(screen.getByRole('button', { name: /Show answer/ })).toBeInTheDocument()
    expect(grades()).toBeNull()
    expect(store.getSnapshot().current?.key).not.toBe('w4f60:listen')
  })

  it('undo restores the previous card on its front', async () => {
    const { user, store } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    const undo = screen.getByRole('button', { name: 'Undo last answer' })
    expect(undo).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    await user.click(screen.getByRole('button', { name: /^Again/ }))
    expect(store.getSnapshot().current?.wordId).not.toBe('w4f60')
    await user.click(screen.getByRole('button', { name: 'Undo last answer' }))
    await waitFor(() => expect(store.getSnapshot().current?.key).toBe('w4f60:listen'))
    expect(screen.getByText('nǐ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show answer/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /I already know this/ })).toBeInTheDocument()
  })
})

describe('keyboard shortcuts', () => {
  it('Space reveals; 1/2/3 grade; R/S replay; E example; Z undo', async () => {
    const { user, store, fake } = await setup()
    const gradeSpy = vi.spyOn(store, 'grade')
    await screen.findByRole('article', { name: 'Listen card' })

    // Grades do nothing while hidden.
    await user.keyboard('2')
    expect(gradeSpy).not.toHaveBeenCalled()
    // E (example) does nothing before reveal.
    fake.play.mockClear()
    await user.keyboard('e')
    expect(fake.play).not.toHaveBeenCalled()

    await user.keyboard('r')
    expect(fake.play).toHaveBeenLastCalledWith('w4f60', 'word', { slow: false })
    await user.keyboard('s')
    expect(fake.play).toHaveBeenLastCalledWith('w4f60', 'word', { slow: true })

    await user.keyboard(' ')
    expect(grades()).not.toBeNull()
    expect(screen.getByText('you')).toBeInTheDocument()
    await user.keyboard('e')
    expect(fake.play).toHaveBeenLastCalledWith('w4f60', 'example', { slow: false })

    await user.keyboard('3')
    expect(gradeSpy).toHaveBeenCalledWith('w4f60:listen', 'easy', expect.any(Number))
    expect(grades()).toBeNull()

    const undoSpy = vi.spyOn(store, 'undo')
    await user.keyboard('z')
    expect(undoSpy).toHaveBeenCalledOnce()
    await waitFor(() => expect(store.getSnapshot().current?.key).toBe('w4f60:listen'))

    await user.keyboard('{Enter}')
    expect(grades()).not.toBeNull()
    await user.keyboard('1')
    expect(gradeSpy).toHaveBeenLastCalledWith('w4f60:listen', 'again', expect.any(Number))
  })

  it('K marks a new word as known (front only)', async () => {
    const { user, store } = await setup()
    const spy = vi.spyOn(store, 'markKnown')
    await screen.findByRole('article', { name: 'Listen card' })
    await user.keyboard(' ')
    await user.keyboard('k')
    expect(spy).not.toHaveBeenCalled()
    await user.keyboard('z') // nothing to undo yet: no-op
    await user.keyboard('2')
    // Next new word: K works on its front.
    const next = store.getSnapshot().current!
    expect(next.canMarkKnown).toBe(true)
    await user.keyboard('k')
    expect(spy).toHaveBeenCalledWith(next.wordId)
  })

  it('S/R do not give away a Say card before reveal', async () => {
    const { user, fake } = await setup({
      prepare: (s) => {
        advance(s, (c) => c.dir === 'say')
      },
    })
    await screen.findByRole('article', { name: 'Say card' })
    await user.keyboard('r')
    await user.keyboard('s')
    expect(fake.play).not.toHaveBeenCalled()
  })

  it('ignores shortcuts while typing in the flag dialog', async () => {
    const { user, store } = await setup()
    const spy = vi.spyOn(store, 'grade')
    await screen.findByRole('article', { name: 'Listen card' })
    await user.keyboard(' ')
    await user.click(screen.getByRole('button', { name: 'Card options' }))
    await user.click(screen.getByRole('menuitem', { name: /Flag this card/ }))
    const note = await screen.findByRole('textbox')
    await user.type(note, '123 z')
    expect(spy).not.toHaveBeenCalled()
    expect(note).toHaveValue('123 z')
  })
})

describe('card menu', () => {
  it('flags the card with a reason and note', async () => {
    const { user, store } = await setup()
    const spy = vi.spyOn(store, 'flag')
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: 'Card options' }))
    await user.click(screen.getByRole('menuitem', { name: /Flag this card/ }))
    await user.click(await screen.findByRole('radio', { name: 'Wrong pinyin or tones' }))
    await user.type(screen.getByRole('textbox'), 'should be 2nd tone')
    await user.click(screen.getByRole('button', { name: 'Flag word' }))
    expect(spy).toHaveBeenCalledWith('w4f60', 'pinyin', 'should be 2nd tone')
    expect(await screen.findByText(/card flagged/)).toBeInTheDocument()
    // Still on the same card.
    expect(store.getSnapshot().current?.key).toBe('w4f60:listen')
  })

  it('suspends the word after confirmation', async () => {
    const { user, store } = await setup()
    const spy = vi.spyOn(store, 'setSuspended')
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: 'Card options' }))
    await user.click(screen.getByRole('menuitem', { name: /Suspend word/ }))
    await user.click(await screen.findByRole('button', { name: 'Suspend' }))
    expect(spy).toHaveBeenCalledWith('w4f60', true)
    expect(store.getSnapshot().current?.wordId).not.toBe('w4f60')
  })

  it('closes with Escape and returns focus to the menu button', async () => {
    const { user } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    const btn = screen.getByRole('button', { name: 'Card options' })
    await user.click(btn)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('menuitem')[1]).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(btn).toHaveFocus()
  })
})

describe('start and caught-up states', () => {
  it('shows "Start studying" until audio is unlocked; the tap unlocks it', async () => {
    let unlocked = false
    const listeners = new Set<() => void>()
    const fake = makeFakePlayer()
    const player = Object.assign(fake.player, {
      getUnlocked: () => unlocked,
      subscribe: (l: () => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      unlock: vi.fn(() => {
        unlocked = true
        listeners.forEach((l) => l())
      }),
    })
    const { user } = await setup({ player })
    const start = await screen.findByRole('button', { name: /Start studying/ })
    expect(screen.getByText('Due now')).toBeInTheDocument()
    expect(screen.queryByRole('article')).toBeNull()
    expect(fake.play).not.toHaveBeenCalled()
    await user.click(start)
    expect(player.unlock).toHaveBeenCalled()
    expect(await screen.findByRole('article', { name: 'Listen card' })).toBeInTheDocument()
    expect(fake.play).toHaveBeenCalledWith('w4f60', 'word', { slow: false })
  })

  it('caught up: explains why and offers practice-ahead', async () => {
    const { user, store } = await setup({
      prepare: async (s) => {
        for (let i = 0; i < 3; i++) await s.markKnown(s.getSnapshot().current!.wordId)
      },
    })
    expect(store.getSnapshot().current).toBeNull()
    expect(await screen.findByRole('heading', { name: 'All caught up' })).toBeInTheDocument()
    expect(screen.getByText(/You've met all/)).toBeInTheDocument()
    expect(screen.getByText(/Next card/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Keep practicing/ }))
    expect(store.getSnapshot().practiceAhead).toBe(true)
    const card = await screen.findByRole('article')
    expect(within(card).getByText('Practice ahead')).toBeInTheDocument()
  })

  it('caught up with nothing to practice ahead', async () => {
    const { store } = await setup({
      prepare: async (s) => {
        for (const id of ['w4f60', 'w6211', 'w662f']) await s.setSuspended(id, true)
      },
    })
    expect(store.getSnapshot().current).toBeNull()
    expect(await screen.findByText(/Nothing to practice ahead yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Keep practicing/ })).toBeNull()
  })

  it('stops audio when leaving the page', async () => {
    const { unmount, fake } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    act(() => unmount())
    expect((fake.player as unknown as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled()
  })
})
