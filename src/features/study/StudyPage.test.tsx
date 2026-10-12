import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/**
 * Reach a Say card: graduate the first Listen card (Easy), then move the clock to the next study day, since a
 * word's Say card starts only on a later day than its Listen card's last review.
 */
function toSayCard(store: AppStore) {
  const c = store.getSnapshot().current!
  void store.grade(c.key, 'easy', 1000)
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 24 * 60 * 60 * 1000 })
  store.next()
  return advance(store, (x) => x.dir === 'say')
}

const grades = () => screen.queryByRole('group', { name: 'Grade' })

/** Grade buttons ignore taps for a moment after reveal (double-tap guard); wait it out. */
async function clickGrade(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await waitFor(() => expect(grades()).not.toHaveStyle({ pointerEvents: 'none' }))
  await user.click(screen.getByRole('button', { name }))
}

beforeEach(() => {
  studySession.reset()
})
afterEach(() => {
  vi.useRealTimers()
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
    // The note gets pinyin after its characters, looked up in the word list.
    expect(screen.getByRole('region', { name: 'Answer' })).toHaveTextContent('Polite form is 您 nín.')
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

describe('sentence hint', () => {
  it('a Listen card front offers the example sentence as audio only, until reveal', async () => {
    const { user, fake } = await setup()
    const card = await screen.findByRole('article', { name: 'Listen card' })
    fake.play.mockClear()
    await user.click(within(card).getByRole('button', { name: /Hear it in a sentence/ }))
    expect(fake.play).toHaveBeenLastCalledWith('w4f60', 'example', { slow: false })
    // Audio only: the sentence text and the meaning stay hidden.
    expect(within(card).queryByText('example 1')).toBeNull()
    expect(within(card).queryByText('you')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    expect(within(card).queryByRole('button', { name: /Hear it in a sentence/ })).toBeNull()
  })

  it('a Say card front has no sentence hint (it would give the answer away)', async () => {
    await setup({ prepare: (s) => void toSayCard(s) })
    const card = await screen.findByRole('article', { name: 'Say card' })
    expect(within(card).queryByRole('button', { name: /Hear it in a sentence/ })).toBeNull()
  })
})

describe('your note', () => {
  it('adds a note from the Listen answer; it is saved and shown', async () => {
    const { user, store } = await setup()
    const card = await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    await user.click(within(card).getByRole('button', { name: 'Add your note' }))
    await user.type(screen.getByRole('textbox', { name: 'Your note' }), '  my own meaning  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(store.getSnapshot().derived.words.get('w4f60')?.note).toBe('my own meaning'))
    expect(within(card).getByText('my own meaning')).toBeInTheDocument()
    // The card stays revealed (saving a note does not re-pick the card).
    expect(grades()).not.toBeNull()
  })

  it('is not shown on a Listen front (it would give the meaning away)', async () => {
    await setup({ prepare: (s) => s.setNote('w4f60', 'secret meaning') })
    const card = await screen.findByRole('article', { name: 'Listen card' })
    expect(within(card).queryByText('secret meaning')).toBeNull()
  })

  it('shows next to the English on a Say front, and can be edited and removed', async () => {
    const { user, store } = await setup({
      prepare: async (s) => {
        const c = toSayCard(s)
        await s.setNote(c.wordId, 'my mnemonic')
      },
    })
    const cur = store.getSnapshot().current!
    const card = await screen.findByRole('article', { name: 'Say card' })
    expect(within(card).getByText('my mnemonic')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Edit your note' }))
    const box = screen.getByRole('textbox', { name: 'Your note' })
    expect(box).toHaveValue('my mnemonic')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(store.getSnapshot().derived.words.get(cur.wordId)?.note).toBeUndefined())
    expect(within(card).queryByText('my mnemonic')).toBeNull()
  })
})

describe('Say card', () => {
  const toSay = (s: AppStore) => {
    toSayCard(s)
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
    await clickGrade(user, /^Good/)
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
    await clickGrade(user, /^Again/)
    expect(store.getSnapshot().current?.wordId).not.toBe('w4f60')
    await user.click(screen.getByRole('button', { name: 'Undo last answer' }))
    await waitFor(() => expect(store.getSnapshot().current?.key).toBe('w4f60:listen'))
    expect(screen.getByText('nǐ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Show answer/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /I already know this/ })).toBeInTheDocument()
  })
})

describe('double-tap guard', () => {
  it('a second tap right after "Show answer" does not grade; a later tap does', async () => {
    const { store } = await setup()
    // Skip user-event's pointer-events check, to simulate a tap landing during the guard.
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    const spy = vi.spyOn(store, 'grade')
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: /Show answer/ }))
    expect(grades()).toHaveStyle({ pointerEvents: 'none' })
    await user.click(screen.getByRole('button', { name: /^Good/ }))
    expect(spy).not.toHaveBeenCalled()
    await clickGrade(user, /^Good/)
    expect(spy).toHaveBeenCalledOnce()
  })

  it('does not slow down keyboard grading', async () => {
    const { user, store } = await setup()
    const spy = vi.spyOn(store, 'grade')
    await screen.findByRole('article', { name: 'Listen card' })
    await user.keyboard(' ')
    await user.keyboard('2')
    expect(spy).toHaveBeenCalledOnce()
  })
})

describe('keyboard shortcuts', () => {
  it('Space after clicking Undo with the mouse reveals instead of undoing again', async () => {
    const { user, store } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    await user.keyboard(' ')
    await user.keyboard('2')
    await user.keyboard(' ')
    await user.keyboard('2')
    const undoSpy = vi.spyOn(store, 'undo')
    const undoBtn = screen.getByRole('button', { name: 'Undo last answer' })
    await user.click(undoBtn)
    expect(undoSpy).toHaveBeenCalledOnce()
    expect(undoBtn).toHaveFocus()
    await user.keyboard(' ')
    expect(undoSpy).toHaveBeenCalledOnce()
    expect(grades()).not.toBeNull()
  })

  it('Space after clicking Replay reveals instead of replaying', async () => {
    const { user, fake } = await setup()
    const card = await screen.findByRole('article', { name: 'Listen card' })
    await user.click(within(card).getByRole('button', { name: 'Replay word' }))
    const plays = fake.play.mock.calls.length
    await user.keyboard(' ')
    expect(grades()).not.toBeNull()
    expect(fake.play.mock.calls.length).toBe(plays)
  })

  it('Space still activates a control reached with Tab', async () => {
    const { user, store } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    await user.keyboard(' ')
    await user.keyboard('2')
    const undoSpy = vi.spyOn(store, 'undo')
    const undoBtn = screen.getByRole('button', { name: 'Undo last answer' })
    // Mouse first, then keyboard navigation: Tab switches back to keyboard modality.
    await user.click(document.body)
    for (let i = 0; i < 20 && document.activeElement !== undoBtn; i++) await user.tab()
    expect(undoBtn).toHaveFocus()
    await user.keyboard(' ')
    expect(undoSpy).toHaveBeenCalledOnce()
  })


  it('Space reveals; 1/2/3 grade; R/S replay; E example; Z undo', async () => {
    const { user, store, fake } = await setup()
    const gradeSpy = vi.spyOn(store, 'grade')
    await screen.findByRole('article', { name: 'Listen card' })

    // Grades do nothing while hidden.
    await user.keyboard('2')
    expect(gradeSpy).not.toHaveBeenCalled()
    // E plays the example sentence as a hint, even before reveal, on a Listen card.
    fake.play.mockClear()
    await user.keyboard('e')
    expect(fake.play).toHaveBeenLastCalledWith('w4f60', 'example', { slow: false })

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

  it('S/R/E do not give away a Say card before reveal', async () => {
    const { user, fake } = await setup({
      prepare: (s) => {
        toSayCard(s)
      },
    })
    await screen.findByRole('article', { name: 'Say card' })
    await user.keyboard('r')
    await user.keyboard('s')
    await user.keyboard('e')
    expect(fake.play).not.toHaveBeenCalled()
  })

  it('N opens the note editor without typing an "n" into it', async () => {
    const { user, store } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    await user.keyboard('n')
    const box = await screen.findByRole('textbox', { name: 'Your note' })
    expect(box).toHaveValue('')
    const spy = vi.spyOn(store, 'grade')
    await user.type(box, 'z 1 2')
    expect(spy).not.toHaveBeenCalled()
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

describe('toast', () => {
  it('"I already know this" toast has its own Undo button', async () => {
    const { user, store } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: /I already know this/ }))
    await waitFor(() => expect(store.getSnapshot().current?.wordId).not.toBe('w4f60'))
    const undoSpy = vi.spyOn(store, 'undo')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(undoSpy).toHaveBeenCalledOnce()
    await waitFor(() => expect(store.getSnapshot().current?.key).toBe('w4f60:listen'))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('the known toast drops its Undo once another answer is logged', async () => {
    const { user } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: /I already know this/ }))
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()
    await user.keyboard(' ')
    await user.keyboard('2')
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('the suspend toast Undo unsuspends the word', async () => {
    const { user, store } = await setup()
    const spy = vi.spyOn(store, 'setSuspended')
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: 'Card options' }))
    await user.click(screen.getByRole('menuitem', { name: /Suspend word/ }))
    await user.click(await screen.findByRole('button', { name: 'Suspend' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(spy).toHaveBeenLastCalledWith('w4f60', false)
  })

  it('the flag toast has no Undo button', async () => {
    const { user } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    await user.click(screen.getByRole('button', { name: 'Card options' }))
    await user.click(screen.getByRole('menuitem', { name: /Flag this card/ }))
    await user.click(await screen.findByRole('radio', { name: 'Wrong pinyin or tones' }))
    await user.click(screen.getByRole('button', { name: 'Flag word' }))
    expect(await screen.findByText(/card flagged/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })
})

describe('scrolling', () => {
  const originalScrollTo = window.scrollTo
  const originalScrollBy = window.scrollBy
  const originalInnerHeight = window.innerHeight
  afterEach(() => {
    window.scrollTo = originalScrollTo
    window.scrollBy = originalScrollBy
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true })
    Reflect.deleteProperty(window, 'scrollY')
  })

  it('a new card starts at the top of the page', async () => {
    const { user } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true })
    await user.keyboard(' ')
    expect(window.scrollTo).not.toHaveBeenCalled()
    await user.keyboard('2')
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' })
  })

  it('revealing scrolls the meaning and then the example into view, keeping the meaning on screen', async () => {
    const { user } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    const scrollBy = vi.fn()
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
    // Answer layout below the fold: meaning block at 400–500px, example sentence at 520–700px.
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.hasAttribute('data-answer-lead')) return { top: 400, bottom: 500 } as DOMRect
      if (this.hasAttribute('data-answer-example')) return { top: 520, bottom: 700 } as DOMRect
      return { top: 0, bottom: 0 } as DOMRect
    })
    try {
      await user.keyboard(' ')
      expect(scrollBy).toHaveBeenCalledOnce()
      expect(scrollBy.mock.calls[0][0]).toMatchObject({ top: 100 })
      // The example comes before the note.
      const example = screen.getByText('example 1')
      const answer = screen.getByRole('region', { name: 'Answer' })
      expect(answer.querySelector('[data-answer-example]')).toContainElement(example)
    } finally {
      rect.mockRestore()
    }
  })

  it('a long example never pushes the meaning off the top', async () => {
    const { user } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    const scrollBy = vi.fn()
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.hasAttribute('data-answer-lead')) return { top: 450, bottom: 560 } as DOMRect
      if (this.hasAttribute('data-answer-example')) return { top: 580, bottom: 1400 } as DOMRect
      return { top: 0, bottom: 0 } as DOMRect
    })
    try {
      await user.keyboard(' ')
      expect(scrollBy.mock.calls[0][0]).toMatchObject({ top: 450 })
    } finally {
      rect.mockRestore()
    }
  })
})

describe('audio problems', () => {
  it('a failed play shows a hint linking to Settings, and an audio-only front falls back to the word', async () => {
    const { fake } = await setup({ settings: { listenFront: 'audioOnly' } })
    const card = await screen.findByRole('article', { name: 'Listen card' })
    expect(within(card).queryByText('nǐ')).toBeNull()
    act(() => fake.finish('failed'))
    expect(await within(card).findByText(/Couldn.t play audio/)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Check Settings/ })).toHaveAttribute('href', '#/settings')
    expect(within(card).getByText('nǐ')).toBeInTheDocument()
  })

  it('a blocked autoplay shows the tap-to-play hint', async () => {
    const { fake } = await setup()
    const card = await screen.findByRole('article', { name: 'Listen card' })
    act(() => fake.finish('blocked'))
    expect(await within(card).findByText(/paused autoplay/)).toBeInTheDocument()
  })
})

describe('hidden page', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('a card that appears while the page is hidden autoplays only once it is visible', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    const { fake } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    expect(fake.play).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(fake.play).toHaveBeenCalledWith('w4f60', 'word', { slow: false })
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

  it('caught up: the reminder banner sits under the heading, above the tiles and Keep practicing', async () => {
    localStorage.clear() // no snoozed reminders
    await setup({
      prepare: async (s) => {
        for (let i = 0; i < 3; i++) await s.markKnown(s.getSnapshot().current!.wordId)
      },
    })
    const heading = await screen.findByRole('heading', { name: 'All caught up' })
    const nudge = screen.getByText('Back up your progress.')
    const practice = screen.getByRole('button', { name: /Keep practicing/ })
    expect(heading.compareDocumentPosition(nudge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(nudge.compareDocumentPosition(practice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

describe('card menu focus', () => {
  it('opens a dialog from the menu and returns focus to "Card options" when it closes', async () => {
    const { user } = await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    const btn = screen.getByRole('button', { name: 'Card options' })
    await user.click(btn)
    await user.click(screen.getByRole('menuitem', { name: /Flag this card/ }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(btn).toHaveFocus()
  })
})

describe('progress line', () => {
  it('calls the working set "in progress" (not "learning", which the Words page uses for learning steps)', async () => {
    await setup()
    await screen.findByRole('article', { name: 'Listen card' })
    const line = screen.getByLabelText('Progress')
    expect(line).toHaveTextContent(/\d+ due\s*·\s*\d+\/\d+ in progress\s*·\s*\d+(\/\d+)? words/)
    expect(line).not.toHaveTextContent(/learning/)
    expect(within(line).getByTitle(/working set/)).toHaveTextContent(/in progress/)
  })
})
