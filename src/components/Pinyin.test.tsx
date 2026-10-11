import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Hanzi } from './Hanzi'
import { Pinyin } from './Pinyin'
import { segmentPinyin, splitSyllables, toneOf } from './pinyinText'
import { renderWithApp } from './test-utils'

describe('pinyin segmentation', () => {
  it.each([
    ['péngyǒu', ['péng', 'yǒu']],
    ['xīngqí', ['xīng', 'qí']],
    ['Zhōngguó', ['Zhōng', 'guó']],
    ['nǎlǐ', ['nǎ', 'lǐ']],
    ['yīnggāi', ['yīng', 'gāi']],
    ['wǎnshang', ['wǎn', 'shang']],
    ['yìdiǎnr', ['yì', 'diǎnr']],
    ['érzi', ['ér', 'zi']],
    ['bùrán', ['bù', 'rán']],
    ['shénme', ['shén', 'me']],
    ['nǚér', ['nǚ', 'ér']],
    ['lèsè', ['lè', 'sè']],
  ])('splits %s', (input, expected) => {
    expect(splitSyllables(input)).toEqual(expected)
  })

  it('detects tones from marks, neutral when unmarked', () => {
    expect(['mā', 'má', 'mǎ', 'mà', 'ma', 'lǜ', 'Ō'].map(toneOf)).toEqual([1, 2, 3, 4, 5, 4, 1])
  })

  it('handles decomposed (NFD) tone marks', () => {
    expect(toneOf('mǎ')).toBe(3)
  })

  it('segments a sentence, keeping punctuation and apostrophes as separators', () => {
    const segs = segmentPinyin("Tā shì wǒ de péngyǒu, zài Xī'ān.")
    expect(segs.filter((s) => s.tone !== null).map((s) => `${s.text}${s.tone}`)).toEqual([
      'Tā1', 'shì4', 'wǒ3', 'de5', 'péng2', 'yǒu3', 'zài4', 'Xī1', 'ān1',
    ])
    expect(segs.map((s) => s.text).join('')).toBe("Tā shì wǒ de péngyǒu, zài Xī'ān.")
  })

  it('uses citation tones when given and the syllable count matches', () => {
    expect(segmentPinyin('nǐ hǎo', [3, 3]).filter((s) => s.tone).map((s) => s.tone)).toEqual([3, 3])
    // count mismatch: falls back to the marks
    expect(segmentPinyin('nǐ hǎo', [3]).filter((s) => s.tone).map((s) => s.tone)).toEqual([3, 3])
  })
})

describe('<Pinyin>', () => {
  it('renders one span per syllable with tone classes, colored when enabled', () => {
    const { container } = renderWithApp(<Pinyin word={{ pinyin: 'xīng qí', tones: [1, 2] }} />)
    const root = container.querySelector('[lang="zh-Latn-pinyin"]')!
    expect(root).toHaveClass('tone-colors')
    expect(root).toHaveTextContent('xīng qí')
    expect([...root.querySelectorAll('[data-tone]')].map((e) => e.className)).toEqual(['tone-1', 'tone-2'])
  })

  it('follows the toneColors setting live', () => {
    const { container, store } = renderWithApp(<Pinyin text="Wǒ hěn hǎo." />)
    const root = () => container.querySelector('[lang="zh-Latn-pinyin"]')!
    expect(root()).toHaveClass('tone-colors')
    act(() => store.updateSettings({ toneColors: false }))
    expect(root()).not.toHaveClass('tone-colors')
    expect(root()).toHaveTextContent('Wǒ hěn hǎo.')
  })
})

describe('<Hanzi>', () => {
  it('is hidden when showCharacters is off unless forced', () => {
    renderWithApp(
      <>
        <Hanzi text="你好" />
        <Hanzi text="朋友" force />
      </>,
      { settings: { showCharacters: false } },
    )
    expect(screen.queryByText('你好')).toBeNull()
    expect(screen.getByText('朋友')).toHaveAttribute('lang', 'zh-TW')
  })

  it('shows simplified only when asked and different', () => {
    renderWithApp(<Hanzi word={{ trad: '認識', simp: '认识' }} showSimp />)
    expect(screen.getByText('認識')).toBeInTheDocument()
    expect(screen.getByText('认识')).toHaveAttribute('lang', 'zh-CN')
  })
})
