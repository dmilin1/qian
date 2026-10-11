import { useMemo } from 'react'
import { getWords } from '../lib/words'
import { useSelector } from './hooks'
import { annotateNote, buildNoteDictionary, type NoteDictionary } from './noteAnnotate'
import { Pinyin } from './Pinyin'

let defaultDict: NoteDictionary | null = null
const appDictionary = () => (defaultDict ??= buildNoteDictionary(getWords().list))

/**
 * A word note with pinyin added after each run of characters that has none ("沒有 méi yǒu"). When showCharacters
 * is off, annotated runs show only their pinyin and runs the note already follows with pinyin are dropped;
 * runs that could not be looked up keep their characters, so nothing is lost. `force` always shows characters
 * (word detail page).
 */
export function NoteText({ note, force, dictionary }: { note: string; force?: boolean; dictionary?: NoteDictionary }) {
  const showCharacters = useSelector((s) => s.settings.showCharacters) || !!force
  const segments = useMemo(() => annotateNote(note, dictionary ?? appDictionary()), [note, dictionary])
  return (
    <>
      {segments.map((s, i) => {
        const prev = segments[i - 1]
        const hidePrev = !showCharacters && prev?.kind === 'han' && prev.followedByPinyin
        if (s.kind === 'text') return <span key={i}>{hidePrev ? s.text.trimStart() : s.text}</span>
        if (!showCharacters && s.followedByPinyin) return null
        const hanzi = (
          <span lang="zh-TW" className="font-hanzi">
            {s.text}
          </span>
        )
        if (!s.pinyin) return <span key={i}>{hanzi}</span>
        return (
          <span key={i}>
            {showCharacters ? <>{hanzi} </> : null}
            <Pinyin text={s.pinyin} size="sm" className="font-medium" />
          </span>
        )
      })}
    </>
  )
}
