import { useMemo } from 'react'
import type { Tone, Word } from '../data/types'
import { cx } from './cx'
import { useSelector } from './hooks'
import { segmentPinyin } from './pinyinText'

export type PinyinSize = 'hero' | 'xl' | 'lg' | 'md' | 'sm'

const SIZES: Record<PinyinSize, string> = {
  hero: 'text-5xl sm:text-6xl font-semibold tracking-tight leading-tight',
  xl: 'text-4xl font-semibold tracking-tight leading-tight',
  lg: 'text-2xl font-medium leading-snug',
  md: 'text-lg leading-snug',
  sm: 'text-base leading-snug',
}

export type PinyinProps = {
  size?: PinyinSize
  /** Override the toneColors setting. */
  toneColors?: boolean
  className?: string
  /** Element to render (default span). */
  as?: 'span' | 'p' | 'div'
} & (
  | { word: Pick<Word, 'pinyin' | 'tones'>; text?: undefined; tones?: undefined }
  | { word?: undefined; text: string; tones?: readonly Tone[] }
)

/**
 * Tone-marked pinyin, one span per syllable (class `tone-N`), colored by tone when the
 * toneColors setting is on (Pleco colors: 1 red, 2 green, 3 blue, 4 purple, neutral gray).
 * Give it a `word` (uses its citation `tones`), or `text` (+ optional `tones`). Sentences and
 * words written without spaces ("péngyǒu") are split into syllables and colored by tone mark.
 */
export function Pinyin({ word, text, tones, size = 'md', toneColors, className, as: As = 'span' }: PinyinProps) {
  const setting = useSelector((s) => s.settings.toneColors)
  const colored = toneColors ?? setting
  const source = word ? word.pinyin : text
  const toneList = word ? word.tones : tones
  const segments = useMemo(() => segmentPinyin(source ?? '', toneList), [source, toneList])
  return (
    <As lang="zh-Latn-pinyin" className={cx('pinyin', colored && 'tone-colors', SIZES[size], className)}>
      {segments.map((s, i) =>
        s.tone === null ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span key={i} className={`tone-${s.tone}`} data-tone={s.tone}>
            {s.text}
          </span>
        ),
      )}
    </As>
  )
}
