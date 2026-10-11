import type { Word } from '../data/types'
import { cx } from './cx'
import { useSelector } from './hooks'

export type HanziSize = 'xl' | 'lg' | 'md' | 'sm'

const SIZES: Record<HanziSize, string> = {
  xl: 'text-3xl',
  lg: 'text-2xl',
  md: 'text-lg',
  sm: 'text-base',
}

export type HanziProps = {
  size?: HanziSize
  /** Show even when the showCharacters setting is off (e.g. word list, word detail). */
  force?: boolean
  /** Also show simplified characters when they differ (word list only, per PLAN). */
  showSimp?: boolean
  /** Muted (default) or full ink color. */
  muted?: boolean
  className?: string
} & ({ word: Pick<Word, 'trad' | 'simp'>; text?: undefined } | { word?: undefined; text: string })

/** Traditional characters, small and muted. Renders nothing when showCharacters is off (unless `force`). */
export function Hanzi({ word, text, size = 'md', force, showSimp, muted = true, className }: HanziProps) {
  const show = useSelector((s) => s.settings.showCharacters)
  if (!show && !force) return null
  const trad = word ? word.trad : text
  const simp = word && showSimp && word.simp !== word.trad ? word.simp : null
  return (
    <span className={cx('hanzi font-hanzi tracking-wide', muted ? 'text-muted' : 'text-ink', SIZES[size], className)}>
      <span lang="zh-TW">{trad}</span>
      {simp ? (
        <span lang="zh-CN" className="ml-2 text-[0.75em] text-faint">
          <span className="sr-only">simplified: </span>
          {simp}
        </span>
      ) : null}
    </span>
  )
}
