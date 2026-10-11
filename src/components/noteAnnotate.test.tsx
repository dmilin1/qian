import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Word } from '../data/types'
import { getWords } from '../lib/words'
import { NoteText } from './NoteText'
import { annotateNote, buildNoteDictionary, lookupPinyin, type NoteSegment } from './noteAnnotate'
import { renderWithApp } from './test-utils'

const words = getWords()
const dict = buildNoteDictionary(words.list)
const noteOf = (trad: string) => words.list.find((w) => w.trad === trad)!.note!
/** The character runs of a note with the pinyin added to each (null = left as written). */
const runs = (segs: NoteSegment[]) => segs.flatMap((s) => (s.kind === 'han' ? [[s.text, s.pinyin]] : []))

describe('annotateNote (real word list)', () => {
  it('adds pinyin to bare characters, looked up in the word list', () => {
    // A note as the data used to have it, before every run got its pinyin in data/enriched.
    const note = "Negated with 沒 (沒有 'don't have'), never 不有. Taiwan Mandarin also uses 有 before a verb for 'did': 我有去 'I did go'."
    const segs = annotateNote(note, dict)
    expect(runs(segs)).toEqual([
      ['沒', 'méi'],
      ['沒有', 'méi yǒu'],
      ['不有', 'bù yǒu'],
      ['有', 'yǒu'],
      ['我有去', 'wǒ yǒu qù'],
    ])
    // Nothing of the note is lost.
    expect(segs.map((s) => s.text).join('')).toBe(note)
  })

  it('leaves runs alone that already have their reading next to them (hè (附和), huó (和麵))', () => {
    const r = runs(annotateNote('Other readings: hè (附和), huó (和麵); casual speech uses 跟.', dict))
    expect(r).toContainEqual(['附和', null])
    expect(r).toContainEqual(['和麵', null])
    expect(r).toContainEqual(['跟', 'gēn'])
  })

  it('finds pinyin already in every real note, so it adds nothing to them', () => {
    const added = words.list.flatMap((w) =>
      w.note ? runs(annotateNote(w.note, dict)).filter(([, py]) => py !== null).map(([run]) => `${w.trad}: ${run}`) : [],
    )
    expect(added).toEqual([])
  })

  it('does not repeat pinyin that follows the characters, including a neutral tone', () => {
    const r = runs(annotateNote(noteOf('已經'), dict)) // "Usually comes with 了 le at the end: 他已經走了 …"
    expect(r[0]).toEqual(['了', null])
    expect(runs(annotateNote('還 huán 錢', dict))).toEqual([['還', null], ['錢', 'qián']])
  })

  it('leaves a run unannotated when any character is not in the word list (no partial guesses)', () => {
    expect(lookupPinyin('我會游泳', dict)).toBeNull()
    expect(runs(annotateNote('A learned skill (我會游泳 \'I can swim\')', dict))).toEqual([['我會游泳', null]])
  })
})

describe('<NoteText>', () => {
  const small = buildNoteDictionary([
    { trad: '沒', pinyin: 'méi', rank: 1 },
    { trad: '有', pinyin: 'yǒu', rank: 2 },
    { trad: '沒有', pinyin: 'méi yǒu', rank: 3 },
  ] as Pick<Word, 'trad' | 'pinyin' | 'rank'>[])

  it('shows characters followed by their pinyin', async () => {
    const { container } = renderWithApp(<NoteText note="Negated with 沒有 'don't have'." dictionary={small} />)
    await waitFor(() => expect(container).toHaveTextContent("Negated with 沒有 méi yǒu 'don't have'."))
    expect(screen.getByText('沒有')).toHaveAttribute('lang', 'zh-TW')
  })

  it('shows only the pinyin when characters are off, and keeps characters it cannot read', async () => {
    const { container } = renderWithApp(<NoteText note="Use 沒有, not 不有." dictionary={small} />, { settings: { showCharacters: false } })
    await waitFor(() => expect(container).toHaveTextContent('Use méi yǒu, not 不有.'))
    expect(screen.queryByText('沒有')).toBeNull()
  })

  it('drops characters the note already follows with pinyin when characters are off', async () => {
    const { container } = renderWithApp(<NoteText note="Negated with 沒 méi (沒有 méi yǒu 'don't have')." dictionary={small} />, {
      settings: { showCharacters: false },
    })
    await waitFor(() => expect(container).toHaveTextContent("Negated with méi (méi yǒu 'don't have')."))
    expect(screen.queryByText('沒有')).toBeNull()
  })

  it('force shows characters even when they are off (word detail page)', async () => {
    const { container } = renderWithApp(<NoteText note="沒有" dictionary={small} force />, { settings: { showCharacters: false } })
    await waitFor(() => expect(container).toHaveTextContent('沒有 méi yǒu'))
  })
})
